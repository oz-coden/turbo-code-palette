import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { DRAG_SCHEME, DragSessions, URI_LIST_MIME } from './core/insertion/dragSessions';
import { planDemoInsertion, type DemoSnippet } from './core/insertion/plan';
import { demoSnippets, dropTargetText } from './phase0/fixtures';
import { SnippetTree } from './ui/snippetTree';
import { DROP_KIND, SnippetDropProvider } from './ui/dropProvider';

export interface Phase0Api {
	readonly tree: SnippetTree;
	readonly dropProvider: SnippetDropProvider;
	readonly sessions: DragSessions;
}

export function activate(context: vscode.ExtensionContext): Phase0Api {
	const sessions = new DragSessions(randomUUID);
	const tree = new SnippetTree(demoSnippets, sessions);
	const dropProvider = new SnippetDropProvider(sessions);
	const view = vscode.window.createTreeView('turbo-code-palette.snippets', {
		treeDataProvider: tree, dragAndDropController: tree, canSelectMany: true,
	});
	view.message = 'Drag into the editor, then hold Shift before releasing. Or choose Insert.';
	const output = vscode.window.createOutputChannel('Turbo Code Palette (Phase 0)');
	let insertionTarget: { document: vscode.TextDocument; position: vscode.Position } | undefined;
	const remember = (editor: vscode.TextEditor | undefined) => {
		if (editor && ['file', 'untitled'].includes(editor.document.uri.scheme)) {
			insertionTarget = { document: editor.document, position: editor.selection.active };
		}
	};
	remember(vscode.window.activeTextEditor);
	const rememberEditor = vscode.window.onDidChangeActiveTextEditor(remember);
	const rememberSelection = vscode.window.onDidChangeTextEditorSelection(event => remember(event.textEditor));

	context.subscriptions.push(view, output, rememberEditor, rememberSelection,
		{ dispose: () => sessions.clear() },
		vscode.workspace.registerTextDocumentContentProvider(DRAG_SCHEME, {
			provideTextDocumentContent: uri => sessions.resolve(uri.toString())?.text ?? 'This demo preview has expired. Drag the snippet again.',
		}),
		vscode.languages.registerDocumentDropEditProvider([{ scheme: 'file' }, { scheme: 'untitled' }], dropProvider,
			{ dropMimeTypes: [URI_LIST_MIME], providedDropEditKinds: [DROP_KIND] }),
		vscode.commands.registerCommand('turbo-code-palette.openDropTarget', async () => {
			const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: dropTargetText });
			const editor = await vscode.window.showTextDocument(document, { preview: false });
			editor.selection = new vscode.Selection(2, 0, 2, 0);
			await vscode.commands.executeCommand('turbo-code-palette.snippets.focus');
		}),
		vscode.commands.registerCommand('turbo-code-palette.previewDemo', async (snippet: DemoSnippet) => {
			if (!demoSnippets.includes(snippet)) { return; }
			const uri = vscode.Uri.parse(sessions.issue(snippet));
			await vscode.window.showTextDocument(uri, { preview: true, preserveFocus: true });
		}),
		vscode.commands.registerCommand('turbo-code-palette.insertDemo', async (snippet?: DemoSnippet) => {
			const selected = snippet ?? view.selection[0];
			const target = insertionTarget;
			if (!selected || !demoSnippets.includes(selected) || !target || target.document.isClosed) {
				await vscode.window.showInformationMessage('Select a demo snippet and open an editable text document.');
				return;
			}
			const version = target.document.version;
			const plan = planDemoInsertion(selected, target.document.getText(), target.document.offsetAt(target.position),
				target.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
			// A preview may dispose the old TextEditor while its document remains open.
			const editor = await vscode.window.showTextDocument(target.document, { preview: false });
			if (target.document.version !== version) { return; }
			await editor.edit(builder => builder.insert(target.document.positionAt(plan.offset), plan.text));
		}),
		vscode.commands.registerCommand('turbo-code-palette.showDiagnostics', () => {
			// No code, document paths, machine identifiers, or session IDs in diagnostics.
			output.appendLine(JSON.stringify({ tree: tree.diagnostics, drop: dropProvider.diagnostics }));
			output.show(true);
			return { tree: tree.diagnostics, drop: dropProvider.diagnostics };
		}),
	);
	return { tree, dropProvider, sessions };
}
