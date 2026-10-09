import * as vscode from 'vscode';
import type { AssetLocation } from '../storage/discovery';
import type { InsertMode } from '../core/insertion/modes';
export interface InsertRequest { readonly asset: AssetLocation; readonly mode?: InsertMode | 'choose'; readonly target?: { readonly uri: vscode.Uri; readonly version: number; readonly selection: vscode.Selection } }
export class InsertionAdapter implements vscode.Disposable {
	private target?: InsertRequest['target'];
	private readonly subscriptions: vscode.Disposable[];
	/** All product Insert commands attach the sole pipeline here. */
	handler?: (request: InsertRequest) => Promise<void>;
	lastRequest?: InsertRequest;
	constructor() {
		const remember = (editor: vscode.TextEditor | undefined) => { if (editor && !editor.document.isClosed && ['file', 'untitled'].includes(editor.document.uri.scheme)) { this.target = { uri: editor.document.uri, version: editor.document.version, selection: editor.selection }; } };
		remember(vscode.window.activeTextEditor);
		this.subscriptions = [vscode.window.onDidChangeActiveTextEditor(remember), vscode.window.onDidChangeTextEditorSelection(event => remember(event.textEditor))];
	}
	capture(): InsertRequest['target'] {
		const editor = vscode.window.activeTextEditor;
		if (editor && ['file', 'untitled'].includes(editor.document.uri.scheme) && editor.selections.length !== 1) { return undefined; }
		if (editor && !editor.document.isClosed && ['file', 'untitled'].includes(editor.document.uri.scheme)) { this.target = { uri: editor.document.uri, version: editor.document.version, selection: editor.selection }; }
		const doc = this.target && vscode.workspace.textDocuments.find(doc => doc.uri.toString() === this.target!.uri.toString() && !doc.isClosed);
		if (doc && this.target && doc.version === this.target.version) { return this.target; }
		return undefined;
	}
	async request(asset: AssetLocation, mode?: InsertRequest['mode'], target = this.capture()): Promise<void> {
		this.lastRequest = { asset, target, mode };
		if (this.handler) { await this.handler(this.lastRequest); }
		else { void vscode.window.showInformationMessage('Insert is prepared for Phase 3. The insertion pipeline is not installed yet.'); }
	}
	dispose(): void { this.subscriptions.forEach(item => item.dispose()); }
}
