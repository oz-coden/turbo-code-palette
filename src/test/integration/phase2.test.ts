import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Phase0Api } from '../../extension';
import { captureSnippet } from '../../application/controller';
import { locationKey } from '../../application/library';
import { Library } from '../../application/library';
import { vscodeStore } from '../../storage/vscodeStore';
import { DetailsPanel, escapeHtml } from '../../ui/detailsPanel';

suite('Phase 2 — native library UI and transactional forms in a real Extension Host', () => {
	let api: Phase0Api, directory: string, previous: string | undefined;
	const config = vscode.workspace.getConfiguration('turboCodePalette');
	suiteSetup(async () => {
		api = await vscode.extensions.getExtension<Phase0Api>('oz-coden.turbo-code-palette')!.activate();
		const base = path.join(vscode.extensions.getExtension('oz-coden.turbo-code-palette')!.extensionUri.fsPath, '.vscode-test/phase2-host'); await fs.mkdir(base, { recursive: true }); directory = await fs.mkdtemp(path.join(base, 'case-'));
		await fs.cp(path.join(vscode.extensions.getExtension('oz-coden.turbo-code-palette')!.extensionUri.fsPath, 'src/test/fixtures/library'), directory, { recursive: true });
		previous = config.inspect<string>('globalRoot')?.globalValue; await config.update('globalRoot', directory, vscode.ConfigurationTarget.Global); await api.product.reload();
	});
	suiteTeardown(async () => {
		api.product.panel.saved(); api.product.panel.dispose(); await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await config.update('globalRoot', previous, vscode.ConfigurationTarget.Global); await api.product.reload();
		assert.equal(path.basename(path.dirname(directory)), 'phase2-host'); await fs.rm(directory, { recursive: true, force: true });
	});
	test('native views use real logical items with lightweight rows and the shared search filter', async () => {
		await vscode.commands.executeCommand('turbo-code-palette.snippets.focus'); await vscode.commands.executeCommand('turbo-code-palette.packs.focus');
		const row = api.product.snippets.getChildren()[0], item = api.product.snippets.getTreeItem(row);
		assert.equal(item.label, 'Minimum'); assert.match(String(item.description), /C#.*v1\.0\.0-0.*global\/Algorithms/); assert.equal(item.command?.command, 'turbo-code-palette.details'); assert.equal(item.contextValue, 'tcp.snippet');
		api.product.snippets.query = 'lang:"C#"'; assert.equal(api.product.snippets.getChildren().length, 1); api.product.snippets.query = 'unknown:value'; assert.equal(api.product.snippets.getChildren().length, 0); api.product.snippets.query = '';
		assert.equal(api.product.packs.getChildren()[0].locations[0].metadata.name, 'Algorithms');
	});
	test('Snippet and Pack details reuse one central panel, display unknown metadata and secure escaped source preview', async () => {
		const snippet = api.catalog.snapshot!.snippets[0]; await api.product.showDetails(snippet); const panel = api.product.panel.instance!;
		assert.equal(panel.viewColumn, vscode.ViewColumn.One); assert.match(panel.webview.html, /Features/); assert.match(panel.webview.html, /Versions \/ locations/); assert.match(panel.webview.html, /1234567890123456789012345678901234567890/); assert.match(panel.webview.html, /Content-Security-Policy/); assert.match(panel.webview.html, /default-src &#39;none&#39;|default-src 'none'/); assert.equal(panel.webview.options.localResourceRoots?.length, 1);
		await api.product.showDetails(api.catalog.snapshot!.packs[0]); assert.equal(api.product.panel.instance, panel); assert.match(panel.webview.html, /<h2>Snippets<\/h2>/); assert.match(panel.webview.html, /data-action="insert"/);
		assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
	});
	test('Selection/File/New capture real editor content and language without changing the document', async () => {
		const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: 'start\nselected\nend', language: 'csharp' })); editor.selection = new vscode.Selection(1, 0, 1, 8);
		const wasDirty = editor.document.isDirty, version = editor.document.version;
		const selection = captureSnippet('selection', editor), file = captureSnippet('file', editor), empty = captureSnippet('new');
		assert.equal(selection.bytes.toString(), 'selected'); assert.equal(selection.language, 'csharp'); assert.equal(file.bytes.toString(), editor.document.getText()); assert.equal(empty.bytes.length, 0); assert.equal(editor.document.isDirty, wasDirty); assert.equal(editor.document.version, version);
	});
	test('metadata form cancel and stale token cannot write; valid form save preserves unknown fields and refreshes search/detail', async () => {
		const asset = api.catalog.snapshot!.snippets[0], before = await fs.readFile(api.product.assetUri(asset, 'snippet.json').fsPath, 'utf8');
		await api.product.edit(asset); const oldToken = api.product.panel.session; assert.match(api.product.panel.instance!.webview.html, /id="metadata"/); assert.doesNotMatch(api.product.panel.instance!.webview.html, /textarea name="sourceCode/); assert.match(api.product.panel.instance!.webview.html, /textarea name="sources"/);
		await api.product.panel.accept({ token: oldToken, action: 'cancel' }); assert.equal(await fs.readFile(api.product.assetUri(asset, 'snippet.json').fsPath, 'utf8'), before);
		await api.product.edit(asset); await api.product.panel.accept({ token: oldToken, action: 'save', fields: { name: 'Stale', version: 'v1.0.0-1' }, dependencies: [] }); assert.equal(await fs.readFile(api.product.assetUri(asset, 'snippet.json').fsPath, 'utf8'), before);
		await api.product.panel.accept({ token: api.product.panel.session, action: 'save', fields: { name: 'Minimum edited', version: 'v1.0.0-1' }, dependencies: [] });
		const after = api.catalog.snapshot!.snippets[0]; assert.equal(after.metadata.name, 'Minimum edited'); assert.equal(after.metadata.document.raw(['custom']), asset.metadata.document.raw(['custom'])); assert.equal(api.catalog.search('"Minimum edited"').hits.length, 1); assert.match(api.product.panel.instance!.webview.html, /Minimum edited/);
	});
	test('source opens in normal editor; dirty source blocks form writes and snapshot stays unchanged', async () => {
		const asset = api.catalog.snapshot!.snippets[0]; await api.product.openSource(asset, 'code.cs'); const editor = vscode.window.activeTextEditor!; assert.equal(editor.document.uri.toString(), api.product.assetUri(asset, 'code.cs').toString());
		await editor.edit(builder => builder.insert(new vscode.Position(0, 0), '// unsaved\n'));
		await assert.rejects(api.product.library.editSnippet(asset, { version: 'v1.0.0-2' }), /dirty/); assert.equal(api.catalog.snapshot!.snippets[0].metadata.version!.text, 'v1.0.0-1'); await vscode.commands.executeCommand('workbench.action.files.revert');
	});
	test('all real Insert entry points share the adapter and leave target text/usage unchanged in Phase 2', async () => {
		const asset = api.catalog.snapshot!.snippets[0], key = locationKey(asset); const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: 'target\n' })); editor.selection = new vscode.Selection(0, 3, 0, 3);
		const originalHandler = api.product.insertion.handler;
		const requests: string[] = []; api.product.insertion.handler = async request => { requests.push(locationKey(request.asset)); assert.equal(request.target?.uri.toString(), editor.document.uri.toString()); assert.equal(request.target?.selection.active.character, 3); };
		try { await vscode.commands.executeCommand('turbo-code-palette.insert', key); await api.product.showDetails(api.catalog.snapshot!.packs[0]); await api.product.panel.accept({ token: api.product.panel.session, action: 'insert', key }); assert.deepEqual(requests, [key, key]); assert.equal(editor.document.getText(), 'target\n'); assert.equal(api.product.state.get(`snippet:${asset.metadata.id}:${asset.metadata.version!.text}`).usage, 0); }
		finally { api.product.insertion.handler = originalHandler; }
	});
	test('Pack create/edit form is shared and dependency preview/Save use the common resolver', async () => {
		await api.product.create('pack', api.catalog.snapshot!.snippets[0].root); assert.equal(api.product.panel.current?.seed?.kind, 'pack'); const member = api.catalog.snapshot!.snippets[0];
		await api.product.panel.accept({ token: api.product.panel.session, action: 'save', fields: { name: 'Host Pack', version: 'v1.0.0' }, members: [locationKey(member)] });
		const pack = api.catalog.snapshot!.packs.find(item => item.metadata.name === 'Host Pack')!; assert.equal(api.product.library.members(pack).length, 1); await api.product.edit(pack); assert.match(api.product.panel.instance!.webview.html, /data-kind="pack"/); assert.match(api.product.panel.instance!.webview.html, /id="member-query"/);
		await api.product.panel.accept({ token: api.product.panel.session, action: 'cancel' });
	});
	test('public URI filesystem transactions create/copy metadata without weakening Phase 1 Insert eligibility', async () => {
		const uri = vscode.Uri.file(path.join(directory, 'uri-library')); const root = { scope: 'global' as const, path: uri.toString(), uri: uri.toString() };
		const library = new Library(() => [root], () => vscodeStore(uri)); await library.reload(); const id = await library.createSnippet(root, { fields: { name: 'URI asset', version: 'v1.0.0' }, sourceName: 'code.txt', bytes: Buffer.from('uri source') });
		const asset = library.catalog.snapshot!.snippets.find(item => item.metadata.id === id)!; assert.equal((await library.source(asset, 'code.txt')).toString(), 'uri source'); assert.equal(asset.usable, false); await library.editSnippet(asset, { version: 'v1.0.0-0', description: 'edited using fresh staging' }); assert.equal(library.catalog.snapshot!.snippets[0].metadata.description, 'edited using fresh staging');
	});
	test('panel ignores malformed/untrusted messages and rejects undeclared source paths', async () => {
		const panel = new DetailsPanel(vscode.extensions.getExtension('oz-coden.turbo-code-palette')!.extensionUri, async () => { assert.fail('Untrusted message reached controller'); });
		try { await panel.accept(null); await panel.accept([]); await panel.accept({ action: 'save', token: 'untrusted' }); await panel.accept({ action: 'save', token: '' }); } finally { panel.dispose(); }
		const asset = api.catalog.snapshot!.snippets[0]; await assert.rejects(api.product.openSource(asset, '../outside.txt')); await assert.rejects(api.product.openSource(asset, 'not-declared.cs'));
	});
	test('the actual filesystem watcher marks saved source changes, waits for Reload, then metadata revision can be updated', async () => {
		const asset = api.catalog.snapshot!.snippets.find(item => item.packName === 'Algorithms')!, hash = asset.semanticHash;
		await api.product.openSource(asset, 'code.cs'); const editor = vscode.window.activeTextEditor!; await editor.edit(builder => builder.insert(new vscode.Position(0, 0), '// saved from normal editor\n')); assert.equal(await editor.document.save(), true);
		const deadline = Date.now() + 6000; while (!api.product.changes.pending && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 100)); }
		assert.equal(api.product.changes.pending, true); assert.equal(api.catalog.snapshot!.snippets.find(item => locationKey(item) === locationKey(asset))!.semanticHash, hash);
		await api.product.reload(); const changed = api.catalog.snapshot!.snippets.find(item => locationKey(item) === locationKey(asset))!; assert.notEqual(changed.semanticHash, hash); assert.equal(api.product.changes.pending, false);
		await api.product.library.editSnippet(changed, { version: 'v1.0.0-2' }); api.product.refresh(); assert.equal(api.catalog.search('version:=v1.0.0-2').hits.length, 1);
	});
});
