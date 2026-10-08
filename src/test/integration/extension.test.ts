import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Phase0Api } from '../../extension';
import { URI_LIST_MIME } from '../../core/insertion/dragSessions';
import { demoSnippets } from '../../phase0/fixtures';

suite('Phase 0 — real Extension Host API integration (not native mouse drag)', () => {
	let api: Phase0Api;
	const sources: vscode.CancellationTokenSource[] = [];
	function cancellation(): vscode.CancellationToken {
		const source = new vscode.CancellationTokenSource();
		sources.push(source);
		return source.token;
	}
	function drag(index = 0): vscode.DataTransfer {
		const transfer = new vscode.DataTransfer();
		api.tree.handleDrag([api.tree.snippets[index]], transfer, cancellation());
		return transfer;
	}
	async function editor(content = 'alpha\n\nomega\n'): Promise<vscode.TextEditor> {
		return vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content, language: 'plaintext' }));
	}
	async function drop(target: vscode.TextEditor, index: number, position: vscode.Position): Promise<vscode.DocumentDropEdit> {
		const before = target.document.getText();
		const edit = await api.dropProvider.provideDocumentDropEdits(target.document, position, drag(index), cancellation());
		assert.equal(target.document.getText(), before, 'Planning must not change the document');
		assert.ok(edit);
		return edit;
	}

	suiteSetup(async () => {
		const extension = vscode.extensions.getExtension<Phase0Api>('oz-coden.turbo-code-palette');
		assert.ok(extension, 'Development extension must be installed');
		api = await extension.activate();
		assert.ok(extension.isActive);
	});
	teardown(() => {
		for (const source of sources.splice(0)) { source.dispose(); }
		api.sessions.clear();
	});

	test('contributed view and commands activate in the host', async () => {
		const commands = await vscode.commands.getCommands();
		assert.ok(commands.includes('turbo-code-palette.openDropTarget'));
		await vscode.commands.executeCommand('turbo-code-palette.snippets.focus');
		assert.equal(api.tree.getChildren().length, 2);
	});

	test('tree controller emits an opaque URI, not code or a filesystem path', async () => {
		const value = await drag().get(URI_LIST_MIME)!.asString();
		assert.match(value, /^tcp-snippet:\/\/drag\/[a-f0-9-]+$/);
		assert.ok(!value.includes(demoSnippets[0].text));
	});

	test('cursor drop inserts once at the supplied position and one Undo restores the target', async () => {
		const target = await editor();
		const before = target.document.getText();
		const position = new vscode.Position(1, 0);
		const edit = await drop(target, 0, position);
		assert.equal(edit.additionalEdit, undefined);
		assert.equal(typeof edit.insertText, 'string');
		const changes = new vscode.WorkspaceEdit();
		changes.insert(target.document.uri, position, edit.insertText as string);
		assert.ok(await vscode.workspace.applyEdit(changes));
		assert.equal(target.document.getText(), `alpha\n${demoSnippets[0].text}\nomega\n`);
		await vscode.commands.executeCommand('undo');
		assert.equal(target.document.getText(), before);
	});

	test('empty drop text plus additionalEdit inserts at EOF and Undo is atomic', async () => {
		const target = await editor();
		const before = target.document.getText();
		const edit = await drop(target, 1, new vscode.Position(0, 0));
		assert.equal(edit.insertText, '');
		assert.ok(edit.additionalEdit);
		assert.ok(await vscode.workspace.applyEdit(edit.additionalEdit));
		assert.equal(target.document.getText(), before + demoSnippets[1].text);
		await vscode.commands.executeCommand('undo');
		assert.equal(target.document.getText(), before);
	});

	test('drop uses its target document even when another editor was active', async () => {
		const first = await editor('first\n');
		const second = await editor('second\n');
		const edit = await drop(first, 1, new vscode.Position(0, 0));
		assert.ok(edit.additionalEdit);
		assert.ok(await vscode.workspace.applyEdit(edit.additionalEdit));
		assert.equal(first.document.getText(), 'first\n' + demoSnippets[1].text);
		assert.equal(second.document.getText(), 'second\n');
	});

	test('cancelled, forged and multi-item payloads never propose edits', async () => {
		const target = await editor();
		const before = target.document.getText();
		const source = new vscode.CancellationTokenSource();
		source.cancel();
		assert.equal(await api.dropProvider.provideDocumentDropEdits(target.document, new vscode.Position(0, 0), drag(), source.token), undefined);
		source.dispose();
		for (const value of ['tcp-snippet://drag/forged', 'file:///arbitrary.txt', `${api.sessions.issue(api.tree.snippets[0])}\nfile:///other.txt`]) {
			const transfer = new vscode.DataTransfer();
			transfer.set(URI_LIST_MIME, new vscode.DataTransferItem(value));
			assert.equal(await api.dropProvider.provideDocumentDropEdits(target.document, new vscode.Position(0, 0), transfer, cancellation()), undefined);
		}
		assert.equal(target.document.getText(), before);
	});

	test('document changed while reading transfer is rejected without snippet insertion', async () => {
		const target = await editor();
		const transfer = drag();
		const item = transfer.get(URI_LIST_MIME)!;
		const value = await item.asString();
		item.asString = async () => {
			await target.edit(builder => builder.insert(new vscode.Position(0, 0), 'external edit\n'));
			return value;
		};
		assert.equal(await api.dropProvider.provideDocumentDropEdits(target.document, new vscode.Position(0, 0), transfer, cancellation()), undefined);
		assert.equal(target.document.getText(), 'external edit\nalpha\n\nomega\n');
	});

	test('multi-select drag and cancelled drag emit no insertion payload', () => {
		const transfer = new vscode.DataTransfer();
		api.tree.handleDrag(api.tree.snippets, transfer, cancellation());
		assert.equal(transfer.get(URI_LIST_MIME), undefined);
		const source = new vscode.CancellationTokenSource();
		source.cancel();
		api.tree.handleDrag([api.tree.snippets[0]], transfer, source.token);
		source.dispose();
		assert.equal(transfer.get(URI_LIST_MIME), undefined);
	});

	test('disabled editor drop setting is respected and restored', async () => {
		const target = await editor();
		const configuration = vscode.workspace.getConfiguration('editor.dropIntoEditor');
		const previous = configuration.inspect<boolean>('enabled')?.globalValue;
		try {
			await configuration.update('enabled', false, vscode.ConfigurationTarget.Global);
			assert.equal(await api.dropProvider.provideDocumentDropEdits(target.document, new vscode.Position(0, 0), drag(), cancellation()), undefined);
			assert.equal(target.document.getText(), 'alpha\n\nomega\n');
		} finally {
			await configuration.update('enabled', previous, vscode.ConfigurationTarget.Global);
		}
	});

	test('cancellation during async transfer leaves the document unchanged', async () => {
		const target = await editor();
		const transfer = drag();
		const item = transfer.get(URI_LIST_MIME)!;
		const value = await item.asString();
		const source = new vscode.CancellationTokenSource();
		item.asString = async () => { source.cancel(); return value; };
		assert.equal(await api.dropProvider.provideDocumentDropEdits(target.document, new vscode.Position(0, 0), transfer, source.token), undefined);
		source.dispose();
		assert.equal(target.document.getText(), 'alpha\n\nomega\n');
	});

	test('virtual preview has no filesystem writer and Insert still targets the text editor', async () => {
		const target = await editor('target\n');
		target.selection = new vscode.Selection(0, 0, 0, 0);
		await vscode.commands.executeCommand('turbo-code-palette.previewDemo', api.tree.snippets[0]);
		await vscode.commands.executeCommand('turbo-code-palette.insertDemo', api.tree.snippets[0]);
		assert.equal(target.document.getText(), demoSnippets[0].text + 'target\n');
		const preview = await vscode.workspace.openTextDocument(vscode.Uri.parse(api.sessions.issue(api.tree.snippets[0])));
		assert.equal(preview.getText(), demoSnippets[0].text);
		assert.equal(vscode.workspace.fs.isWritableFileSystem(preview.uri.scheme), undefined);
		await assert.rejects(Promise.resolve(vscode.workspace.fs.writeFile(preview.uri, Buffer.from('must not write'))));
		assert.equal(preview.getText(), demoSnippets[0].text);
	});
});
