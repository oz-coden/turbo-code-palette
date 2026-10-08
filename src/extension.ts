import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { DRAG_SCHEME, DragSessions, URI_LIST_MIME } from './core/insertion/dragSessions';
import { planDemoInsertion, type DemoSnippet } from './core/insertion/plan';
import { demoSnippets, dropTargetText } from './phase0/fixtures';
import { SnippetTree } from './ui/snippetTree';
import { DROP_KIND, SnippetDropProvider } from './ui/dropProvider';
import { Catalog } from './storage/catalog';
import { resolveRoots } from './storage/roots';
import { nativeReader } from './storage/reader';
import { vscodeReader } from './storage/vscodeReader';

export interface Phase0Api {
	readonly tree: SnippetTree;
	readonly dropProvider: SnippetDropProvider;
	readonly sessions: DragSessions;
	readonly catalog: Catalog;
}

export function activate(context: vscode.ExtensionContext): Phase0Api {
	const sessions = new DragSessions(randomUUID);
	const tree = new SnippetTree(demoSnippets, sessions);
	const dropProvider = new SnippetDropProvider(sessions);
	const catalog = new Catalog();
	const enableDrag = vscode.workspace.getConfiguration('turboCodePalette').get<boolean>('enableAuxiliaryDragAndDrop', false);
	const view = vscode.window.createTreeView('turbo-code-palette.snippets', {
		treeDataProvider: tree, dragAndDropController: enableDrag ? tree : undefined, canSelectMany: true,
	});
	view.message = 'Choose a position in the editor, select a demo snippet, then use Insert.';
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

	if (enableDrag) {
		context.subscriptions.push(vscode.languages.registerDocumentDropEditProvider([{ scheme: 'file' }, { scheme: 'untitled' }], dropProvider,
			{ dropMimeTypes: [URI_LIST_MIME], providedDropEditKinds: [DROP_KIND] }));
	}
	context.subscriptions.push(view, output, rememberEditor, rememberSelection,
		vscode.commands.registerCommand('turbo-code-palette.reloadCatalog', async () => {
			if (vscode.workspace.workspaceFolders?.some(folder => folder.uri.scheme !== 'file')) {
				void vscode.window.showWarningMessage('Phase 1 catalog supports local filesystem storage only.');
				return;
			}
			const configured = vscode.workspace.getConfiguration('turboCodePalette').get<string>('globalRoot');
			const roots = resolveRoots(context.globalStorageUri.fsPath, (vscode.workspace.workspaceFolders ?? []).map(folder => ({
				id: folder.uri.toString(), path: folder.uri.fsPath,
			})), configured || undefined);
			if (!configured && context.globalStorageUri.scheme !== 'file') {
				const uri = vscode.Uri.joinPath(context.globalStorageUri, 'snippets');
				roots[roots.length - 1] = { scope: 'global', path: uri.toString(), uri: uri.toString() };
			}
			const snapshot = await catalog.reload(roots, root => root.uri ? vscodeReader(vscode.Uri.parse(root.uri)) : nativeReader(root));
			output.appendLine(JSON.stringify({ snippets: snapshot.snippets.length, packs: snapshot.packs.length,
				diagnostics: snapshot.diagnostics.map(item => ({ scope: item.scope, code: item.code })) }));
			// Command results can cross the RPC boundary: never return cyclic ASTs or BigInt.
			return { snippets: snapshot.snippets.length, packs: snapshot.packs.length,
				diagnostics: snapshot.diagnostics.map(item => ({ scope: item.scope, code: item.code })) };
		}),
		vscode.commands.registerCommand('turbo-code-palette.searchCatalog', async (query?: string) => {
			if (!catalog.snapshot) { await vscode.commands.executeCommand('turbo-code-palette.reloadCatalog'); }
			const input = query ?? await vscode.window.showInputBox({ prompt: 'Search the Phase 1 catalog (inspection only)', placeHolder: 'name lang:"C#" scope:workspace' });
			if (input === undefined) { return; }
			const result = catalog.search(input);
			if (query === undefined) {
				if (result.errors.length) { await vscode.window.showWarningMessage(result.errors.join(', ')); }
				else { await vscode.window.showQuickPick(result.hits.map(hit => ({ label: hit.locations[0].metadata.name!,
					description: `${hit.locations[0].metadata.version!.text} · ${hit.group.status}`,
					detail: `${hit.locations.length} location(s) · catalog inspection; product UI follows in Phase 2`,
				})), { placeHolder: 'Loaded catalog — read only' }); }
			}
			return { errors: result.errors, hits: result.hits.map(hit => ({ key: hit.group.key, name: hit.locations[0].metadata.name,
				version: hit.locations[0].metadata.version!.text, status: hit.group.status, canInsert: hit.canInsert,
				scopes: [...new Set(hit.locations.map(asset => asset.root.scope))] })) };
		}),
		{ dispose: () => sessions.clear() },
		vscode.workspace.registerTextDocumentContentProvider(DRAG_SCHEME, {
			provideTextDocumentContent: uri => sessions.resolve(uri.toString())?.text ?? 'This demo preview has expired. Drag the snippet again.',
		}),
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
	return { tree, dropProvider, sessions, catalog };
}
