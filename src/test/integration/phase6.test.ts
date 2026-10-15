import { undoOnce } from '../editorUndo';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Phase0Api } from '../../extension';
import { Library } from '../../application/library';
import { InsertionPipeline, type InsertionInteractions } from '../../application/insertionPipeline';
import { UserState } from '../../application/userState';
import { CleanCopy, type CleanInteractions } from '../../application/cleanCopy';
import { CSharpClient } from '../../language/csharpClient';
import { CSharpProvider } from '../../language/csharpProvider';
import { csharpBundleRoots, csharpBundleText } from '../../application/csharpBundle';

const dll = path.resolve(__dirname, '../../..', 'csharp/Tcp.CSharp/bin/Release/net10.0/Tcp.CSharp.dll');
const peer = path.resolve(__dirname, '../../..', 'csharp/Tcp.ProtocolFixture/bin/Release/net10.0/Tcp.ProtocolFixture.dll');
const uuid = (n: number) => '60000000-0000-0000-0000-' + String(n).padStart(12, '0');
const insertIo = (): InsertionInteractions => ({ input: async () => 'VALUE', mode: async (_, modes) => modes[0], output: async () => undefined, preview: async () => true, warnings: async () => true });
const cleanIo = (): CleanInteractions => ({ origins: async () => [], preset: async () => 'Readable', custom: async available => available.map(t => t.id), bundle: async () => undefined, bundleMode: async () => 'semantic', warnings: async () => true, output: async () => 'clipboard', preview: async () => undefined, destination: async () => undefined, clipboard: async () => {}, untitled: async () => {} });
const capture = (editor: vscode.TextEditor) => ({ uri: editor.document.uri, version: editor.document.version, selection: editor.selection });

