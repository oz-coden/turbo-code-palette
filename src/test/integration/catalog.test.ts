import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Phase0Api } from '../../extension';
import { demoSnippets } from '../../phase0/fixtures';
import { vscodeReader } from '../../storage/vscodeReader';

suite('Phase 1 — catalog commands and explicit Insert in a real Extension Host', () => {
	let api: Phase0Api;
	suiteSetup(async () => { api = await vscode.extensions.getExtension<Phase0Api>('oz-coden.turbo-code-palette')!.activate(); });
	test('registered catalog commands use configured Global storage and the shared search pipeline', async () => {
		const extension = vscode.extensions.getExtension('oz-coden.turbo-code-palette')!;
		const fixture = vscode.Uri.joinPath(extension.extensionUri, 'src/test/fixtures/library').fsPath;
		const config = vscode.workspace.getConfiguration('turboCodePalette');
		const previous = config.inspect<string>('globalRoot')?.globalValue;
		try {
			await config.update('globalRoot', fixture, vscode.ConfigurationTarget.Global);
			const summary = await vscode.commands.executeCommand<{ snippets: number; packs: number }>('turbo-code-palette.reloadCatalog');
			assert.equal(summary?.snippets, 1);
			assert.equal(api.catalog.snapshot?.snippets[0].metadata.name, 'Minimum');
			const result = await vscode.commands.executeCommand<{ hits: { name: string }[]; errors: string[] }>('turbo-code-palette.searchCatalog', 'lang:"C#" tag:"small helper"');
			assert.equal(result?.hits.length, 1);
			assert.deepEqual(result?.errors, []);
			assert.deepEqual(api.catalog.suggestions('lang'), ['lang:"C#"']);
			const invalid = await vscode.commands.executeCommand<{ hits: unknown[]; errors: string[] }>('turbo-code-palette.searchCatalog', 'unknown:filter');
			assert.equal(invalid?.hits.length, 0);
			assert.ok(invalid?.errors.length);
		} finally { await config.update('globalRoot', previous, vscode.ConfigurationTarget.Global); }
	});
	test('Insert works with editor drop disabled and produces one Undo unit', async () => {
		const target = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: 'before\nafter\n' }));
		target.selection = new vscode.Selection(1, 0, 1, 0);
		const config = vscode.workspace.getConfiguration('editor.dropIntoEditor');
		const previous = config.inspect<boolean>('enabled')?.globalValue;
		try {
			await config.update('enabled', false, vscode.ConfigurationTarget.Global);
			await vscode.commands.executeCommand('turbo-code-palette.insertDemo', api.tree.snippets[0]);
			assert.equal(target.document.getText(), 'before\n' + demoSnippets[0].text + 'after\n');
			await vscode.commands.executeCommand('undo');
			assert.equal(target.document.getText(), 'before\nafter\n');
		} finally { await config.update('enabled', previous, vscode.ConfigurationTarget.Global); }
	});
	test('public URI filesystem adapter reads the same library, enforces read bounds and keeps unverifiable locations inspection-only', async () => {
		const extension = vscode.extensions.getExtension('oz-coden.turbo-code-palette')!;
		const root = vscode.Uri.joinPath(extension.extensionUri, 'src/test/fixtures/library');
		const reader = vscodeReader(root);
		await assert.rejects(reader.read('Algorithms/Minimum/snippet.json', 8));
		const snapshot = await api.catalog.reload([{ scope: 'global', path: root.toString(), uri: root.toString() }], () => reader);
		assert.equal(snapshot.snippets[0].metadata.name, 'Minimum');
		assert.equal(snapshot.snippets[0].usable, false);
		assert.equal(api.catalog.search('Minimum').hits[0].canInsert, false);
		const config = vscode.workspace.getConfiguration('turboCodePalette');
		const previous = config.inspect<string>('globalRoot')?.globalValue;
		try {
			await config.update('globalRoot', '', vscode.ConfigurationTarget.Global);
			const summary = await vscode.commands.executeCommand<{ snippets: number; diagnostics: { code: string }[] }>('turbo-code-palette.reloadCatalog');
			assert.ok(summary);
			assert.equal(summary.diagnostics.some(item => item.code === 'unreadable-root'), false);
		} finally { await config.update('globalRoot', previous, vscode.ConfigurationTarget.Global); }
	});
	test('research Webview/custom/raw drop commands are no longer registered; auxiliary D&D defaults off', async () => {
		const commands = await vscode.commands.getCommands();
		assert.equal(commands.includes('turbo-code-palette.openUxLab'), false);
		assert.equal(commands.includes('turbo-code-palette.showUxLabDiagnostics'), false);
		assert.equal(vscode.workspace.getConfiguration('turboCodePalette').inspect<boolean>('enableAuxiliaryDragAndDrop')?.defaultValue, false);
	});
});
