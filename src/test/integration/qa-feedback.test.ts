import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import type { Phase0Api } from '../../extension';
import { Library, locationKey } from '../../application/library';
import { UserState } from '../../application/userState';
import { InsertionPipeline, type InsertionInteractions } from '../../application/insertionPipeline';
import { CSharpProvider } from '../../language/csharpProvider';
import { CSharpClient } from '../../language/csharpClient';
import { undoOnce } from '../editorUndo';
import type { SearchPickerItem } from '../../ui/searchPicker';
import { CleanCopy, type CleanInteractions } from '../../application/cleanCopy';

const id = (n: number) => '73000000-0000-4000-8000-' + String(n).padStart(12, '0');
const capture = (editor: vscode.TextEditor) => ({ uri: editor.document.uri, version: editor.document.version, selection: editor.selection });
const io = (): InsertionInteractions => ({ input: async (_, variable) => variable.defaultValue ?? '1', mode: async (_, available) => available[0], preview: async () => true, output: async () => undefined, warnings: async () => true });
const dll = path.resolve(__dirname, '../../..', 'csharp/Tcp.CSharp/bin/Release/net10.0/Tcp.CSharp.dll');
async function waitFor(check: () => boolean, reason: string): Promise<void> {
	const limit = Date.now() + 5000;
	while (!check() && Date.now() < limit) { await new Promise(resolve => setTimeout(resolve, 25)); }
	assert.ok(check(), reason);
}

