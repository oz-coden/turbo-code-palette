import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { DRAG_SCHEME, DragSessions } from './core/insertion/dragSessions';
import { planDemoInsertion, type DemoSnippet } from './core/insertion/plan';
import { demoSnippets, dropTargetText } from './phase0/fixtures';
import { SnippetTree } from './ui/snippetTree';
import { SnippetDropProvider } from './ui/dropProvider';
import { Catalog } from './storage/catalog';
import { LibraryController } from './application/controller';

export interface Phase0Api {
	readonly tree: SnippetTree;
	readonly dropProvider: SnippetDropProvider;
	readonly sessions: DragSessions;
	readonly catalog: Catalog;
	readonly product: LibraryController;
}

export function activate(context: vscode.ExtensionContext): Phase0Api {
	const sessions = new DragSessions(randomUUID);
	const tree = new SnippetTree(demoSnippets, sessions);
	const dropProvider = new SnippetDropProvider(sessions);
	const product = new LibraryController(context);
	const catalog = product.library.catalog;
	const view = vscode.window.createTreeView('turbo-code-palette.demos', {
		treeDataProvider: tree, canSelectMany: true,
	});
	view.message = 'Choose a position in the editor, select a demo snippet, then use Insert.';
	void vscode.commands.executeCommand('setContext', 'tcp.showDemos', vscode.workspace.getConfiguration('turboCodePalette').get<boolean>('showDevelopmentDemos', false));
	const output = vscode.window.createOutputChannel('Turbo Code Palette');
	let insertionTarget: { document: vscode.TextDocument; position: vscode.Position } | undefined;
	const remember = (editor: vscode.TextEditor | undefined) => {
		if (editor && ['file', 'untitled'].includes(editor.document.uri.scheme)) {
			insertionTarget = { document: editor.document, position: editor.selection.active };
		}
	};
	remember(vscode.window.activeTextEditor);
	const rememberEditor = vscode.window.onDidChangeActiveTextEditor(remember);
	const rememberSelection = vscode.window.onDidChangeTextEditorSelection(event => remember(event.textEditor));

	// Phase 0 D&D code remains as a historical test fixture; no provider or drag controller is registered.
	context.subscriptions.push(product, view, output, rememberEditor, rememberSelection,
		{ dispose: () => sessions.clear() },
		vscode.workspace.registerTextDocumentContentProvider(DRAG_SCHEME, {
			provideTextDocumentContent: uri => sessions.resolve(uri.toString())?.text ?? 'This demo preview has expired. Drag the snippet again.',
		}),
		vscode.commands.registerCommand('turbo-code-palette.openDropTarget', async () => {
			const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: dropTargetText });
			const editor = await vscode.window.showTextDocument(document, { preview: false });
			editor.selection = new vscode.Selection(2, 0, 2, 0);
			await vscode.commands.executeCommand('setContext', 'tcp.showDemos', true);
			await vscode.commands.executeCommand('turbo-code-palette.demos.focus');
		}),
		vscode.commands.registerCommand('turbo-code-palette.previewDemo', async (snippet: DemoSnippet) => {
			if (!demoSnippets.includes(snippet)) { return; }
			const uri = vscode.Uri.parse(sessions.issue(snippet));
			await vscode.window.showTextDocument(uri, { preview: true, preserveFocus: true });
		}),
		vscode.commands.registerCommand('turbo-code-palette.insertDemo', async (snippet?: DemoSnippet) => {
			const target = insertionTarget;
			const version = target?.document.version;
			const selected = snippet ?? view.selection[0] ?? (await vscode.window.showQuickPick(demoSnippets.map(item => ({ label: item.name, snippet: item })),
				{ placeHolder: 'Select a demo snippet to Insert' }))?.snippet;
			if (!selected || !demoSnippets.includes(selected) || !target || target.document.isClosed) {
				await vscode.window.showInformationMessage('Select a demo snippet and open an editable text document.');
				return;
			}
			if (target.document.version !== version) { return; }
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
	return { tree, dropProvider, sessions, catalog, product };
}
