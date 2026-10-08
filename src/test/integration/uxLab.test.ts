import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Phase0Api } from '../../extension';
import { LAB_KIND, LAB_MIME } from '../../phase0/uxLab';
import { URI_LIST_MIME } from '../../core/insertion/dragSessions';
import { demoSnippets } from '../../phase0/fixtures';

suite('D&D UX Lab — public API integration (not native mouse drag)', () => {
	let api: Phase0Api;
	let target: vscode.TextEditor;
	let cancellation: vscode.CancellationTokenSource;
	suiteSetup(async () => {
		api = await vscode.extensions.getExtension<Phase0Api>('oz-coden.turbo-code-palette')!.activate();
		await api.uxLab.open();
	});
	setup(async () => {
		cancellation = new vscode.CancellationTokenSource();
		// Undo dispatches to the focused surface; this suite invokes providers directly,
		// so unlike a native editor drop it must explicitly focus the target first.
		target = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({
			content: 'alpha\n\nomega\n', language: 'plaintext',
		}), { preserveFocus: false });
	});
	teardown(() => { cancellation.dispose(); api.uxLab.sessions.clear(); });
	async function propose(transfer: vscode.DataTransfer, position = new vscode.Position(2, 0)) {
		const before = target.document.getText();
		const result = await api.uxLab.provideDocumentDropEdits(target.document, position, transfer, cancellation.token);
		assert.equal(target.document.getText(), before, 'Resolving transfers must not mutate documents');
		return result;
	}
	test('each native payload can propose the same insertion after reaching the provider', async () => {
		for (const item of api.uxLab.items) {
			const transfer = new vscode.DataTransfer();
			api.uxLab.handleDrag([item], transfer, cancellation.token);
			const result = await propose(transfer);
			assert.ok(result, item.payload);
			assert.equal(result.insertText, demoSnippets[0].text);
			assert.equal(result.kind?.value, LAB_KIND.value);
		}
	});
	test('unknown raw text, expired references, mismatched mixed tokens and foreign URI are rejected', async () => {
		const valid = api.uxLab.sessions.issue(demoSnippets[0]);
		const different = api.uxLab.sessions.issue(demoSnippets[1]);
		for (const entries of [
			[['text/plain', demoSnippets[0].text]],
			[[LAB_MIME, 'tcp-snippet://drag/not-issued']],
			[[LAB_MIME, valid], [URI_LIST_MIME, different]],
			[[LAB_MIME, valid], ['text/plain', 'untrusted companion text']],
			[[URI_LIST_MIME, 'https://example.invalid/resource']],
		]) {
			const transfer = new vscode.DataTransfer();
			for (const [mime, value] of entries) { transfer.set(mime, new vscode.DataTransferItem(value)); }
			assert.equal(await propose(transfer), undefined);
		}
		api.uxLab.sessions.clear();
		const expired = new vscode.DataTransfer();
		expired.set(LAB_MIME, new vscode.DataTransferItem(valid));
		assert.equal(await propose(expired), undefined);
	});
	test('custom MIME supports exact cursor position and a single Undo in the host', async () => {
		const before = target.document.getText();
		const position = new vscode.Position(2, 0);
		const transfer = new vscode.DataTransfer();
		transfer.set(LAB_MIME, new vscode.DataTransferItem(api.uxLab.sessions.issue(demoSnippets[0])));
		const result = await propose(transfer, position);
		assert.ok(result);
		const changes = new vscode.WorkspaceEdit();
		changes.insert(target.document.uri, position, result.insertText as string);
		assert.ok(await vscode.workspace.applyEdit(changes));
		assert.equal(target.document.getText(), before.slice(0, target.document.offsetAt(position))
			+ demoSnippets[0].text + before.slice(target.document.offsetAt(position)));
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
		await vscode.commands.executeCommand('undo');
		assert.equal(target.document.getText(), before);
	});
	test('custom MIME EOF proposal has empty insertText and an atomic additionalEdit', async () => {
		const before = target.document.getText();
		const transfer = new vscode.DataTransfer();
		transfer.set(LAB_MIME, new vscode.DataTransferItem(api.uxLab.sessions.issue(demoSnippets[1])));
		const result = await propose(transfer);
		assert.ok(result?.additionalEdit);
		assert.equal(result.insertText, '');
		assert.ok(await vscode.workspace.applyEdit(result.additionalEdit));
		assert.equal(target.document.getText(), before + demoSnippets[1].text);
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
		await vscode.commands.executeCommand('undo');
		assert.equal(target.document.getText(), before);
	});
	test('cancellation while reading a custom transfer never proposes an insertion', async () => {
		const transfer = new vscode.DataTransfer();
		const reference = api.uxLab.sessions.issue(demoSnippets[0]);
		const item = new vscode.DataTransferItem(reference);
		item.asString = async () => { cancellation.cancel(); return reference; };
		transfer.set(LAB_MIME, item);
		assert.equal(await propose(transfer), undefined);
	});
	test('dropIntoEditor.enabled=false also prevents custom MIME proposals', async () => {
		const config = vscode.workspace.getConfiguration('editor.dropIntoEditor', target.document.uri);
		const previous = config.inspect<boolean>('enabled')?.globalValue;
		try {
			await config.update('enabled', false, vscode.ConfigurationTarget.Global);
			const transfer = new vscode.DataTransfer();
			transfer.set(LAB_MIME, new vscode.DataTransferItem(api.uxLab.sessions.issue(demoSnippets[0])));
			assert.equal(await propose(transfer), undefined);
		} finally {
			await config.update('enabled', previous, vscode.ConfigurationTarget.Global);
		}
	});
});