suite('Manual QA feedback — public UI integration and insertion receipt regressions', () => {
	let api: Phase0Api, folder: string, previous: string | undefined;
	const config = vscode.workspace.getConfiguration('turboCodePalette');
	suiteSetup(async () => {
		api = await vscode.extensions.getExtension<Phase0Api>('oz-coden.turbo-code-palette')!.activate();
		const base = path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, 'qa-feedback-host'); await fs.mkdir(base, { recursive: true }); folder = await fs.mkdtemp(path.join(base, 'case-'));
		await fs.cp(path.resolve(__dirname, '../../../qa/fixtures/library'), path.join(folder, 'ui'), { recursive: true });
		previous = config.inspect<string>('globalRoot')?.globalValue; await config.update('globalRoot', path.join(folder, 'ui'), vscode.ConfigurationTarget.Global); await api.product.reload();
	});
	suiteTeardown(async () => {
		api.product.panel.saved(); api.product.panel.dispose(); await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await config.update('globalRoot', previous, vscode.ConfigurationTarget.Global); await api.product.reload();
		assert.equal(path.basename(path.dirname(folder)), 'qa-feedback-host'); await fs.rm(folder, { recursive: true, force: true });
	});
	test('native Quick Pick keeps Apply visible for free text and appends independent filters', async () => {
		const create = vscode.window.createQuickPick; let pick: vscode.QuickPick<SearchPickerItem> | undefined;
		vscode.window.createQuickPick = (() => { pick = create<SearchPickerItem>(); return pick; }) as typeof create;
		try {
			await vscode.commands.executeCommand('turbo-code-palette.searchCatalog'); assert.ok(pick);
			pick.value = 'Greeting';
			await waitFor(() => pick!.items[0]?.query === 'Greeting' && pick!.activeItems.some(item => item.action === 'apply'), 'native input change reaches the TCP query model and active Apply');
			assert.equal(pick.items[0].label, 'Apply filter (2 items)'); assert.equal(pick.items[0].alwaysShow, true);
			assert.ok(pick.activeItems.some(item => item.action === 'apply'), 'Apply remains an active visible native item despite nonmatching label');
			pick.activeItems = [pick.items[0]]; await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
			await waitFor(() => api.product.snippets.query === 'Greeting', 'native Apply acceptance updates the sidebar filter');
			assert.equal(api.product.snippets.query, 'Greeting'); assert.equal(api.product.snippets.getChildren().length, 2);
		} finally { vscode.window.createQuickPick = create; pick?.hide(); api.product.snippets.query = ''; api.product.refresh(); }
	});
	test('dependency candidates exclude self UUID across locations; Pack member search still includes it', async () => {
		const asset = api.catalog.snapshot!.snippets.find(asset => asset.metadata.name === 'QA Greeting')!; await api.product.edit(asset);
		const post = api.product.panel.post; const messages: Record<string, unknown>[] = []; api.product.panel.post = message => { messages.push(message as Record<string, unknown>); };
		try {
			await api.product.panel.accept({ token: api.product.panel.session, action: 'searchDependencies', query: '' });
			const rows = messages.at(-1)!.items as { id: string }[]; assert.ok(rows.length); assert.ok(rows.every(row => row.id !== asset.metadata.id));
			await api.product.panel.accept({ token: api.product.panel.session, action: 'searchMembers', query: 'Greeting' });
			assert.ok((messages.at(-1)!.items as { id: string }[]).some(row => row.id === asset.metadata.id));
		} finally { api.product.panel.post = post; await api.product.panel.accept({ token: api.product.panel.session, action: 'cancel' }); }
	});
	test('deleting an unrelated asset preserves the dirty form/token; deleting that form can be cancelled', async () => {
		const a = api.catalog.snapshot!.snippets.find(asset => asset.metadata.name === 'QA Greeting')!, b = api.catalog.snapshot!.snippets.find(asset => asset.metadata.name === 'QA HTML Card')!;
		await api.product.edit(a); const token = api.product.panel.session, panel = api.product.panel.instance;
		await api.product.panel.accept({ token, action: 'dirty' }); await api.product.delete(locationKey(b), async () => true);
		assert.equal(api.product.panel.instance, panel); assert.equal(api.product.panel.session, token); assert.equal(api.product.panel.current?.asset, a);
		const confirm = api.product.panel.confirmDiscard; api.product.panel.confirmDiscard = async () => false;
		try { await api.product.delete(locationKey(a), async () => true); assert.ok(api.catalog.snapshot!.snippets.some(asset => asset.metadata.id === a.metadata.id)); assert.equal(api.product.panel.session, token); }
		finally { api.product.panel.confirmDiscard = confirm; await api.product.panel.accept({ token, action: 'cancel' }); }
	});
	test('New explains its empty source inline; details read beyond three lines and offer normal editor source access', async () => {
		await api.product.panel.form({ kind: 'snippet', emptySource: true }); assert.match(api.product.panel.instance!.webview.html, /creates an empty source file/); await api.product.panel.accept({ token: api.product.panel.session, action: 'cancel' });
		const root = api.product.library.roots().find(root => root.scope === 'global')!;
		const uuid = await api.product.library.createSnippet(root, { fields: { name: 'Preview five lines', version: 'v1.0.0' }, sourceName: 'code.txt', bytes: Buffer.from('one\ntwo\nthree\nfour\nfifth_unique_preview_line\n') });
		const asset = api.catalog.snapshot!.snippets.find(asset => asset.metadata.id === uuid)!; await api.product.showDetails(asset);
		assert.match(api.product.panel.instance!.webview.html, /fifth_unique_preview_line/); assert.match(api.product.panel.instance!.webview.html, /Open source in editor/);
	});
	test('plain JS markers after ordinary comments are removed; final preview/copy match and preview cancel writes nothing', async () => {
		const root = api.product.library.roots().find(root => root.scope === 'global')!;
		const uuid = await api.product.library.createSnippet(root, { fields: { name: 'Clean marker proof', version: 'v1.0.0', languages: ['javascript'] }, sourceName: 'code.js', bytes: Buffer.from('let markerValue = 1;\n') });
		const asset = api.catalog.snapshot!.snippets.find(asset => asset.metadata.id === uuid)!;
		const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: '// ordinary comment\n', language: 'javascript' }));
		editor.selection = new vscode.Selection(1, 0, 1, 0);
		await api.product.pipeline.run({ asset, target: capture(editor), options: { identityMarkers: true } });
		const original = editor.document.getText(); assert.match(original, /TCP BEGIN/);
		let copies = 0, copied = '', preview = '';
		const interactions: CleanInteractions = { preset: async () => 'Readable', custom: async () => [], bundle: async () => [], warnings: async () => true, output: async () => 'preview', preview: async plan => { preview = plan.text; assert.equal(vscode.window.activeTextEditor!.document.getText(), plan.text); return 'clipboard'; }, destination: async () => undefined, clipboard: async text => { copies++; copied = text; }, untitled: async () => {} };
		const clean = new CleanCopy(api.product.library, () => capture(editor), api.product.comparison, undefined, interactions);
		try {
			assert.equal(await clean.run('file'), 'completed'); assert.equal(copied, preview); assert.ok(!copied.includes('TCP BEGIN')); assert.match(copied, /ordinary comment/); assert.equal(editor.document.getText(), original);
			interactions.preview = async () => undefined; assert.equal(await clean.run('file'), 'cancelled'); assert.equal(copies, 1);
		} finally { clean.dispose(); }
	});
	async function insertionLibrary(language: 'javascript' | 'csharp', run: (library: Library, state: UserState, provider?: CSharpProvider) => Promise<void>, attributed = true) {
		const parent = await fs.mkdtemp(path.join(folder, 'insertion-')), root = { scope: 'global' as const, path: parent };
		await fs.mkdir(path.join(parent, 'Pack')); await fs.writeFile(path.join(parent, 'Pack/pack.json'), JSON.stringify({ formatVersion: 1, id: id(0), name: 'Pack', version: 'v1.0.0' }));
		for (const n of [1, 2, 3, 4]) {
			const directory = path.join(parent, 'Pack', String(n)); await fs.mkdir(directory);
			const code = language === 'csharp' ? `class Code${n} { ${n === 3 ? 'Code1 value = new Code1();' : ''} }\n` : n === 4 ? 'const value = {{VALUE}};\n' : `function code${n}() { return ${n === 3 ? 'code1()' : n}; }\n`;
			await fs.writeFile(path.join(directory, 'code.' + (language === 'csharp' ? 'cs' : 'js')), code);
			await fs.writeFile(path.join(directory, 'snippet.json'), JSON.stringify({ formatVersion: 1, id: id(n), name: 'Code' + n, version: 'v1.0.0', sources: ['code.' + (language === 'csharp' ? 'cs' : 'js')],
				dependencies: n === 3 ? [{ id: id(1), name: 'Code1' }] : [], exports: n === 4 ? [] : [{ kind: language === 'csharp' ? 'class' : 'function', name: language === 'csharp' ? 'Code' + n : 'code' + n }],
				insert: language === 'csharp' ? { defaultMode: 'structure-aware', allowedModes: ['structure-aware', 'cursor'], targets: ['namespace'] } : { defaultMode: 'cursor' },
				templateVariables: n === 4 && language === 'javascript' ? [{ name: 'VALUE', default: '1' }] : [], source: attributed ? [{ url: 'https://example.com/qa/' + n }] : [], licenseNotices: attributed ? [{ text: 'Preserve synthetic notice ' + n }] : [] }));
		}
		const library = new Library(() => [root]); await library.reload(); const entries = new Map<string, unknown>();
		const state = new UserState({ get: <T>(key: string, fallback: T) => (entries.get(key) ?? fallback) as T, update: async (key, value) => { entries.set(key, value); } });
		const provider = language === 'csharp' ? new CSharpProvider(new CSharpClient({ dll })) : undefined;
		try { await run(library, state, provider); } finally { provider?.dispose(); }
	}
	for (const [language, attributed] of [['javascript', true], ['csharp', true], ['csharp', false]] as const) {
		test(language + (attributed ? ' with headers' : ' structure only') + ': B then unrelated X then A depending on B retains verified B and one Undo', async function () {
			if (language === 'csharp' && !existsSync(dll)) { this.skip(); }
			await insertionLibrary(language, async (library, state, provider) => {
				const pipeline = new InsertionPipeline(library, state, undefined, io(), api.product.comparison, provider);
				const target = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: language === 'csharp' ? 'namespace N;\n' : '', language }), { preview: false });
				try {
					for (const n of [1, 2, 3]) {
						target.selection = new vscode.Selection(target.document.positionAt(target.document.getText().length), target.document.positionAt(target.document.getText().length));
						const before = target.document.getText(), asset = library.catalog.snapshot!.snippets.find(asset => asset.metadata.id === id(n))!;
						try { assert.equal(await pipeline.run({ asset, target: capture(target), options: { attribution: attributed ? 'source-urls' : 'none' } }), 'inserted'); }
						catch (error) { throw new Error(language + ' insertion stage ' + n + ': ' + (error as Error).message); }
						if (n === 3) { assert.equal(pipeline.lastPlan!.skipped.length, 1); assert.equal(pipeline.lastPlan!.skipped[0].metadata.id, id(1)); assert.equal(state.get(`snippet:${id(1)}:v1.0.0`).usage, 1); await undoOnce(target.document, before); }
					}
				} finally { pipeline.dispose(); }
			}, attributed);
		});
	}
	test('current ordinary/template duplicate policy is unchanged; external editing still invalidates receipts', async () => {
		await insertionLibrary('javascript', async (library, state) => {
			let inputs = 0; const interactions = io(); interactions.input = async () => { inputs++; return '1'; };
			const pipeline = new InsertionPipeline(library, state, undefined, interactions, api.product.comparison);
			try {
				for (const n of [1, 4]) {
					const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: '', language: 'javascript' }));
					const asset = library.catalog.snapshot!.snippets.find(asset => asset.metadata.id === id(n))!; await pipeline.run({ asset, target: capture(editor) });
					assert.equal(await pipeline.run({ asset, target: capture(editor) }), 'already-present');
					await editor.edit(edit => edit.insert(new vscode.Position(0, 0), '// external change\n'));
					await assert.rejects(pipeline.run({ asset, target: capture(editor) }), /cannot be verified/);
				}
				assert.equal(inputs, 1, 'a repeated template root is skipped before re-prompting under current policy');
			} finally { pipeline.dispose(); }
		});
	});
	test('different C# dependency targets fail closed before apply; no automatic placement fallback', async function () {
		if (!existsSync(dll)) { this.skip(); }
		await insertionLibrary('csharp', async (library, state, provider) => {
			const asset = library.catalog.snapshot!.snippets.find(asset => asset.metadata.id === id(3))!;
			await library.editSnippet(asset, { version: 'v1.0.1' });
			const filename = path.join(asset.root.path, asset.relativePath, 'snippet.json'), raw = JSON.parse(await fs.readFile(filename, 'utf8')); raw.insert.targets = ['member']; await fs.writeFile(filename, JSON.stringify(raw)); await library.reload();
			const target = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: 'class Target {}\n', language: 'csharp' })), before = target.document.getText();
			const pipeline = new InsertionPipeline(library, state, undefined, io(), api.product.comparison, provider);
			try { await assert.rejects(pipeline.run({ asset: library.catalog.snapshot!.snippets.find(asset => asset.metadata.id === id(3))!, target: capture(target) }), /shared explicit/); assert.equal(target.document.getText(), before); assert.equal(state.get(`snippet:${id(1)}:v1.0.0`).usage, 0); }
			finally { pipeline.dispose(); }
		});
	});
});
