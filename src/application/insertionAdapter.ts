import * as vscode from 'vscode';
import type { AssetLocation } from '../storage/discovery';
export interface InsertRequest { readonly asset: AssetLocation; readonly target?: { readonly uri: vscode.Uri; readonly version: number; readonly selection: vscode.Selection } }
export class InsertionAdapter implements vscode.Disposable {
	private target?: InsertRequest['target'];
	private readonly subscriptions: vscode.Disposable[];
	/** Phase 3 attaches the sole pipeline here. Phase 2 never edits a document. */
	handler?: (request: InsertRequest) => Promise<void>;
	lastRequest?: InsertRequest;
	constructor() {
		const remember = (editor: vscode.TextEditor | undefined) => { if (editor && !editor.document.isClosed) { this.target = { uri: editor.document.uri, version: editor.document.version, selection: editor.selection }; } };
		remember(vscode.window.activeTextEditor);
		this.subscriptions = [vscode.window.onDidChangeActiveTextEditor(remember), vscode.window.onDidChangeTextEditorSelection(event => remember(event.textEditor))];
	}
	async request(asset: AssetLocation): Promise<void> {
		this.lastRequest = { asset, target: this.target };
		if (this.handler) { await this.handler(this.lastRequest); }
		else { void vscode.window.showInformationMessage('Insert is prepared for Phase 3. The insertion pipeline is not installed yet.'); }
	}
	dispose(): void { this.subscriptions.forEach(item => item.dispose()); }
}
