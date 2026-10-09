import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Library, locationKey } from '../../application/library';
import { UserState } from '../../application/userState';
import { InsertionPipeline, type InsertionInteractions } from '../../application/insertionPipeline';
import { applyFiles } from '../../application/fileInsertion';
import type { AssetLocation } from '../../storage/discovery';
import type { InsertRequest } from '../../application/insertionAdapter';
import type { Phase0Api } from '../../extension';
import { vscodeStore } from '../../storage/vscodeStore';

const uuid = (n: number) => '30000000-0000-0000-0000-' + String(n).padStart(12, '0');
interface Definition { n: number; sources?: Record<string, string>; fields?: Record<string, unknown>; deps?: number[] }
const interactions = (): InsertionInteractions => ({ input: async (_, variable) => variable.defaultValue ?? 'VALUE', mode: async (_, available) => available[0], output: async () => undefined, preview: async () => true, warnings: async () => true });
async function editor(text = 'before\n\nafter\n', language = 'plaintext'): Promise<vscode.TextEditor> { const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: text, language })); editor.selection = new vscode.Selection(1, 0, 1, 0); return editor; }
const request = (asset: AssetLocation, editor: vscode.TextEditor, mode?: InsertRequest['mode']): InsertRequest => ({ asset, mode, target: { uri: editor.document.uri, version: editor.document.version, selection: editor.selection } });
const key = (asset: AssetLocation) => `snippet:${asset.metadata.id}:${asset.metadata.version!.text}`;

