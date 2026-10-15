import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Phase0Api } from '../../extension';
import { CleanCopy, type CleanInteractions } from '../../application/cleanCopy';
import { Library } from '../../application/library';
import { CleanCopyTree } from '../../ui/cleanCopyTree';
import { markSource } from '../../language/sourceMarker';
import type { CleanPlan } from '../../core/clean/types';
import type { AssetLocation } from '../../storage/discovery';

const uuid = (n: number) => '55000000-0000-0000-0000-' + String(n).padStart(12, '0');
const io = (): CleanInteractions => ({ preset: async () => 'Readable', custom: async available => available.map(transform => transform.id), bundle: async () => undefined, warnings: async () => true, output: async () => 'clipboard', preview: async () => undefined, destination: async () => undefined, clipboard: async () => {}, untitled: async () => {} });
const captured = (editor: vscode.TextEditor) => ({ uri: editor.document.uri, version: editor.document.version, selection: editor.selection });

suite('Phase 5 — safe Clean Copy in a real Extension Host', () => {
	let api: Phase0Api;
	suiteSetup(async () => { api = await vscode.extensions.getExtension<Phase0Api>('oz-coden.turbo-code-palette')!.activate(); });
	async function sandbox(run: (library: Library, parent: string) => Promise<void>): Promise<void> {
		const base = path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, 'phase5-cases'); await fs.mkdir(base, { recursive: true }); const parent = await fs.mkdtemp(path.join(base, 'case-')), root = { scope: 'global' as const, path: path.join(parent, 'library') };
		try {
			await fs.mkdir(path.join(root.path, 'Pack'), { recursive: true }); await fs.writeFile(path.join(root.path, 'Pack/pack.json'), JSON.stringify({ formatVersion: 1, id: uuid(0), name: 'Pack', version: 'v1.0.0' }));
			for (const n of [1, 2]) { const directory = path.join(root.path, 'Pack', String(n)); await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'snippet.json'), JSON.stringify({ formatVersion: 1, id: uuid(n), name: 'Snippet-' + n, version: 'v1.0.0', sources: ['code.cs'], exports: [{ kind: 'type', name: 'Export' + n }], dependencies: n === 1 ? [{ id: uuid(2), name: 'Snippet-2' }] : [], licenseNotices: [{ text: 'Notice' }, { text: 'Notice' }] })); await fs.writeFile(path.join(directory, 'code.cs'), 'class Export' + n + ' {}\n'); }
			const library = new Library(() => [root]); await library.reload(); await run(library, parent);
		} finally { await vscode.commands.executeCommand('workbench.action.closeAllEditors'); assert.equal(path.dirname(parent), base); await fs.rm(parent, { recursive: true, force: true }); }
	}
	async function editor(content = 'first\nselected\nlast\n', language = 'csharp'): Promise<vscode.TextEditor> { const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content, language })); editor.selection = new vscode.Selection(1, 0, 1, 8); return editor; }
	const service = (library: Library, target: vscode.TextEditor, interactions: CleanInteractions, guard?: () => void) => new CleanCopy(library, () => captured(target), api.product.comparison, guard, interactions);

	test('native Clean Copy section and keyboard command expose all scopes without D&D', async () => {
		await vscode.commands.executeCommand('turbo-code-palette.cleanCopy.focus'); assert.ok((await vscode.commands.getCommands(true)).includes('turbo-code-palette.cleanCopy'));
		const tree = new CleanCopyTree(); assert.deepEqual(tree.getChildren(), ['selection', 'file', 'bundle']); for (const scope of tree.getChildren()) { assert.equal(tree.getTreeItem(scope).command!.command, 'turbo-code-palette.cleanCopy'); assert.deepEqual(tree.getTreeItem(scope).command!.arguments, [scope]); }
	});
	test('Selection and Current File use captured editor text and leave original/dirty/version and user state unchanged', async () => sandbox(async library => {
		const target = await editor(), before = target.document.getText(), version = target.document.version, dirty = target.document.isDirty, interactions = io(), copied: string[] = [], state = JSON.stringify(api.product.state.get('snippet:' + uuid(1) + ':v1.0.0')); interactions.clipboard = async text => { copied.push(text); };
		const clean = service(library, target, interactions); assert.equal(await clean.run('selection'), 'completed'); assert.equal(copied[0], 'selected'); assert.equal(await clean.run('file'), 'completed'); assert.equal(copied[1], before); assert.equal(target.document.getText(), before); assert.equal(target.document.version, version); assert.equal(target.document.isDirty, dirty); assert.equal(JSON.stringify(api.product.state.get('snippet:' + uuid(1) + ':v1.0.0')), state); clean.dispose();
	}));
	test('preview and Clipboard consume the same frozen final plan; native clipboard roundtrip restores prior clipboard', async () => sandbox(async library => {
		const target = await editor(), interactions = io(); let previewPlan: CleanPlan | undefined; interactions.output = async () => 'preview';
		interactions.preview = async plan => { previewPlan = plan; assert.equal(vscode.window.activeTextEditor!.document.uri.scheme, 'tcp-review'); assert.equal(vscode.window.activeTextEditor!.document.getText(), plan.text); return 'clipboard'; };
		const previous = await vscode.env.clipboard.readText(), clean = service(library, target, interactions); let written = '';
		interactions.clipboard = async text => { written = text; await vscode.env.clipboard.writeText(text); };
		try { await clean.run('selection'); assert.ok(await vscode.env.clipboard.readText() === 'selected', 'Native clipboard must contain final plan text'); assert.equal(clean.lastPlan, previewPlan); assert.equal(clean.lastPlan!.text, written); assert.ok(Object.isFrozen(clean.lastPlan)); assert.equal(target.document.getText(), 'first\nselected\nlast\n'); }
		finally { if (await vscode.env.clipboard.readText() === written) { await vscode.env.clipboard.writeText(previous); } clean.dispose(); }
	}));
	test('Preview → Untitled is an independent exact copy and never edits the original', async () => sandbox(async library => {
		const target = await editor(), interactions = io(), clean = service(library, target, interactions); let result: vscode.TextDocument | undefined; interactions.output = async () => 'preview'; interactions.preview = async plan => { assert.equal(vscode.window.activeTextEditor!.document.getText(), plan.text); return 'untitled'; }; interactions.untitled = async plan => { result = await clean.openUntitled(plan); };
		await clean.run('file'); assert.equal(result!.uri.scheme, 'untitled'); assert.notEqual(result!.uri.toString(), target.document.uri.toString()); assert.equal(result!.getText(), clean.lastPlan!.text); assert.equal(target.document.getText(), 'first\nselected\nlast\n'); clean.dispose();
	}));
	test('preview cancel, preset cancel, Custom cancel and Save As cancel call no output writer', async () => sandbox(async (library, parent) => {
		const target = await editor(); let writes = 0;
		for (const stage of ['preset', 'custom', 'preview', 'save'] as const) { const interactions = io(), clean = service(library, target, interactions); interactions.clipboard = async () => { writes++; }; interactions.untitled = async () => { writes++; }; if (stage === 'preset') { interactions.preset = async () => undefined; } if (stage === 'custom') { interactions.preset = async () => 'Custom'; interactions.custom = async () => undefined; } if (stage === 'preview') { interactions.output = async () => 'preview'; } if (stage === 'save') { interactions.output = async () => 'save'; } assert.equal(await clean.run('file'), 'cancelled'); clean.dispose(); }
		assert.equal(writes, 0); assert.deepEqual(await fs.readdir(parent), ['library']); assert.equal(target.document.getText(), 'first\nselected\nlast\n');
	}));
	test('document edit during input and edit during Preview reject stale plan before Clipboard or Save As', async () => sandbox(async (library, parent) => {
		for (const output of ['clipboard', 'save'] as const) { const target = await editor(), interactions = io(), clean = service(library, target, interactions); let writes = 0; interactions.output = async () => 'preview'; interactions.preview = async () => { const current = await vscode.window.showTextDocument(target.document, { preview: false }); await current.edit(builder => builder.insert(new vscode.Position(0, 0), 'USER EDIT\n')); return output; }; interactions.destination = async () => vscode.Uri.file(path.join(parent, 'stale.cs')); interactions.clipboard = async () => { writes++; }; await assert.rejects(clean.run('file'), /changed/); assert.equal(writes, 0); await assert.rejects(fs.stat(path.join(parent, 'stale.cs'))); assert.equal(target.document.getText(), 'USER EDIT\nfirst\nselected\nlast\n'); clean.dispose(); }
	}));
	test('source/library/alias destinations are refused and Preview → Save As writes exact final plan', async () => sandbox(async (library, parent) => {
		const source = path.join(parent, 'source.cs'); await fs.writeFile(source, 'ORIGINAL'); const target = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(source))), interactions = io(), clean = service(library, target, interactions); interactions.output = async () => 'save';
		for (const destination of [source, path.join(library.roots()[0].path, 'new.cs')]) { interactions.destination = async () => vscode.Uri.file(destination); await assert.rejects(clean.run('file'), /source|library/); }
		const alias = path.join(parent, 'alias.cs'); await fs.link(source, alias); interactions.destination = async () => vscode.Uri.file(alias); await assert.rejects(clean.run('file'), /Existing/);
		const output = path.join(parent, 'clean.cs'); interactions.output = async () => 'preview'; interactions.preview = async plan => { assert.equal(vscode.window.activeTextEditor!.document.getText(), plan.text); return 'save'; }; interactions.destination = async () => vscode.Uri.file(output); await clean.run('file'); assert.equal(await fs.readFile(output, 'utf8'), clean.lastPlan!.text); assert.equal(await fs.readFile(source, 'utf8'), 'ORIGINAL'); assert.equal(target.document.getText(), 'ORIGINAL'); clean.dispose();
	}));
	test('untitled projected source URI and non-file output provider cannot be used as Save As destinations', async () => sandbox(async (library, parent) => {
		const source = path.join(parent, 'projected.cs'), target = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.from({ scheme: 'untitled', path: vscode.Uri.file(source).path }))); await target.edit(builder => builder.insert(new vscode.Position(0, 0), 'ORIGINAL'));
		const interactions = io(), clean = service(library, target, interactions); interactions.output = async () => 'save'; interactions.destination = async () => vscode.Uri.file(source); await assert.rejects(clean.run('file'), /source/); await assert.rejects(fs.stat(source)); interactions.destination = async () => vscode.Uri.parse('private-clean:/copy.cs'); await assert.rejects(clean.run('file'), /native/); clean.dispose();
	}));
	test('marker removal retains full Selection context and license notices are deduplicated/reapplied safely', async () => sandbox(async library => {
		const marked = markSource({ id: uuid(1), version: 'v1.0.0' }, 'int VALUE = 1;\n', 'csharp', '', 0, 0, '\n')!, target = await editor(marked), interactions = io(), clean = service(library, target, interactions); let copied = ''; interactions.clipboard = async text => { copied = text; };
		await clean.run('file'); assert.equal(copied, '// Notice\n\nint VALUE = 1;\n\n'); assert.deepEqual(clean.lastPlan!.notices, ['Notice']); assert.ok(!copied.includes('TCP BEGIN')); assert.equal(target.document.getText(), marked);
		const start = marked.indexOf('int VALUE'); target.selection = new vscode.Selection(target.document.positionAt(start), target.document.positionAt(start + 14)); await clean.run('selection'); assert.deepEqual(clean.lastPlan!.notices, ['Notice']); assert.ok(copied.startsWith('// Notice\n'));
		const raw = 'var text = """\n' + marked + '""";\n', rawTarget = await editor(raw), retained = service(library, rawTarget, interactions); await retained.run('file'); assert.ok(retained.lastPlan!.text.includes(marked)); assert.ok(retained.lastPlan!.warnings.some(warning => warning.includes('retained'))); clean.dispose(); retained.dispose();
	}));
	test('unsupported language with known notices stops instead of adding another language comment', async () => sandbox(async library => {
		const asset = library.catalog.snapshot!.snippets[0], target = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(asset.root.path, asset.relativePath, 'code.cs')))); await vscode.languages.setTextDocumentLanguage(target.document, 'plaintext'); const interactions = io(), clean = service(library, target, interactions); let writes = 0; interactions.clipboard = async () => { writes++; }; await assert.rejects(clean.run('file'), /cannot be safely/); assert.equal(writes, 0); assert.equal(target.document.getText(), 'class Export1 {}\n'); clean.dispose();
	}));
	test('Bundle requires explicit roots, preserves metadata closure/notices, and exports review JSON without semantic merge', async () => sandbox(async library => {
		const target = await editor('var name = "Export1"; // ambiguous reference\n'), interactions = io(), clean = service(library, target, interactions); let candidateSeen = false, copied = ''; interactions.bundle = async candidates => { candidateSeen = true; assert.ok(candidates.length); assert.ok(candidates.every(candidate => !candidate.confirmed)); return [library.catalog.snapshot!.snippets.find(asset => asset.metadata.id === uuid(1))!]; }; interactions.clipboard = async text => { copied = text; };
		await clean.run('bundle'); assert.ok(candidateSeen); const review = JSON.parse(copied); assert.equal(review.executable, false); assert.equal(review.files[0].text, target.document.getText()); assert.deepEqual(review.files.slice(1).map((file: { asset: { id: string } }) => file.asset.id), [uuid(2), uuid(1)]); assert.deepEqual(review.licenseNotices, ['Notice']); assert.equal(clean.lastPlan!.language, 'json'); assert.ok(clean.lastPlan!.warnings.some(warning => warning.includes('unresolved'))); clean.dispose();
	}));
	test('Custom only lists transforms available to all Bundle source providers; unsupported transform cannot silently fallback', async () => sandbox(async library => {
		const target = await editor('text', 'plaintext'), interactions = io(), clean = service(library, target, interactions); let writes = 0; interactions.preset = async () => 'Custom'; interactions.custom = async available => { assert.equal(available.length, 0); return ['remove-comments']; }; interactions.clipboard = async () => { writes++; }; await assert.rejects(clean.run('file'), /Unavailable/); assert.equal(writes, 0); clean.dispose();
	}));
	test('source edit during preset, provider replacement during preview and empty Selection stop before output', async () => sandbox(async library => {
		const target = await editor(), interactions = io(), clean = service(library, target, interactions); let writes = 0; interactions.clipboard = async () => { writes++; };
		interactions.preset = async () => { await target.edit(builder => builder.insert(new vscode.Position(0, 0), 'USER\n')); return 'Readable'; }; await assert.rejects(clean.run('file'), /changed/);
		interactions.preset = async () => 'Readable'; interactions.output = async () => 'preview'; let registration: { dispose(): void } | undefined;
		interactions.preview = async () => { registration = clean.providers.register('csharp', clean.providers.get('csharp')); return 'clipboard'; }; await assert.rejects(clean.run('file'), /provider changed/); registration!.dispose();
		const current = await vscode.window.showTextDocument(target.document, { preview: false }); current.selection = new vscode.Selection(0, 0, 0, 0); await assert.rejects(clean.run('selection', captured(current)), /Select text/); assert.equal(writes, 0); clean.dispose();
	}));
	test('asset edits, explicit Reload and root guard changes after preview prevent output and leave user edits untouched', async () => sandbox(async library => {
		for (const action of ['asset', 'reload', 'root'] as const) { const target = await editor('Export1'), interactions = io(); let rootChanged = false, writes = 0; const clean = service(library, target, interactions, () => { if (rootChanged) { throw new Error('root changed'); } }); interactions.bundle = async () => [library.catalog.snapshot!.snippets.find(asset => asset.metadata.id === uuid(1))!]; interactions.output = async () => 'preview'; interactions.preview = async () => { if (action === 'asset') { const asset = library.catalog.snapshot!.snippets[0]; await fs.writeFile(path.join(asset.root.path, asset.relativePath, 'code.cs'), 'EXTERNAL EDIT'); } else if (action === 'reload') { await library.reload(); } else { rootChanged = true; } return 'clipboard'; }; interactions.clipboard = async () => { writes++; }; await assert.rejects(clean.run('bundle'), /changed/); assert.equal(writes, 0); assert.equal(target.document.getText(), 'Export1'); clean.dispose(); await library.reload(); }
	}));
	test('warning cancellation, output failure and reentrancy never record usage or mutate source', async () => sandbox(async library => {
		const target = await editor('var text = `\n// TCP BEGIN malformed\n`;\n'), interactions = io(), clean = service(library, target, interactions); let writes = 0; interactions.warnings = async () => false; interactions.clipboard = async () => { writes++; }; assert.equal(await clean.run('file'), 'cancelled'); assert.equal(writes, 0);
		interactions.warnings = async () => true; interactions.clipboard = async () => { throw new Error('clipboard rejected'); }; await assert.rejects(clean.run('file'), /clipboard rejected/); assert.equal(target.document.getText(), 'var text = `\n// TCP BEGIN malformed\n`;\n');
		interactions.preset = async () => { await assert.rejects(clean.run('file'), /active/); return undefined; }; assert.equal(await clean.run('file'), 'cancelled'); clean.dispose();
	}));
});
