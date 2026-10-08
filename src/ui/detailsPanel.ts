import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { AssetLocation } from '../storage/discovery';
import { locationKey } from '../application/library';
import { nextVersion } from '../core/version/parser';

export const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export interface FormSeed { readonly kind: 'snippet' | 'pack'; readonly asset?: AssetLocation; readonly name?: string; readonly language?: string; readonly sourceName?: string; readonly members?: readonly AssetLocation[]; readonly destination?: string }
const button = (action: string, title: string, key?: string, source?: string) => `<button type="button" data-action="${action}"${key ? ` data-key="${escapeHtml(key)}"` : ''}${source ? ` data-source="${escapeHtml(source)}"` : ''}>${title}</button>`;
const field = (name: string, title: string, value: string, multi = false) => `<label>${title}${multi ? `<textarea name="${name}" data-base="${escapeHtml(value)}">${escapeHtml(value)}</textarea>` : `<input name="${name}" value="${escapeHtml(value)}" data-base="${escapeHtml(value)}"${['name', 'version'].includes(name) ? ' required' : ''}>`}</label>`;
export class DetailsPanel implements vscode.Disposable {
	private panel?: vscode.WebviewPanel;
	private token = '';
	private dirty = false;
	private renderId = 0;
	current?: { readonly asset?: AssetLocation; readonly seed?: FormSeed };
	constructor(private readonly extensionUri: vscode.Uri, private readonly onMessage: (message: Record<string, unknown>) => Promise<void>) {}
	get instance(): vscode.WebviewPanel | undefined { return this.panel; }
	get session(): string { return this.token; }
	async accept(raw: unknown): Promise<void> {
		if (!this.panel || !this.token || !raw || typeof raw !== 'object' || Array.isArray(raw)) { return; }
		const message = raw as Record<string, unknown>; if (message.token !== this.token || typeof message.action !== 'string') { return; }
		if (message.action === 'dirty') { this.dirty = true; return; }
		if (message.action === 'cancel') { this.dirty = false; }
		await this.onMessage(message);
	}
	private async show(body: string, current: NonNullable<DetailsPanel['current']>): Promise<boolean> {
		const request = ++this.renderId;
		if (this.dirty && await vscode.window.showWarningMessage('Discard unsaved metadata form changes?', { modal: true }, 'Discard') !== 'Discard') { return false; }
		if (request !== this.renderId) { return false; }
		if (!this.panel) {
			this.panel = vscode.window.createWebviewPanel('tcp.details', 'Turbo Code Palette', vscode.ViewColumn.One,
				{ enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')], retainContextWhenHidden: true });
			this.panel.onDidDispose(() => { this.panel = undefined; this.dirty = false; this.current = undefined; this.token = ''; ++this.renderId; });
			this.panel.webview.onDidReceiveMessage(message => { void this.accept(message).catch(error => { const text = error instanceof Error ? error.message : 'Operation failed.'; this.post({ type: 'error', token: this.token, text }); void vscode.window.showErrorMessage(text); }); });
		}
		this.current = current; this.dirty = false; this.token = randomBytes(24).toString('hex');
		const webview = this.panel.webview, script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media/palette-panel.js')),
			style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media/palette-panel.css'));
		webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${this.token}';"><link rel="stylesheet" href="${style}"></head><body data-token="${this.token}">${body}<p id="feedback" role="status"></p><script nonce="${this.token}" src="${script}"></script></body></html>`;
		this.panel.reveal(vscode.ViewColumn.One, true); return true;
	}
	async details(asset: AssetLocation, versions: readonly AssetLocation[], members: readonly AssetLocation[], previews: readonly { name: string; text: string }[], state: { favorite: boolean; usage: number }): Promise<void> {
		const m = asset.metadata, key = locationKey(asset);
		const actions = [m.kind === 'snippet' ? button('insert', 'Insert', key) : '', button('edit', 'Edit metadata', key), button('favorite', state.favorite ? 'Unfavorite' : 'Favorite', key),
			button('copyWorkspace', 'Copy to Workspace', key), button('copyGlobal', 'Copy to Global', key), button('delete', 'Delete', key), button('rawMetadata', 'Open raw metadata', key), m.document.format === 'legacy' ? button('upgrade', 'Upgrade format', key) : ''].join(' ');
		const locations = versions.map(item => `<li>${button('details', escapeHtml(`${item.metadata.version!.text} · ${item.root.scope} · ${item.packName}/${item.relativePath.split('/').slice(1).join('/')}`), locationKey(item))}</li>`).join('');
		const body = `<h1>${escapeHtml(m.name)}</h1><p>${escapeHtml(m.description)}</p><p>${escapeHtml(m.version!.text)} · ${escapeHtml(asset.root.scope)} · ${escapeHtml(asset.packName)} · format ${escapeHtml(m.document.format)}</p><nav>${actions}</nav>
			${m.issues.length ? `<p class="notice">${escapeHtml(m.issues.map(issue => issue.code).join(', '))}</p>` : ''}
			${m.kind === 'pack' ? `<h2>Snippets</h2><ul>${members.map(item => `<li>${button('details', escapeHtml(item.metadata.name + ' ' + item.metadata.version!.text), locationKey(item))} ${button('insert', 'Insert', locationKey(item))}</li>`).join('')}</ul>` : `<h2>Features</h2><p>${escapeHtml(m.features.join(' · ') || '—')}</p><h2>Sources</h2>${previews.map(preview => `<details><summary>${escapeHtml(preview.name)}</summary>${button('source', 'Open source in editor', key, preview.name)}<pre>${escapeHtml(preview.text)}</pre></details>`).join('')}`}
			<h2>Versions / locations</h2><ul>${locations}</ul><details><summary>Metadata / unknown fields</summary><p>Complete original JSON, including all unknown fields. Structured edits preserve untouched fields.</p><pre>${escapeHtml(m.document.text)}</pre></details>
			<details><summary>User state</summary><p>Successful insertions: ${state.usage}</p></details>`;
		await this.show(body, { asset });
	}
	async form(seed: FormSeed): Promise<boolean> {
		const m = seed.asset?.metadata, doc = m?.document;
		const value = (key: string) => doc?.string([key]) ?? '';
		const strings = (key: string) => (doc?.node([key])?.children ?? []).map(node => node.value).join('\n');
		const dependencies = (doc?.node(['dependencies'])?.children ?? []).map((_, index) => `<li data-dependency data-index="${index}" data-id="${escapeHtml(doc!.string(['dependencies', index, 'id']))}" data-name="${escapeHtml(doc!.string(['dependencies', index, 'name']))}"><span>${escapeHtml(doc!.string(['dependencies', index, 'name']))}</span><label>Version constraint<input data-constraint value="${escapeHtml(doc!.string(['dependencies', index, 'version']) ?? '')}"></label>${button('removeDependency', 'Remove')}</li>`).join('');
		const members = seed.members?.map(member => `<li data-member data-key="${escapeHtml(locationKey(member))}"><span>${escapeHtml(member.metadata.name)} ${escapeHtml(member.metadata.version!.text)}</span> ${button('removeMember', 'Remove')}</li>`).join('') ?? '';
		const shown = await this.show(`<h1>${seed.asset ? 'Edit' : 'Create'} ${seed.kind === 'pack' ? 'Pack' : 'Snippet'}</h1><p>${escapeHtml(seed.destination ?? seed.asset?.root.scope)}</p><form id="metadata" data-kind="${seed.kind}" data-new="${seed.asset ? 'false' : 'true'}">
			${field('name', 'Name', m?.name ?? seed.name ?? '')}${field('version', 'Version', m?.version ? nextVersion(m.version) : 'v1.0.0')}${field('description', 'Description', value('description'), true)}
			${seed.kind === 'snippet' ? field('languages', 'Languages (one per line)', doc ? strings('languages') : seed.language ?? '', true) + (seed.asset ? field('sources', 'Sources (existing files, relative to this Snippet)', strings('sources'), true) + '<p>Edit source code in the normal VS Code editor using the detail view’s Open source button. Metadata changes need a newer Snippet version.</p>' : field('sourceName', 'Source filename', seed.sourceName ?? 'code.txt')) : `<h2>Snippets</h2><ul id="members">${members}</ul><label>Search Snippets<input id="member-query" placeholder='name lang:"C#"'></label>${button('searchMembers', 'Search / add')}<ul id="candidates"></ul><p id="closure" role="status">Dependencies are automatically included. Preview before saving.</p>${button('preview', 'Preview dependency closure')}`}
			<details><summary>Advanced / optional</summary>${field('tags', 'Tags (one per line)', strings('tags'), true)}${field('features', 'Features (one per line)', strings('features'), true)}${field('authors', 'Authors (one per line; existing object fields are preserved)', m?.authors.join('\n') ?? '', true)}${field('category', 'Category', value('category'))}${field('status', 'Status', value('status'))}${field('notes', 'Notes', value('notes'), true)}
			${seed.kind === 'snippet' ? `<h2>Dependencies</h2><ul id="dependencies">${dependencies}</ul><label>Search dependency<input id="dependency-query"></label>${button('searchDependencies', 'Search / add dependency')}<ul id="dependency-candidates"></ul>` : ''}
			<details><summary>Other / unknown metadata (preserved)</summary><pre>${escapeHtml(doc?.text ?? '{}')}</pre></details></details>
			<p>Cancel leaves library files unchanged. A changed asset needs a newer version; format-only migration does not.</p><button type="submit">Save</button> ${button('cancel', 'Cancel')}</form>`, { asset: seed.asset, seed });
		if (shown) { this.panel?.reveal(vscode.ViewColumn.One, false); } return shown;
	}
	saved(): void { this.dirty = false; }
	post(value: unknown): void { if (this.panel) { void this.panel.webview.postMessage(value); } }
	dispose(): void { this.panel?.dispose(); }
}
