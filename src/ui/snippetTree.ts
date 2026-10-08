import * as vscode from 'vscode';
import { DragSessions, URI_LIST_MIME } from '../core/insertion/dragSessions';
import type { DemoSnippet } from '../core/insertion/plan';

export class SnippetTree implements vscode.TreeDataProvider<DemoSnippet>, vscode.TreeDragAndDropController<DemoSnippet> {
	readonly dragMimeTypes = [URI_LIST_MIME];
	readonly dropMimeTypes: readonly string[] = [];
	private dragCount = 0;

	constructor(readonly snippets: readonly DemoSnippet[], private readonly sessions: DragSessions) {}

	getTreeItem(snippet: DemoSnippet): vscode.TreeItem {
		const item = new vscode.TreeItem(snippet.name);
		item.id = snippet.id;
		item.description = snippet.mode;
		item.contextValue = 'tcp.phase0.snippet';
		item.iconPath = new vscode.ThemeIcon('code');
		item.tooltip = `${snippet.name}: Drag into the editor, then hold Shift before releasing. Or use Insert Demo Snippet.`;
		item.command = { command: 'turbo-code-palette.previewDemo', title: 'Preview', arguments: [snippet] };
		return item;
	}

	getChildren(element?: DemoSnippet): DemoSnippet[] {
		return element ? [] : [...this.snippets];
	}

	handleDrag(source: readonly DemoSnippet[], transfer: vscode.DataTransfer, token: vscode.CancellationToken): void {
		if (token.isCancellationRequested || source.length !== 1 || !this.snippets.includes(source[0])) {
			return;
		}
		transfer.set(URI_LIST_MIME, new vscode.DataTransferItem(this.sessions.issue(source[0])));
		this.dragCount++;
	}

	get diagnostics(): { dragCount: number } {
		return { dragCount: this.dragCount };
	}
}
