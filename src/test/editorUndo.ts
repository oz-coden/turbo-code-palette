import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

/** Public undo command targets DOM focus, which crosses the Host/window boundary. */
export async function undoOnce(document: vscode.TextDocument, expected: string): Promise<void> {
	await vscode.window.showTextDocument(document, { preview: false });
	await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
	assert.equal(vscode.window.activeTextEditor?.document, document);
	// A selection command provides a public Host/window acknowledgement that the
	// intended code editor handles commands. It creates no document/Undo edit.
	const editor = vscode.window.activeTextEditor!;
	let selected = () => {}; const selectionAck = new Promise<void>(resolve => { selected = resolve; });
	const selectionListener = vscode.window.onDidChangeTextEditorSelection(event => { if (event.textEditor.document === document && document.getText(event.selections[0]) === document.getText()) { selected(); } });
	const selectionTimeout = setTimeout(selected, 2000);
	try { await vscode.commands.executeCommand('editor.action.selectAll'); if (document.getText(editor.selection) !== document.getText()) { await selectionAck; } assert.equal(document.getText(editor.selection), document.getText()); }
	finally { selectionListener.dispose(); clearTimeout(selectionTimeout); }
	let notify = () => {}; const changed = new Promise<void>(resolve => { notify = resolve; });
	const listener = vscode.workspace.onDidChangeTextDocument(event => { if (event.document === document && document.getText() === expected) { notify(); } });
	const timeout = setTimeout(notify, 2000);
	try { await vscode.commands.executeCommand('undo'); if (document.getText() !== expected) { await changed; } assert.equal(document.getText(), expected); }
	finally { listener.dispose(); clearTimeout(timeout); }
}
