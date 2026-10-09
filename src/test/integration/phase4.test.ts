import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Phase0Api } from '../../extension';
import { Library } from '../../application/library';
import { PackImportSession, exportPack } from '../../application/packArchive';
import { encodeArchive, decodeArchive } from '../../storage/archive';
import { cloneTree, byteFingerprint } from '../../storage/transaction';
import { InsertionPipeline, type InsertionInteractions } from '../../application/insertionPipeline';
import { UserState } from '../../application/userState';
import { ConflictError } from '../../core/conflict';
import { markerEvidence } from '../../language/sourceMarker';
import type { AssetLocation } from '../../storage/discovery';

const uuid = (n: number) => '44000000-0000-0000-0000-' + String(n).padStart(12, '0');
const io = (): InsertionInteractions => ({ input: async () => 'value', mode: async (_, modes) => modes[0], output: async () => undefined, preview: async () => true, warnings: async () => true });
const request = (asset: AssetLocation, target: vscode.TextEditor, mode?: 'separate-files') => ({ asset, mode, target: { uri: target.document.uri, version: target.document.version, selection: target.selection } });
const key = (asset: AssetLocation) => `snippet:${asset.metadata.id}:${asset.metadata.version!.text}`;

suite('Phase 4 — archive, standard Diff and optional markers in a real Extension Host', () => {
	let api: Phase0Api;
	suiteSetup(async () => { api = await vscode.extensions.getExtension<Phase0Api>('oz-coden.turbo-code-palette')!.activate(); });
	async function sandbox(run: (library: Library, state: UserState, parent: string) => Promise<void>): Promise<void> {
		const base = path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, 'phase4-cases'); await fs.mkdir(base, { recursive: true }); const parent = await fs.mkdtemp(path.join(base, 'case-')), root = { scope: 'global' as const, path: path.join(parent, 'library') }, directory = path.join(root.path, 'Pack');
		try {
			await fs.mkdir(path.join(directory, 'Member'), { recursive: true }); await fs.mkdir(path.join(directory, 'Empty'));
			await fs.writeFile(path.join(directory, 'pack.json'), JSON.stringify({ formatVersion: 1, id: uuid(0), name: 'Pack', version: 'v1.0.0' })); await fs.writeFile(path.join(directory, 'Member/snippet.json'), JSON.stringify({ formatVersion: 1, id: uuid(1), name: 'Member', version: 'v1.0.0', sources: ['code.cs'], exports: [{ name: 'VALUE', kind: 'variable' }] })); await fs.writeFile(path.join(directory, 'Member/code.cs'), 'int VALUE = 1;\n');
			const library = new Library(() => [root]); await library.reload(); const data = new Map<string, unknown>(), state = new UserState({ get: <T>(name: string, fallback: T) => (data.get(name) ?? fallback) as T, update: async (name, value) => { data.set(name, value); } }); await run(library, state, parent);
		} finally { await vscode.commands.executeCommand('workbench.action.closeAllEditors'); assert.equal(path.dirname(parent), base); await fs.rm(parent, { recursive: true, force: true }); }
	}
	async function editor(text = 'class Target {}\n', language = 'csharp'): Promise<vscode.TextEditor> { const target = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: text, language })); const end = target.document.positionAt(target.document.getText().length); target.selection = new vscode.Selection(end, end); return target; }
	async function setting<T>(name: string, value: T, run: () => Promise<void>): Promise<void> { const config = vscode.workspace.getConfiguration('turboCodePalette'), previous = config.inspect<T>(name)?.globalValue; try { await config.update(name, value, vscode.ConfigurationTarget.Global); await run(); } finally { await config.update(name, previous, vscode.ConfigurationTarget.Global); } }

	test('Compare opens native Diff snapshots and preserves the last project insertion target', async () => sandbox(async (library) => {
		const target = await editor(), captured = api.product.insertion.capture(); assert.equal(captured?.uri.toString(), target.document.uri.toString());
		await api.product.comparison.diff('CURRENT\n', 'PLANNED\n', 'TCP Host Comparison');
		const tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.label === 'TCP Host Comparison'); assert.ok(tab?.input instanceof vscode.TabInputTextDiff);
		const input = tab.input as vscode.TabInputTextDiff; assert.equal(input.original.scheme, 'tcp-review'); assert.equal((await vscode.workspace.openTextDocument(input.original)).getText(), 'CURRENT\n'); assert.equal((await vscode.workspace.openTextDocument(input.modified)).getText(), 'PLANNED\n'); assert.equal(api.product.insertion.capture()?.uri.toString(), captured!.uri.toString()); assert.equal(target.document.getText(), 'class Target {}\n'); assert.equal(library.catalog.snapshot!.snippets.length, 1);
	}));
	test('preview Compare is optional; cancel leaves text/files and usage unchanged after native Diff', async () => sandbox(async (library, state) => {
		await setting('previewBeforeInsert', true, async () => { const target = await editor(), asset = library.catalog.snapshot!.snippets[0], interactions = io(); let previews = 0; interactions.preview = async plan => { previews++; return api.product.comparison.preview(plan, async compared => { if (compared) { return; } assert.equal(vscode.window.activeTextEditor!.document.uri.scheme, 'tcp-review'); assert.equal(vscode.window.activeTextEditor!.document.getText(), plan.after); return 'Compare'; }); }; const pipeline = new InsertionPipeline(library, state, undefined, interactions); assert.equal(await pipeline.run(request(asset, target)), 'cancelled'); assert.equal(previews, 1); assert.equal(target.document.getText(), 'class Target {}\n'); assert.equal(state.get(key(asset)).usage, 0); assert.equal(state.get(key(asset)).recent, 0); pipeline.dispose(); });
	}));
	test('raw implementation/export collisions return comparison evidence and never apply or count usage', async () => sandbox(async (library, state) => {
		const asset = library.catalog.snapshot!.snippets[0], pipeline = new InsertionPipeline(library, state, undefined, io());
		for (const text of ['int VALUE = 1;\n', 'int VALUE = 99;\n']) { const target = await editor(text); let conflict: ConflictError | undefined; try { await pipeline.run(request(asset, target)); } catch (error) { assert.ok(error instanceof ConflictError); conflict = error; } assert.equal(conflict!.evidence.currentText, text); assert.match(conflict!.evidence.requestedText!, /VALUE/); await api.product.comparison.diff(conflict!.evidence.currentText!, conflict!.evidence.requestedText!, 'TCP Host Conflict'); assert.equal(target.document.getText(), text); assert.equal(state.get(key(asset)).usage, 0); } pipeline.dispose();
	}));
	test('same UUID/version different source exposes revision comparison evidence without mutation', async () => sandbox(async (library, state) => {
		const root = library.roots()[0], other = path.join(root.path, 'Other'); await fs.cp(path.join(root.path, 'Pack'), other, { recursive: true }); await fs.writeFile(path.join(other, 'Member/code.cs'), 'int OTHER = 2;'); await library.reload();
		const asset = library.catalog.snapshot!.snippets[0], target = await editor(), pipeline = new InsertionPipeline(library, state, undefined, io()); await assert.rejects(pipeline.run(request(asset, target)), error => { assert.ok(error instanceof ConflictError); assert.equal(error.evidence.existing?.length, 1); assert.equal(error.evidence.incoming, asset); return true; }); assert.equal(target.document.getText(), 'class Target {}\n'); pipeline.dispose();
	}));
	test('markers default OFF; enabled safe comments remain one editor Undo, and forged/copied marker is never sufficient proof', async () => sandbox(async (library, state) => {
		assert.equal(vscode.workspace.getConfiguration('turboCodePalette').get('sourceMarkers'), false); const asset = library.catalog.snapshot!.snippets[0];
		let target = await editor(), pipeline = new InsertionPipeline(library, state, undefined, io()); await pipeline.run(request(asset, target)); assert.ok(!target.document.getText().includes('TCP BEGIN')); await vscode.commands.executeCommand('undo'); assert.equal(target.document.getText(), 'class Target {}\n'); pipeline.dispose();
		await setting('sourceMarkers', true, async () => { target = await editor(); pipeline = new InsertionPipeline(library, state, undefined, io()); const before = target.document.getText(); await pipeline.run(request(asset, target)); const inserted = target.document.getText(); assert.equal(markerEvidence(inserted, 'csharp')[0].id, asset.metadata.id); assert.match(inserted, /\/\/ TCP END/); await vscode.commands.executeCommand('undo'); assert.equal(target.document.getText(), before); pipeline.dispose();
			const metadataPath = path.join(asset.root.path, asset.relativePath, 'snippet.json'), metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')); delete metadata.exports; await fs.writeFile(metadataPath, JSON.stringify(metadata)); await library.reload();
			const changed = inserted.replace('int VALUE = 1;', 'int RENAMED = 999;'), fresh = new InsertionPipeline(library, state, undefined, io()), copied = await editor(changed); await assert.rejects(fresh.run(request(library.catalog.snapshot!.snippets[0], copied)), /marker alone/); assert.equal(copied.document.getText(), changed); fresh.dispose(); });
	}));
	test('unsupported marker context is omitted; separate-files markers use each source language in a new folder', async () => sandbox(async (library, state, parent) => {
		await setting('sourceMarkers', true, async () => { const asset = library.catalog.snapshot!.snippets[0], target = await editor('before\n', 'plaintext'), interactions = io(), pipeline = new InsertionPipeline(library, state, undefined, interactions); await pipeline.run(request(asset, target)); assert.ok(!target.document.getText().includes('TCP BEGIN')); assert.ok(pipeline.lastPlan!.warnings.some(warning => warning.includes('marker omitted'))); pipeline.dispose();
			const separate = new InsertionPipeline(library, state, undefined, interactions), original = target.document.getText(); interactions.output = async () => ({ parent, folder: 'Generated' }); await separate.run(request(asset, target, 'separate-files')); assert.match(await fs.readFile(path.join(parent, 'Generated/code.cs'), 'utf8'), /^\/\/ TCP BEGIN/); assert.equal(target.document.getText(), original); separate.dispose(); });
	}));
	test('host archive roundtrip, preview/cancel, explicit Fork and native-only eligibility preserve source Pack', async () => sandbox(async (library, _state, parent) => {
		const pack = library.catalog.snapshot!.packs[0], original = await library.assetTree(pack), archive = path.join(parent, 'pack.tcp-sp'); await exportPack(library, pack, archive); assert.equal(byteFingerprint(await decodeArchive(await fs.readFile(archive))), byteFingerprint(original));
		const root = { scope: 'workspace' as const, workspaceId: 'host', path: path.join(parent, 'destination') }, destination = new Library(() => [root]); await destination.reload(); let session = await PackImportSession.prepare(destination, archive, root); await session.dispose(); await assert.rejects(fs.stat(root.path));
		session = await PackImportSession.prepare(destination, archive, root); try { await session.commit('add'); } finally { await session.dispose(); } assert.equal(destination.catalog.snapshot!.packs.length, 1);
		const conflicting = cloneTree(original); conflicting.set('Member/code.cs', Buffer.from('int CONFLICT = 3;')); await fs.writeFile(archive, await encodeArchive(conflicting)); session = await PackImportSession.prepare(destination, archive, root); try { assert.ok(session.rows.some(row => row.category === 'conflict')); await assert.rejects(session.commit('add'), ConflictError); await session.commit('fork'); } finally { await session.dispose(); } assert.equal(destination.catalog.snapshot!.packs.length, 2); assert.equal(byteFingerprint(await library.assetTree(pack)), byteFingerprint(original));
		const uriRoot = { ...root, uri: vscode.Uri.file(root.path).toString() }; await assert.rejects(PackImportSession.prepare(new Library(() => [uriRoot]), archive, uriRoot), /native/);
	}));
	test('archive/Compare entry points are registered and Pack details expose explicit actions', async () => {
		const commands = await vscode.commands.getCommands(true); for (const name of ['importPack', 'exportPack', 'compare']) { assert.ok(commands.includes('turbo-code-palette.' + name)); }
		await sandbox(async (library) => { await api.product.panel.details(library.catalog.snapshot!.packs[0], [], library.catalog.snapshot!.snippets, [], { favorite: false, usage: 0 }); assert.match(api.product.panel.instance!.webview.html, /data-action="exportPack"/); assert.match(api.product.panel.instance!.webview.html, /data-action="compare"/); api.product.panel.saved(); api.product.panel.dispose(); });
	});
});