suite('Phase 3 — one insertion pipeline in a real Extension Host', () => {
	let api: Phase0Api;
	suiteSetup(async () => { api = await vscode.extensions.getExtension<Phase0Api>('oz-coden.turbo-code-palette')!.activate(); });
	async function sandbox(definitions: Definition[], run: (library: Library, state: UserState, parent: string) => Promise<void>): Promise<void> {
		const workspace = vscode.workspace.workspaceFolders?.[0]; assert.ok(workspace, 'Host runner supplies an isolated native workspace');
		const base = path.join(workspace.uri.fsPath, 'phase3-cases'); await fs.mkdir(base, { recursive: true }); const parent = await fs.mkdtemp(path.join(base, 'case-')), root = { scope: 'global' as const, path: path.join(parent, 'library') };
		try {
			await fs.mkdir(path.join(root.path, 'Pack'), { recursive: true }); await fs.writeFile(path.join(root.path, 'Pack/pack.json'), JSON.stringify({ formatVersion: 1, id: uuid(0), name: 'Pack', version: 'v1.0.0' }));
			for (const definition of definitions) {
				const directory = path.join(root.path, 'Pack', String(definition.n)), sources = definition.sources ?? { 'code.txt': `BODY_${definition.n}` }; await fs.mkdir(directory, { recursive: true });
				await fs.writeFile(path.join(directory, 'snippet.json'), JSON.stringify({ formatVersion: 1, id: uuid(definition.n), name: `Snippet-${definition.n}`, version: 'v1.0.0', sources: Object.keys(sources), dependencies: definition.deps?.map(n => ({ id: uuid(n), name: `Snippet-${n}` })), ...definition.fields }));
				for (const [name, content] of Object.entries(sources)) { await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await fs.writeFile(path.join(directory, name), content); }
			}
			const library = new Library(() => [root]); await library.reload();
			const data = new Map<string, unknown>(), state = new UserState({ get: <T>(name: string, fallback: T) => (data.get(name) ?? fallback) as T, update: async (name, value) => { data.set(name, value); } }); await run(library, state, parent);
		} finally { await vscode.commands.executeCommand('workbench.action.closeAllEditors'); assert.equal(path.dirname(parent), base); await fs.rm(parent, { recursive: true, force: true }); }
	}
	test('recursive diamond dependencies use a stable dependency-first batch and one Undo; repeat insertion skips verified implementations', async () => {
		await sandbox([{ n: 1, deps: [2, 3] }, { n: 2, deps: [4] }, { n: 3, deps: [4] }, { n: 4 }], async (library, state) => {
			const pipeline = new InsertionPipeline(library, state, undefined, interactions()), root = library.catalog.snapshot!.snippets.find(a => a.metadata.id === uuid(1))!, target = await editor(), before = target.document.getText();
			assert.equal(await pipeline.run(request(root, target)), 'inserted'); assert.equal(target.document.getText(), 'before\nBODY_4\nBODY_2\nBODY_3\nBODY_1\nafter\n'); assert.equal(state.get(key(root)).usage, 1);
			assert.equal(await pipeline.run(request(root, target)), 'already-present'); assert.equal(state.get(key(root)).usage, 1); await vscode.commands.executeCommand('undo'); assert.equal(target.document.getText(), before);
			assert.equal(await pipeline.run(request(root, target)), 'inserted'); assert.equal(state.get(key(root)).usage, 2); pipeline.dispose();
		});
	});
	test('cycle SCC members are inserted once in UUID order and one Undo restores the document', async () => {
		await sandbox([{ n: 2, deps: [1] }, { n: 1, deps: [2] }], async (library, state) => { const pipeline = new InsertionPipeline(library, state, undefined, interactions()), target = await editor(), before = target.document.getText(); await pipeline.run(request(library.catalog.snapshot!.snippets[0], target)); assert.equal(target.document.getText(), 'before\nBODY_1\nBODY_2\nafter\n'); await vscode.commands.executeCommand('undo'); assert.equal(target.document.getText(), before); });
	});
	test('templates collect one value across multiple sources, respect definitions/options/default and preserve literal replacement', async () => {
		await sandbox([{ n: 1, sources: { 'one.txt': '{{TYPE}} {{EXTRA}}', 'two.txt': '{{TYPE}} {{EXTRA}}' }, fields: { templateVariables: [{ name: 'TYPE', default: 'long', required: false, description: 'Element type', options: ['int', 'long'] }] } }], async (library, state) => {
			const io = interactions(), seen: string[] = []; io.input = async (_, variable) => { seen.push(variable.name); if (variable.name === 'TYPE') { assert.equal(variable.defaultValue, 'long'); assert.deepEqual(variable.options, ['int', 'long']); } return variable.defaultValue ?? '$& $1 \\'; };
			const pipeline = new InsertionPipeline(library, state, undefined, io), target = await editor(); await pipeline.run(request(library.catalog.snapshot!.snippets[0], target, 'merge-sources')); assert.deepEqual(seen, ['EXTRA', 'TYPE']); assert.match(target.document.getText(), /long \$& \$1 \\/); await vscode.commands.executeCommand('undo'); assert.equal(target.document.getText(), 'before\n\nafter\n');
		});
	});
	test('cursor, EOF, replace-selection and merge-sources all apply through the same pipeline with one Undo', async () => {
		await sandbox([{ n: 1, sources: { 'one.txt': 'ONE', 'two.txt': 'TWO' } }], async (library, state) => {
			const pipeline = new InsertionPipeline(library, state, undefined, interactions()), asset = library.catalog.snapshot!.snippets[0];
			for (const mode of ['cursor', 'end-of-file', 'replace-selection', 'merge-sources'] as const) {
				const target = await editor('alpha\nbeta\n'); target.selection = new vscode.Selection(1, 0, 1, 4); const before = target.document.getText(); await pipeline.run(request(asset, target, mode));
				assert.equal(target.document.getText(), mode === 'end-of-file' ? 'alpha\nbeta\nONE\nTWO' : mode === 'replace-selection' ? 'alpha\nONE\nTWO\n' : 'alpha\nbetaONE\nTWO\n'); await vscode.commands.executeCommand('undo'); assert.equal(target.document.getText(), before);
			}
		});
	});
	test('structure-aware uses only the reliable plaintext file target and unsupported C# requires explicit alternative selection', async () => {
		await sandbox([{ n: 1, fields: { insert: { defaultMode: 'structure-aware', targets: ['file'], allowedModes: ['structure-aware', 'end-of-file'] } } }], async (library, state) => {
			const io = interactions(); let choices = 0; io.mode = async (_, available) => { choices++; assert.deepEqual(available, ['end-of-file']); return 'end-of-file'; }; const pipeline = new InsertionPipeline(library, state, undefined, io), asset = library.catalog.snapshot!.snippets[0];
			const plain = await editor(); await pipeline.run(request(asset, plain)); assert.equal(choices, 0); assert.ok(plain.document.getText().endsWith('BODY_1'));
			const csharp = await editor('class Target {}\n', 'csharp'); await pipeline.run(request(asset, csharp)); assert.equal(choices, 1); assert.ok(csharp.document.getText().endsWith('BODY_1'));
		});
	});
	test('cancelled input and unavailable/denied modes change no target or user state', async () => {
		await sandbox([{ n: 1, sources: { 'code.txt': '{{NAME}}' }, fields: { insert: { allowedModes: ['cursor'], deniedModes: ['cursor'] } } }], async (library, state) => {
			const io = interactions(); io.input = async () => undefined; const pipeline = new InsertionPipeline(library, state, undefined, io), asset = library.catalog.snapshot!.snippets[0], target = await editor(), before = target.document.getText();
			assert.equal(await pipeline.run(request(asset, target)), 'cancelled'); assert.equal(state.get(key(asset)).usage, 0); assert.equal(state.get(key(asset)).recent, 0); assert.equal(target.document.getText(), before);
			io.input = async () => 'value'; await assert.rejects(pipeline.run(request(asset, target)), /No available/); assert.equal(target.document.getText(), before); assert.equal(state.get(key(asset)).usage, 0);
		});
	});
	test('document edits during template input cause stale rejection and preserve the user edit without inserting partial dependencies', async () => {
		await sandbox([{ n: 1, deps: [2], sources: { 'code.txt': '{{NAME}}' } }, { n: 2 }], async (library, state) => {
			const target = await editor(), io = interactions(); io.input = async () => { await target.edit(builder => builder.insert(new vscode.Position(0, 0), 'USER_EDIT\n')); return 'value'; };
			const pipeline = new InsertionPipeline(library, state, undefined, io); await assert.rejects(pipeline.run(request(library.catalog.snapshot!.snippets[0], target)), /stale|changed/); assert.equal(target.document.getText(), 'USER_EDIT\nbefore\n\nafter\n'); assert.equal(state.get(key(library.catalog.snapshot!.snippets[1])).usage, 0);
		});
	});
	test('asset changes and explicit catalog Reload during input are rejected before apply', async () => {
		await sandbox([{ n: 1, sources: { 'code.txt': '{{NAME}}' } }], async (library, state) => {
			let asset = library.catalog.snapshot!.snippets[0]; const target = await editor(), before = target.document.getText(), io = interactions(); io.input = async () => { await fs.writeFile(path.join(asset.root.path, asset.relativePath, 'code.txt'), 'EXTERNAL'); return 'value'; };
			const pipeline = new InsertionPipeline(library, state, undefined, io); await assert.rejects(pipeline.run(request(asset, target)), /changed/); assert.equal(target.document.getText(), before);
			await fs.writeFile(path.join(asset.root.path, asset.relativePath, 'code.txt'), '{{NAME}}'); await library.reload(); asset = library.catalog.snapshot!.snippets[0]; io.input = async () => { await library.reload(); return 'value'; }; await assert.rejects(pipeline.run(request(asset, target)), /Catalog\/root changed/); assert.equal(target.document.getText(), before); assert.equal(state.get(key(asset)).usage, 0);
		});
	});
	test('preview cancellation keeps target and user state unchanged; stale preview target never applies', async () => {
		await sandbox([{ n: 1 }], async (library, state) => {
			const config = vscode.workspace.getConfiguration('turboCodePalette'), previous = config.inspect<boolean>('previewBeforeInsert')?.globalValue; await config.update('previewBeforeInsert', true, vscode.ConfigurationTarget.Global);
			try { const io = interactions(), target = await editor(), before = target.document.getText(), asset = library.catalog.snapshot!.snippets[0]; io.preview = async plan => { assert.equal(target.document.getText(), before); assert.match(plan.after, /BODY_1/); return false; }; const pipeline = new InsertionPipeline(library, state, undefined, io); assert.equal(await pipeline.run(request(asset, target)), 'cancelled'); assert.equal(state.get(key(asset)).recent, 0);
				io.preview = async () => { await target.edit(builder => builder.insert(new vscode.Position(0, 0), 'USER\n')); return true; }; await assert.rejects(pipeline.run(request(asset, target)), /stale|changed/); assert.equal(target.document.getText(), 'USER\n' + before);
			} finally { await config.update('previewBeforeInsert', previous, vscode.ConfigurationTarget.Global); }
		});
	});
	test('missing Pack dependency, same-revision content conflict, declared symbol collision and ambiguous raw implementation all stop', async () => {
		await sandbox([{ n: 1, deps: [2] }], async (library, state) => { const target = await editor(), pipeline = new InsertionPipeline(library, state, undefined, interactions()); await assert.rejects(pipeline.run(request(library.catalog.snapshot!.snippets[0], target)), /No unambiguous/); assert.equal(target.document.getText(), 'before\n\nafter\n'); });
		await sandbox([{ n: 1, fields: { exports: [{ name: 'ExistingName', kind: 'class' }] } }], async (library, state) => {
			const pipeline = new InsertionPipeline(library, state, undefined, interactions()), asset = library.catalog.snapshot!.snippets[0]; await assert.rejects(pipeline.run(request(asset, await editor('ExistingName\n'))), /collision/); await assert.rejects(pipeline.run(request(asset, await editor('BODY_1\n'))), /Ambiguous/);
			await fs.cp(path.join(asset.root.path, 'Pack'), path.join(asset.root.path, 'Other'), { recursive: true }); await fs.writeFile(path.join(asset.root.path, 'Other/1/code.txt'), 'DIFFERENT'); await library.reload(); await assert.rejects(pipeline.run(request(library.catalog.snapshot!.snippets[0], await editor())), /different content/);
		});
	});
	test('separate-files publishes the whole native folder, never overwrites, preserves target text, and is outside editor Undo', async () => {
		await sandbox([{ n: 1, sources: { 'one.txt': '{{NAME}}', 'nested/two.txt': '{{NAME}}' } }], async (library, state, parent) => {
			const io = interactions(); io.output = async () => ({ parent, folder: 'Output' }); const pipeline = new InsertionPipeline(library, state, undefined, io), target = await editor(), before = target.document.getText(), asset = library.catalog.snapshot!.snippets[0];
			assert.equal(await pipeline.run(request(asset, target, 'separate-files')), 'inserted'); assert.equal(await fs.readFile(path.join(parent, 'Output/nested/two.txt'), 'utf8'), 'VALUE'); assert.equal(target.document.getText(), before); assert.equal(state.get(key(asset)).usage, 1);
			await vscode.commands.executeCommand('undo'); assert.equal(await fs.readFile(path.join(parent, 'Output/one.txt'), 'utf8'), 'VALUE'); await assert.rejects(pipeline.run(request(asset, target, 'separate-files')), /already exists/); assert.equal(state.get(key(asset)).usage, 1);
			await assert.rejects(applyFiles({ parent, folder: 'Failed', files: new Map([['one', '1'], ['two', '2']]) }, async () => {}, async index => { if (index === 1) { throw new Error('injected write failure'); } }), /injected/); assert.equal((await fs.readdir(parent)).some(name => name.startsWith('.tcp-insert-') || name === 'Failed'), false);
		});
	});
	test('private URI libraries remain ineligible; mixed file/text dependency plans are refused with no output', async () => {
		await sandbox([{ n: 1, deps: [2], fields: { insert: { defaultMode: 'separate-files' } } }, { n: 2 }], async (library, state, parent) => {
			const target = await editor(), pipeline = new InsertionPipeline(library, state, undefined, interactions()); await assert.rejects(pipeline.run(request(library.catalog.snapshot!.snippets[0], target)), /Mixed/); assert.equal(target.document.getText(), 'before\n\nafter\n');
			const uri = vscode.Uri.file(library.roots()[0].path), root = { scope: 'global' as const, path: uri.toString(), uri: uri.toString() }, uriLibrary = new Library(() => [root], () => vscodeStore(uri)); await uriLibrary.reload(); await assert.rejects(new InsertionPipeline(uriLibrary, state, undefined, interactions()).run(request(uriLibrary.catalog.snapshot!.snippets[0], target)), /not eligible/); assert.equal((await fs.readdir(parent)).length, 1);
		});
	});
	test('all product entrances use the installed adapter handler, retain the pre-selection target and one Undo per insertion', async () => {
		await sandbox([{ n: 1 }], async (library) => {
			const config = vscode.workspace.getConfiguration('turboCodePalette'), previous = config.inspect<string>('globalRoot')?.globalValue; await config.update('globalRoot', library.roots()[0].path, vscode.ConfigurationTarget.Global); await api.product.reload();
			try {
				const asset = api.catalog.snapshot!.snippets[0], location = locationKey(asset), row = api.product.snippets.getChildren()[0]; assert.equal(api.product.snippets.getTreeItem(row).contextValue, 'tcp.snippet');
				const handler = api.product.insertion.handler, modeTarget = await editor();
				try { api.product.insertion.handler = async captured => { assert.equal(captured.mode, 'choose'); assert.equal(captured.target?.uri.toString(), modeTarget.document.uri.toString()); }; await vscode.commands.executeCommand('turbo-code-palette.insertWithMode', location); assert.equal(modeTarget.document.getText(), 'before\n\nafter\n'); } finally { api.product.insertion.handler = handler; }
				for (const entrance of ['inline/context', 'pack', 'command'] as const) { const target = await editor(), before = target.document.getText();
					if (entrance === 'pack') { await api.product.showDetails(api.catalog.snapshot!.packs[0]); await api.product.panel.accept({ token: api.product.panel.session, action: 'insert', key: location }); }
					else { await vscode.commands.executeCommand('turbo-code-palette.insert', entrance === 'command' ? row.key : location); }
					assert.equal(target.document.getText(), 'before\nBODY_1\nafter\n'); assert.equal(api.product.insertion.lastRequest?.target?.uri.toString(), target.document.uri.toString()); assert.equal(api.product.pipeline.lastPlan?.assets[0].metadata.id, asset.metadata.id); await vscode.commands.executeCommand('undo'); assert.equal(target.document.getText(), before);
				}
			} finally { api.product.panel.saved(); api.product.panel.dispose(); await config.update('globalRoot', previous, vscode.ConfigurationTarget.Global); await api.product.reload(); }
		});
	});
	test('already-inserted dependencies are skipped only for verified state; edited implementations stop rather than duplicating', async () => {
		await sandbox([{ n: 1, deps: [2] }, { n: 2 }], async (library, state) => {
			const io = interactions(), pipeline = new InsertionPipeline(library, state, undefined, io), target = await editor(), root = library.catalog.snapshot!.snippets[0], dependency = library.catalog.snapshot!.snippets[1];
			await pipeline.run(request(dependency, target)); target.selection = new vscode.Selection(target.document.positionAt(target.document.getText().length), target.document.positionAt(target.document.getText().length));
			await pipeline.run(request(root, target)); assert.equal(pipeline.lastPlan?.skipped.length, 1); assert.equal(state.get(key(dependency)).usage, 1); assert.equal(target.document.getText().split('BODY_2').length - 1, 1);
			await target.edit(builder => builder.insert(new vscode.Position(1, 3), '_EDIT_')); const before = target.document.getText(); await assert.rejects(pipeline.run(request(root, target)), /cannot be verified/); assert.equal(target.document.getText(), before); assert.equal(state.get(key(root)).usage, 1);
		});
	});
	test('same template name in different Snippets stays independent and cancel/invalid options never apply a partial batch', async () => {
		await sandbox([{ n: 1, deps: [2], sources: { 'code.txt': 'ROOT_{{NAME}}' } }, { n: 2, sources: { 'code.txt': 'DEP_{{NAME}}' }, fields: { templateVariables: [{ name: 'NAME', required: true, options: ['DEP'] }] } }], async (library, state) => {
			const io = interactions(), target = await editor(), seen: string[] = []; io.input = async (asset, variable) => { assert.equal(variable.name, 'NAME'); seen.push(asset.metadata.name!); return asset.metadata.id === uuid(2) ? 'DEP' : 'ROOT'; }; const pipeline = new InsertionPipeline(library, state, undefined, io), root = library.catalog.snapshot!.snippets[0];
			await pipeline.run(request(root, target)); assert.deepEqual(seen, ['Snippet-2', 'Snippet-1']); assert.match(target.document.getText(), /DEP_DEP\nROOT_ROOT/); await vscode.commands.executeCommand('undo'); const before = target.document.getText();
			io.input = async () => 'INVALID'; await assert.rejects(pipeline.run(request(root, target)), /Invalid value/); assert.equal(target.document.getText(), before); assert.equal(state.get(key(root)).usage, 1);
		});
	});
	test('explicit mode selection cancellation, output selection cancellation and changing root guard leave no changes', async () => {
		await sandbox([{ n: 1, sources: { 'code.txt': '{{NAME}}' } }], async (library, state, parent) => {
			const io = interactions(), target = await editor(), before = target.document.getText(), root = library.catalog.snapshot!.snippets[0]; io.mode = async (_, available) => { assert.ok(available.includes('cursor')); return undefined; }; let stale = false;
			const pipeline = new InsertionPipeline(library, state, () => { if (stale) { throw new Error('root guard changed'); } }, io);
			assert.equal(await pipeline.run(request(root, target, 'choose')), 'cancelled'); assert.equal(await pipeline.run(request(root, target, 'separate-files')), 'cancelled');
			io.input = async () => { stale = true; return 'value'; }; await assert.rejects(pipeline.run(request(root, target)), /root guard changed/); assert.equal(target.document.getText(), before); assert.equal(state.get(key(root)).usage, 0); assert.equal(state.get(key(root)).recent, 0); assert.deepEqual(await fs.readdir(parent), ['library']);
		});
	});
	test('an unrelated insertion after a user edit does not erase ambiguity about a previously inserted dependency', async () => {
		await sandbox([{ n: 1, deps: [2] }, { n: 2 }, { n: 3 }], async (library, state) => {
			const pipeline = new InsertionPipeline(library, state, undefined, interactions()), target = await editor(), [root, dependency, unrelated] = library.catalog.snapshot!.snippets;
			await pipeline.run(request(dependency, target)); await target.edit(builder => builder.insert(new vscode.Position(1, 3), '_EDIT_')); target.selection = new vscode.Selection(target.document.positionAt(target.document.getText().length), target.document.positionAt(target.document.getText().length));
			await pipeline.run(request(unrelated, target)); const before = target.document.getText(); await assert.rejects(pipeline.run(request(root, target)), /changed or cannot be verified/); assert.equal(target.document.getText(), before); assert.equal(state.get(key(root)).usage, 0);
		});
	});
	test('a verified existing dependency at another compatible version satisfies every constraint without reinsertion', async () => {
		await sandbox([{ n: 1, fields: { dependencies: [{ id: uuid(2), name: 'Snippet-2', version: '>=v1.0.0 <v3.0.0' }] } }, { n: 2, sources: { 'code.txt': 'VERSION_ONE' } }], async (library, state) => {
			const original = library.catalog.snapshot!.snippets[1], other = path.join(original.root.path, 'Other'); await fs.cp(path.join(original.root.path, 'Pack'), other, { recursive: true }); await fs.rm(path.join(other, '1'), { recursive: true });
			const metadata = JSON.parse(await fs.readFile(path.join(other, '2/snippet.json'), 'utf8')); metadata.version = 'v2.0.0'; await fs.writeFile(path.join(other, '2/snippet.json'), JSON.stringify(metadata)); await fs.writeFile(path.join(other, '2/code.txt'), 'VERSION_TWO'); await library.reload();
			const root = library.catalog.snapshot!.snippets.find(asset => asset.metadata.id === uuid(1))!, newer = library.catalog.snapshot!.snippets.find(asset => asset.metadata.version!.text === 'v2.0.0')!, target = await editor(), pipeline = new InsertionPipeline(library, state, undefined, interactions());
			await pipeline.run(request(newer, target)); target.selection = new vscode.Selection(target.document.positionAt(target.document.getText().length), target.document.positionAt(target.document.getText().length)); await pipeline.run(request(root, target)); assert.equal(pipeline.lastPlan?.skipped[0].metadata.id, uuid(2)); assert.equal(target.document.getText().includes('VERSION_ONE'), false); assert.equal(target.document.getText().split('VERSION_TWO').length - 1, 1); assert.equal(state.get(key(original)).usage, 0);
		});
	});
});
