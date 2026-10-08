import * as vscode from 'vscode';
import { DragSessions, URI_LIST_MIME } from '../core/insertion/dragSessions';
import { planDemoInsertion, type DemoMode } from '../core/insertion/plan';

export const DROP_KIND = vscode.DocumentDropOrPasteEditKind.Empty.append('tcp', 'phase0');

export interface DropDiagnostics {
	readonly requested: number;
	readonly accepted: number;
	readonly rejected: number;
	readonly last?: { readonly mode: DemoMode; readonly line: number; readonly character: number };
}

export class SnippetDropProvider implements vscode.DocumentDropEditProvider {
	private requested = 0;
	private accepted = 0;
	private rejected = 0;
	private last: DropDiagnostics['last'];

	constructor(private readonly sessions: DragSessions) {}

	async provideDocumentDropEdits(
		document: vscode.TextDocument,
		position: vscode.Position,
		transfer: vscode.DataTransfer,
		token: vscode.CancellationToken,
	): Promise<vscode.DocumentDropEdit | undefined> {
		this.requested++;
		const version = document.version;
		if (!vscode.workspace.getConfiguration('editor.dropIntoEditor', document.uri).get<boolean>('enabled', true)) {
			this.rejected++;
			return undefined;
		}
		const item = transfer.get(URI_LIST_MIME);
		const snippet = !token.isCancellationRequested && item
			? this.sessions.resolveTransfer(await item.asString()) : undefined;
		if (!snippet || token.isCancellationRequested || document.isClosed || document.version !== version
			|| !document.validatePosition(position).isEqual(position)) {
			this.rejected++;
			return undefined;
		}
		const plan = planDemoInsertion(snippet, document.getText(), document.offsetAt(position),
			document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
		const edit = new vscode.DocumentDropEdit(snippet.mode === 'cursor' ? plan.text : '',
			`Insert ${snippet.name}`, DROP_KIND);
		if (snippet.mode === 'end-of-file') {
			edit.additionalEdit = new vscode.WorkspaceEdit();
			edit.additionalEdit.insert(document.uri, document.positionAt(plan.offset), plan.text);
		}
		this.accepted++;
		this.last = { mode: snippet.mode, line: position.line, character: position.character };
		return edit;
	}

	get diagnostics(): DropDiagnostics {
		return { requested: this.requested, accepted: this.accepted, rejected: this.rejected, last: this.last };
	}
}