suite('Phase 6 — optional Roslyn in an Extension Host', () => {
	let api: Phase0Api;
	suiteSetup(async function () { api = await vscode.extensions.getExtension<Phase0Api>('oz-coden.turbo-code-palette')!.activate(); });
	async function sandbox(run: (library: Library, provider: CSharpProvider, state: UserState) => Promise<void>, code = 'class Dep { public const int Answer=42; }', fields: Record<string, unknown> = {}): Promise<void> {
		const base = path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, 'phase6-cases'); await fs.mkdir(base, { recursive: true }); const folder = await fs.mkdtemp(path.join(base, 'case-')), root = { scope: 'global' as const, path: path.join(folder, 'library') };
		const provider = new CSharpProvider(new CSharpClient({ dll, options: { languageVersion: '14.0' } }), () => vscode.workspace.getConfiguration('turboCodePalette').get('compliancePolicy', 'none'));
		try {
			await fs.mkdir(path.join(root.path, 'Pack/Snippet'), { recursive: true }); await fs.writeFile(path.join(root.path, 'Pack/pack.json'), JSON.stringify({ formatVersion: 1, id: uuid(0), name: 'Pack', version: 'v1.0.0' }));
			await fs.writeFile(path.join(root.path, 'Pack/Snippet/snippet.json'), JSON.stringify({ formatVersion: 1, id: uuid(1), name: 'Dep', version: 'v1.0.0', sources: ['code.cs'], exports: [{ kind: 'class', name: 'Dep' }], insert: { defaultMode: 'structure-aware', targets: ['namespace'], allowedModes: ['structure-aware'] }, ...fields }));
			await fs.writeFile(path.join(root.path, 'Pack/Snippet/code.cs'), code); const library = new Library(() => [root]); await library.reload();
			const data = new Map<string, unknown>(), state = new UserState({ get: <T>(key: string, fallback: T) => (data.get(key) ?? fallback) as T, update: async (key, value) => { data.set(key, value); } }); await run(library, provider, state);
		} finally { provider.dispose(); await vscode.commands.executeCommand('workbench.action.closeAllEditors'); assert.equal(path.dirname(folder), base); await fs.rm(folder, { recursive: true, force: true }); }
	}
	async function editor(content: string) { return vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content, language: 'csharp' }), { preview: false }); }
	function requireHelper(context: Mocha.Context) { if (!existsSync(dll) || !existsSync(peer)) { context.skip(); } }
	test('default activation stays .NET independent and exposes the provider unavailable reason', async () => { assert.equal(api.product.csharp.client.running, false); assert.ok(api.product.csharp.client.settings.dll.endsWith('Tcp.CSharp.dll') || !api.product.csharp.configured); const absent = new CSharpProvider(new CSharpClient({ dll: '' })); try { assert.equal((await absent.availability()).available, false); } finally { absent.dispose(); } });
	test('structure-aware namespace Insert uses the shared pipeline, preserves citation/license, and one Undo', async function () {
		requireHelper(this); await sandbox(async (library, provider, state) => {
			const target = await editor('namespace N;\nclass Current {}\n'), before = target.document.getText(), asset = library.catalog.snapshot!.snippets[0]; target.selection = new vscode.Selection(1, 0, 1, 0);
			const pipeline = new InsertionPipeline(library, state, undefined, insertIo(), api.product.comparison, provider);
			try { assert.equal(await pipeline.run({ asset, target: capture(target), options: { attribution: 'source-urls' } }), 'inserted'); assert.match(target.document.getText(), /class Dep/); assert.match(target.document.getText(), /Source URL: https:\/\/example.com\/dep/); assert.match(target.document.getText(), /TCP License: keep/); assert.equal(state.get(`snippet:${uuid(1)}:v1.0.0`).usage, 1); await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup'); await undoOnce(target.document, before); } finally { pipeline.dispose(); }
		}, undefined, { source: [{ url: 'https://example.com/dep' }], licenseNotices: [{ text: 'keep' }] });
	});
	test('member overload is accepted, duplicate signature and malformed target stop before apply', async function () {
		requireHelper(this); await sandbox(async (library, provider, state) => {
			const pipeline = new InsertionPipeline(library, state, undefined, insertIo(), api.product.comparison, provider), asset = library.catalog.snapshot!.snippets[0];
			try {
				const valid = await editor('class Target { void F(int x){}\n}'); valid.selection = new vscode.Selection(0, 16, 0, 16); await pipeline.run({ asset, target: capture(valid) }); assert.match(valid.document.getText(), /F\(string x\)/);
				for (const before of ['class Target { void F(string x){}\n}', 'class Target {']) { const target = await editor(before); target.selection = new vscode.Selection(0, 14, 0, 14); await assert.rejects(pipeline.run({ asset, target: capture(target) }), /collision|Parse errors|Ambiguous/); assert.equal(target.document.getText(), before); }
			} finally { pipeline.dispose(); }
		}, 'void F(string x){}', { exports: [{ kind: 'method', name: 'F' }], insert: { defaultMode: 'structure-aware', targets: ['member'], allowedModes: ['structure-aware'] } });
	});
	test('helper process reuse/idle shutdown and timeout/cancel/crash/protocol mismatch degrade without breaking generic TCP', async function () {
		requireHelper(this); const real = new CSharpClient({ dll, idleMs: 50 }); try { await real.request('analyze', [{ id: 'a.cs', source: 'class A {}' }]); assert.equal(real.running, true); await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(real.running, false); await real.request('analyze', [{ id: 'b.cs', source: 'class B {}' }]); } finally { real.dispose(); }
		for (const scenario of ['hang', 'crash', 'version', 'malformed']) { const client = new CSharpClient({ dll: peer, timeoutMs: scenario === 'hang' ? 300 : 3000 }); try { await assert.rejects(client.request('analyze', [{ id: 'a.cs', source: scenario }]), /unavailable/); assert.equal(client.running, false); } finally { client.dispose(); } }
		const client = new CSharpClient({ dll: peer }), abort = new AbortController(); try { const pending = client.request('analyze', [{ id: 'a.cs', source: 'hang' }], {}, abort.signal); setTimeout(() => abort.abort(), 150); await assert.rejects(pending, /cancelled/); } finally { client.dispose(); }
		assert.ok((await vscode.commands.getCommands()).includes('turbo-code-palette.insert')); assert.equal(api.product.csharp.client.running, false);
	});
	test('C# Clean Copy strips syntax comments while preserving URL/literal/license and exact preview plan', async function () {
		requireHelper(this); await sandbox(async (library, provider) => {
			const target = await editor('// Source URL: https://example.com/current\nclass Current { string S="/*literal*/"; /*ordinary*/ int X; }'), before = target.document.getText(), io = cleanIo(); io.preset = async () => 'Custom'; let copied = ''; io.clipboard = async text => { copied = text; }; io.output = async () => 'preview'; io.preview = async plan => { assert.equal(vscode.window.activeTextEditor!.document.getText(), plan.text); return 'clipboard'; };
			const clean = new CleanCopy(library, () => capture(target), api.product.comparison, undefined, io, provider); try { await clean.run('file'); assert.match(copied, /Source URL:/); assert.match(copied, /\/\*literal\*\//); assert.ok(!copied.includes('/*ordinary*/')); assert.equal(copied, clean.lastPlan!.text); assert.equal(target.document.getText(), before); } finally { clean.dispose(); }
		});
	});
	test('C# Bundle entry binds references, reuses closure and outputs compiled syntax plan with per-asset attribution/license', async function () {
		requireHelper(this); await sandbox(async (library, provider) => {
			const target = await editor('System.Console.WriteLine(Dep.Answer);'), before = target.document.getText(); const roots = await csharpBundleRoots(library, before, provider); assert.equal(roots[0].metadata.id, uuid(1)); assert.match((await csharpBundleText(library, before, roots, provider)).text, /class Dep/);
			const io = cleanIo(); let copied = ''; io.clipboard = async text => { copied = text; }; const clean = new CleanCopy(library, () => capture(target), api.product.comparison, undefined, io, provider);
			try { await clean.run('bundle', capture(target), { attribution: 'source-urls' }); assert.equal(clean.lastPlan!.reviewOnly, false); assert.match(copied, /Source URL: https:\/\/example.com\/dep/); assert.match(copied, /TCP License: keep/); await provider.validate(copied); assert.equal(target.document.getText(), before); } finally { clean.dispose(); }
		}, undefined, { source: [{ url: 'https://example.com/dep' }], licenseNotices: [{ text: 'keep' }, { text: 'keep' }] });
	});
	test('AtCoder missing AI provenance blocks Insert/Bundle output and leaves document/clipboard/user state unchanged', async function () {
		requireHelper(this); const config = vscode.workspace.getConfiguration('turboCodePalette'), previous = config.inspect('compliancePolicy')?.globalValue;
		try { await config.update('compliancePolicy', 'atcoder-20261014', vscode.ConfigurationTarget.Global); await sandbox(async (library, provider, state) => {
			const target = await editor('System.Console.WriteLine(Dep.Answer);'), before = target.document.getText(), io = cleanIo(); let writes = 0; io.clipboard = async () => { writes++; }; const clean = new CleanCopy(library, () => capture(target), api.product.comparison, undefined, io, provider);
			try { await assert.rejects(clean.run('bundle'), /AI\/unknown/); assert.equal(writes, 0); const pipeline = new InsertionPipeline(library, state, undefined, insertIo(), api.product.comparison, provider); try { await assert.rejects(pipeline.run({ asset: library.catalog.snapshot!.snippets[0], target: capture(target) }), /AI\/unknown/); } finally { pipeline.dispose(); } assert.equal(target.document.getText(), before); assert.equal(state.get(`snippet:${uuid(1)}:v1.0.0`).usage, 0); } finally { clean.dispose(); }
		}); } finally { await config.update('compliancePolicy', previous, vscode.ConfigurationTarget.Global); }
	});
	test('exports candidates populate the existing metadata form and remain uncommitted until Save', async function () {
		requireHelper(this); await sandbox(async (library, provider) => { const asset = library.catalog.snapshot!.snippets[0], analysis = await provider.analyze(['public class Visible { public int P {get;set;} }']); await api.product.panel.form({ kind: 'snippet', asset }); assert.match(api.product.panel.instance!.webview.html, /exports-json/); assert.match(api.product.panel.instance!.webview.html, /Detect C# exports/); assert.ok(analysis.result.exports.some(e => e.kind === 'property')); assert.equal(library.catalog.snapshot!.snippets[0].metadata.version!.text, 'v1.0.0'); api.product.panel.dispose(); });
	});
});
