import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DragSessions, URI_LIST_MIME } from '../core/insertion/dragSessions';
import type { DemoSnippet } from '../core/insertion/plan';
import { SnippetDropProvider } from '../ui/dropProvider';
import { demoSnippets, dropTargetText } from './fixtures';

export const LAB_MIME = 'application/vnd.turbo-code-palette.ux-lab';
export const LAB_KIND = vscode.DocumentDropOrPasteEditKind.Empty.append('tcp', 'ux-lab');
export type LabPayload = 'custom' | 'uri' | 'plain-token' | 'mixed';
interface LabItem { readonly payload: LabPayload; readonly snippet: DemoSnippet }

/** Opt-in, synthetic Phase 0 experiment. No asset storage or production UX decision. */
export class UxLab implements vscode.TreeDataProvider<LabItem>, vscode.TreeDragAndDropController<LabItem>,
	vscode.DocumentDropEditProvider, vscode.WebviewViewProvider, vscode.Disposable {
	readonly dragMimeTypes = [LAB_MIME, URI_LIST_MIME, 'text/plain'];
	readonly dropMimeTypes: readonly string[] = [];
	readonly sessions = new DragSessions(randomUUID);
	readonly items: readonly LabItem[] = ['uri', 'custom', 'plain-token', 'mixed'].map(payload =>
		({ payload: payload as LabPayload, snippet: demoSnippets[0] }));
	private readonly planner = new SnippetDropProvider(this.sessions);
	private readonly disposables: vscode.Disposable[] = [];
	private readonly events: object[] = [];
	private target?: vscode.TextDocument;
	private enabled = false;
	private webview?: vscode.Webview;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.disposables.push(vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document === this.target) { this.record('target-change'); }
		}), vscode.workspace.onDidChangeConfiguration(event => {
			if (this.enabled && event.affectsConfiguration('editor.dropIntoEditor')) { this.record('configuration'); }
		}));
	}

	getTreeItem(item: LabItem): vscode.TreeItem {
		const treeItem = new vscode.TreeItem(`Native ${item.payload}`);
		treeItem.id = `tcp.lab.${item.payload}`;
		treeItem.tooltip = 'Research only: compare normal drop with late-Shift drop.';
		return treeItem;
	}
	getChildren(parent?: LabItem): LabItem[] { return parent ? [] : [...this.items]; }
	handleDrag(source: readonly LabItem[], transfer: vscode.DataTransfer, token: vscode.CancellationToken): void {
		if (!this.enabled || token.isCancellationRequested || source.length !== 1 || !this.items.includes(source[0])) { return; }
		const item = source[0];
		const value = this.sessions.issue(item.snippet);
		if (item.payload === 'custom' || item.payload === 'mixed') { transfer.set(LAB_MIME, new vscode.DataTransferItem(value)); }
		if (item.payload === 'uri' || item.payload === 'mixed') { transfer.set(URI_LIST_MIME, new vscode.DataTransferItem(value)); }
		if (item.payload === 'plain-token') { transfer.set('text/plain', new vscode.DataTransferItem(value)); }
		this.record('native-drag', { payload: item.payload });
	}

	async provideDocumentDropEdits(document: vscode.TextDocument, position: vscode.Position,
		transfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<vscode.DocumentDropEdit | undefined> {
		if (!this.enabled) { return undefined; }
		const version = document.version;
		const knownTypes = [LAB_MIME, URI_LIST_MIME, 'text/plain'].filter(mime => transfer.get(mime));
		this.record('provider-request', { knownTypes, line: position.line, character: position.character });
		const references: string[] = [];
		for (const mime of knownTypes) {
			const value = await transfer.get(mime)!.asString();
			const issued = value.length <= 4096 && !!this.sessions.resolveTransfer(value);
			this.record('transfer-check', { mime, length: value.length, issued });
			if (!issued) {
				this.record('provider-reject', { reason: 'non-local-or-invalid-transfer' });
				return undefined;
			}
			references.push(value);
		}
		if (!references.length || new Set(references).size !== 1 || token.isCancellationRequested || document.version !== version) {
			this.record('provider-reject');
			return undefined;
		}
		const normalized = new vscode.DataTransfer();
		normalized.set(URI_LIST_MIME, new vscode.DataTransferItem(references[0]));
		const result = await this.planner.provideDocumentDropEdits(document, position, normalized, token);
		if (result) {
			result.kind = LAB_KIND;
			result.title = 'TCP UX Lab: ' + result.title;
			this.record('provider-propose', { mode: this.planner.diagnostics.last?.mode });
		} else { this.record('provider-reject'); }
		return result;
	}

	async open(): Promise<void> {
		this.enabled = true;
		await vscode.commands.executeCommand('setContext', 'tcp.uxLab', true);
		this.target = await vscode.workspace.openTextDocument({ content: dropTargetText, language: 'plaintext' });
		const editor = await vscode.window.showTextDocument(this.target, { preview: false });
		editor.selection = new vscode.Selection(2, 0, 2, 0);
		await vscode.commands.executeCommand('turbo-code-palette.uxCards.focus');
		this.record('open');
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.webview = view.webview;
		view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
		const nonce = randomUUID().replace(/-/g, '');
		const script = view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'ux-lab.js'));
		view.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';">
		<style nonce="${nonce}">body{font-family:var(--vscode-font-family);padding:8px;color:var(--vscode-foreground)}
		select,button{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);padding:5px}
		.card{border:1px solid var(--vscode-panel-border);padding:12px;margin-top:10px;cursor:grab}
		.card:focus{outline:1px solid var(--vscode-focusBorder)}p{font-size:12px}button{margin-top:8px}</style></head><body>
		<label>Payload <select id="payload"><option value="custom">Custom MIME</option><option value="uri">URI list</option>
		<option value="plain-token">Plain token</option><option value="raw">Plain raw text (control)</option></select></label>
		<p>Research only. Drag a card into the editor, first without Shift. Insert buttons use the remembered cursor.</p>
		<div class="card" draggable="true" tabindex="0" data-index="0">Web Cursor demo</div><button data-insert="0">Insert Cursor demo</button>
		<div class="card" draggable="true" tabindex="0" data-index="1">Web EOF demo</div><button data-insert="1">Insert EOF demo</button>
		<p id="status" role="status">Preparing drag references…</p><script nonce="${nonce}" src="${script}"></script></body></html>`;
		this.disposables.push(view.webview.onDidReceiveMessage(async (message: unknown) => {
			if (!message || typeof message !== 'object') { return; }
			const event = message as { type?: unknown; index?: unknown; payload?: unknown };
			if (event.type === 'ready' || event.type === 'renew') { this.refreshCards(); }
			if (event.type === 'drag' && [0, 1].includes(event.index as number)
				&& ['custom', 'uri', 'plain-token', 'raw'].includes(event.payload as string)) {
				this.record('web-drag', { index: event.index, payload: event.payload });
			}
			if (event.type === 'insert' && [0, 1].includes(event.index as number)) {
				await vscode.commands.executeCommand('turbo-code-palette.insertDemo', demoSnippets[event.index as number]);
				this.record('web-insert', { index: event.index });
			}
		}));
	}
	private refreshCards(): void {
		void this.webview?.postMessage({ type: 'cards', cards: demoSnippets.map(snippet => ({
			reference: this.sessions.issue(snippet), text: snippet.text,
		})) });
	}
	get diagnostics(): object {
		const config = vscode.workspace.getConfiguration('editor.dropIntoEditor', this.target?.uri);
		return { version: vscode.version, platform: process.platform,
			enabled: config.get('enabled'), preferences: config.get('preferences'),
			target: this.targetState(),
			planner: this.planner.diagnostics, events: [...this.events] };
	}
	private targetState(): object | undefined {
		const text = this.target?.getText();
		return text === undefined ? undefined : { initial: text === dropTargetText, length: text.length,
			occurrences: demoSnippets.map(snippet => text.split(snippet.text).length - 1) };
	}
	private record(event: string, fields: object = {}): void {
		this.events.push({ event, ...fields, ...(event === 'target-change' ? { target: this.targetState() } : {}) });
		if (this.events.length > 80) { this.events.shift(); }
		// Isolated research launcher only; never includes paths, source, or drag references.
		if (process.env.TCP_UX_LAB === '1') {
			const directory = join(this.context.extensionPath, '.vscode-test');
			mkdirSync(directory, { recursive: true });
			writeFileSync(join(directory, `ux-lab-${vscode.version}.json`), JSON.stringify(this.diagnostics, null, 2));
		}
	}
	dispose(): void {
		for (const disposable of this.disposables) { disposable.dispose(); }
		this.sessions.clear();
	}
}
