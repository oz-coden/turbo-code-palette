import * as vscode from 'vscode';
import * as path from 'node:path';
import { Library, locationKey, packOf, sameRoot, type DependencyRow, type MetadataFields } from './library';
import { UserState } from './userState';
import { ChangeTracker } from './changes';
import { InsertionAdapter } from './insertionAdapter';
import { InsertionPipeline } from './insertionPipeline';
import { AssetTree, type AssetRow } from '../ui/assetTree';
import { DetailsPanel, type FormSeed } from '../ui/detailsPanel';
import { nativeStore } from '../storage/store';
import { vscodeStore } from '../storage/vscodeStore';
import { resolveRoots, type StorageRoot } from '../storage/roots';
import { loadCatalog, type AssetLocation } from '../storage/discovery';
import { containedPath, validateRelativePath, validateStoragePath } from '../storage/safePaths';
import { searchAssets, modifierSuggestions } from '../core/search/index';
import { resolveClosure } from '../core/dependency/resolver';
import { pendingRecovery, recover } from '../storage/recovery';

interface Creation { root: StorageRoot; packName?: string; bytes: Buffer }
export function captureSnippet(mode: 'new' | 'selection' | 'file', editor?: vscode.TextEditor): { bytes: Buffer; name: string; sourceName: string; language: string } {
	if (mode === 'new') { return { bytes: Buffer.alloc(0), name: '', sourceName: 'code.txt', language: '' }; }
	if (!editor || mode === 'selection' && editor.selection.isEmpty) { throw new Error('Select code in an editor first.'); }
	const sourceName = path.basename(editor.document.uri.path) || 'code.txt';
	return { bytes: Buffer.from(mode === 'selection' ? editor.document.getText(editor.selection) : editor.document.getText()), sourceName, language: editor.document.languageId, name: sourceName.replace(/\.[^.]+$/, '') };
}
const prefix = 'turbo-code-palette.';
export class LibraryController implements vscode.Disposable {
	readonly library: Library;
	readonly state: UserState;
	readonly snippets: AssetTree;
	readonly packs: AssetTree;
	readonly snippetView: vscode.TreeView<AssetRow>;
	readonly packView: vscode.TreeView<AssetRow>;
	readonly panel: DetailsPanel;
	readonly insertion = new InsertionAdapter();
	readonly pipeline: InsertionPipeline;
	readonly changes: ChangeTracker;
	private readonly subscriptions: vscode.Disposable[] = [];
	private watchers: vscode.Disposable[] = [];
	private creation?: Creation;
	private watchedRoots = '';
	private busy = false;
	private rootsDirty = false;
	private detailsGeneration = 0;
	private readonly recoveryNotified = new Set<string>();
	constructor(private readonly context: vscode.ExtensionContext, readonly roots: () => readonly StorageRoot[] = () => this.configuredRoots()) {
		this.library = new Library(roots, root => {
			if (!root.uri) { return nativeStore(root); }
			const uri = vscode.Uri.parse(root.uri), store = vscodeStore(uri);
			if (['file', 'vscode-userdata'].includes(uri.scheme)) { return store; }
			const refuse = async () => { throw new Error('Write support for this filesystem provider is not verified. Use a local workspace or configure a normal Global folder.'); };
			return { ...store, mkdir: refuse, writeNew: refuse, rename: refuse, remove: refuse };
		}, async (roots, packs) => {
			if (this.rootsDirty) { throw new Error('Library roots changed. Reload before applying.'); }
			for (const document of vscode.workspace.textDocuments.filter(doc => doc.isDirty)) {
				for (const [index, root] of roots.entries()) {
					const uri = this.rootUri(root), base = uri.path.replace(/\/$/, '');
					const canonical = (text: string) => uri.scheme === 'file' && process.platform === 'win32' ? text.toLowerCase() : text;
					const relative = canonical(document.uri.path.slice(base.length + 1));
					const starts = document.uri.scheme === uri.scheme && document.uri.authority === uri.authority && canonical(document.uri.path).startsWith(canonical(base) + '/');
					const pack = packs[index];
					if (starts && pack && (relative === canonical(pack) || relative.startsWith(canonical(pack) + '/'))) { throw new Error('Save or revert dirty library source/metadata editors before applying.'); }
				}
			}
		});
		this.state = new UserState(context.globalState); this.snippets = new AssetTree(this.library.catalog, 'snippet', this.state); this.packs = new AssetTree(this.library.catalog, 'pack', this.state);
		this.pipeline = new InsertionPipeline(this.library, this.state, () => { if (this.rootsDirty || this.busy) { throw new Error('Library is changing. Finish the save / Reload before Insert.'); } });
		this.insertion.handler = async request => { const result = await this.pipeline.run(request); if (result === 'already-present') { void vscode.window.showInformationMessage('This Snippet and its dependencies are already present in the verified editor state.'); } this.refresh(); };
		this.snippetView = vscode.window.createTreeView(prefix + 'snippets', { treeDataProvider: this.snippets, canSelectMany: true });
		this.packView = vscode.window.createTreeView(prefix + 'packs', { treeDataProvider: this.packs, canSelectMany: true });
		this.panel = new DetailsPanel(context.extensionUri, message => this.message(message));
		this.changes = new ChangeTracker(() => this.library.catalog.snapshot, async () => {
			if (this.busy) { this.changes.event(); return this.library.catalog.snapshot ?? await loadCatalog([], this.library.stores); }
			return loadCatalog(this.roots(), this.library.stores);
		}, async () => {
			const choice = await vscode.window.showInformationMessage('Turbo Code Palette: library changed externally. Reload to update the loaded library.', 'Reload', 'Later');
			if (choice === 'Reload') { try { await this.reload(); } catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Reload failed.'); } }
		}, pending => { this.snippetView.badge = pending ? { value: 1, tooltip: 'External changes pending — Reload library' } : undefined; this.packView.badge = this.snippetView.badge; });
		this.subscriptions.push(this.snippets, this.packs, this.snippetView, this.packView, this.panel, this.insertion, this.pipeline, this.changes);
		const register = (name: string, callback: (...args: unknown[]) => Promise<unknown>) => this.subscriptions.push(vscode.commands.registerCommand(prefix + name, (...args: unknown[]) => callback(...args).catch(error => {
			void vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Operation failed.');
		})));
		register('reloadCatalog', () => this.reload());
		register('searchCatalog', async query => {
			if (!this.library.catalog.snapshot) { await this.reload(); }
			if (typeof query === 'string') { const result = this.library.catalog.search(query); return { errors: result.errors, hits: result.hits.map(hit => ({ key: hit.group.key, name: hit.locations[0].metadata.name, version: hit.locations[0].metadata.version!.text, status: hit.group.status, canInsert: hit.canInsert, scopes: [...new Set(hit.locations.map(asset => asset.root.scope))] })) }; }
			return this.searchView(this.snippets);
		});
		register('searchPacks', async () => { if (!this.library.catalog.snapshot) { await this.reload(); } await this.searchView(this.packs); });
		register('details', async input => { const asset = await this.choose(input); if (asset) { await this.showDetails(asset); } });
		register('edit', async input => { const asset = await this.choose(input, undefined, true); if (asset) { await this.edit(asset); } });
		register('newSnippet', () => this.create('new'));
		register('createSelection', () => this.create('selection'));
		register('createFile', () => this.create('file'));
		register('createPack', () => this.create('pack'));
		for (const [command, scope] of [['copyWorkspace', 'workspace'], ['copyGlobal', 'global']] as const) { register(command, input => this.copy(input, scope)); }
		register('delete', input => this.delete(input));
		register('favorite', async input => { const asset = await this.choose(input); if (asset) { await this.state.toggle(this.logicalKey(asset)); this.refresh(); if (!this.panel.current?.seed && this.panel.current?.asset && locationKey(this.panel.current.asset) === locationKey(asset)) { await this.showDetails(asset); } } });
		register('filter', async () => {
			const choice = await vscode.window.showQuickPick(['All', 'Favorites', 'Recent']); if (!choice) { return; }
			this.snippets.filter = this.packs.filter = choice === 'All' ? 'all' : choice.toLowerCase() as 'favorites' | 'recent'; this.refresh();
		});
		const insert = async (input?: unknown, chooseMode = false) => { const target = this.insertion.capture(); if (!target) { throw new Error('Open a project text editor and select the insertion position first.'); } const asset = await this.choose(input, 'snippet'); if (asset) { await this.insertion.request(asset, chooseMode ? 'choose' : undefined, target); } };
		register('insert', input => insert(input));
		register('insertWithMode', input => insert(input, true));
		register('upgrade', async input => { const asset = await this.choose(input, undefined, true); if (asset) { await this.mutate(() => this.library.upgrade(asset)); await this.showDetails(this.find(locationKey(asset))); } });
		register('openGlobalFolder', () => this.openGlobal(false)); register('revealGlobalFolder', () => this.openGlobal(true));
		register('configureGlobalRoot', async () => {
			const chosen = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Use as Global library' });
			if (chosen?.[0]) { if (chosen[0].scheme !== 'file') { throw new Error('Choose a local directory on the extension host.'); } await vscode.workspace.getConfiguration('turboCodePalette').update('globalRoot', chosen[0].fsPath, vscode.ConfigurationTarget.Global); }
		});
		register('reviewRecovery', () => this.reviewRecovery());
		const rootsChanged = () => { this.rootsDirty = true; void this.changes.changed().catch(() => {}); };
		this.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('turboCodePalette.globalRoot')) { rootsChanged(); } }),
			vscode.workspace.onDidChangeWorkspaceFolders(rootsChanged));
		void this.reload().catch(error => { void vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Library load failed.'); });
	}
	private configuredRoots(): StorageRoot[] {
		const config = vscode.workspace.getConfiguration('turboCodePalette').get<string>('globalRoot');
		const workspaces = vscode.workspace.workspaceFolders ?? [];
		const roots = resolveRoots(this.context.globalStorageUri.fsPath, workspaces.filter(folder => folder.uri.scheme === 'file').map(folder => ({ id: folder.uri.toString(), path: folder.uri.fsPath })), config || undefined);
		for (const folder of workspaces.filter(folder => folder.uri.scheme !== 'file')) { const uri = vscode.Uri.joinPath(folder.uri, '.snippets'); roots.unshift({ scope: 'workspace', workspaceId: folder.uri.toString(), path: uri.toString(), uri: uri.toString() }); }
		if (!config && this.context.globalStorageUri.scheme !== 'file') { const uri = vscode.Uri.joinPath(this.context.globalStorageUri, 'snippets'); roots[roots.length - 1] = { scope: 'global', path: uri.toString(), uri: uri.toString() }; }
		return roots;
	}
	rootUri(root: StorageRoot): vscode.Uri { return root.uri ? vscode.Uri.parse(root.uri) : vscode.Uri.file(root.path); }
	assetUri(asset: AssetLocation, relative = ''): vscode.Uri {
		if (relative) { validateRelativePath(relative); }
		const joined = asset.relativePath + (relative ? '/' + relative : ''); validateStoragePath(joined);
		return asset.root.uri ? vscode.Uri.joinPath(this.rootUri(asset.root), joined) : vscode.Uri.file(containedPath(asset.root.path, joined));
	}
	async reload(): Promise<{ snippets: number; packs: number; diagnostics: { scope: string; code: string }[] }> {
		if (this.busy) { throw new Error('Wait for the current library save to finish before Reload.'); }
		this.rootsDirty = false; const snapshot = await this.library.reload(); if (!this.rootsDirty) { this.changes.reloaded(); } this.refresh();
		const roots = this.roots(), stamp = JSON.stringify(roots);
		if (this.watchedRoots !== stamp) {
			this.watchers.forEach(item => item.dispose()); this.watchers = []; this.watchedRoots = stamp;
			for (const root of roots) {
				const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.rootUri(root), '**/*'));
				const event = (uri: vscode.Uri) => { if (!/\/(?:\.tcp-staging|\.tcp-transactions)(?:\/|$)/.test(uri.path)) { this.changes.event(); } };
				this.watchers.push(watcher, watcher.onDidCreate(event), watcher.onDidChange(event), watcher.onDidDelete(event));
			}
		}
		void vscode.commands.executeCommand('setContext', 'tcp.hasWorkspace', roots.some(root => root.scope === 'workspace'));
		for (const root of roots) {
			try {
				const records = await pendingRecovery(this.library.stores(root));
				for (const record of records) { const key = JSON.stringify([root.uri ?? root.path, record.id]); if (!this.recoveryNotified.has(key)) { this.recoveryNotified.add(key); void vscode.window.showWarningMessage('Turbo Code Palette: an interrupted save has recovery data. Use Review Interrupted Save to inspect it.', 'Review').then(choice => { if (choice) { void vscode.commands.executeCommand(prefix + 'reviewRecovery'); } }); } }
			} catch { void vscode.window.showWarningMessage('Turbo Code Palette: recovery data could not be verified. Inspect the library folder before editing.'); }
		}
		return { snippets: snapshot.snippets.length, packs: snapshot.packs.length, diagnostics: snapshot.diagnostics.map(item => ({ scope: item.scope, code: item.code })) };
	}
	refresh(): void { this.snippets.refresh(); this.packs.refresh(); this.snippetView.message = this.snippets.query || 'Select a Snippet to view details.'; this.packView.message = this.packs.query || 'Select a Pack to view details.'; }
	private logicalKey(asset: AssetLocation): string { return `${asset.metadata.kind}:${asset.metadata.id}:${asset.metadata.version!.text}`; }
	find(key: string): AssetLocation {
		const result = [...(this.library.catalog.snapshot?.snippets ?? []), ...(this.library.catalog.snapshot?.packs ?? [])].find(asset => locationKey(asset) === key);
		if (!result) { throw new Error('Item is no longer loaded. Reload and select it again.'); } return result;
	}
	private async choose(input?: unknown, kind?: 'snippet' | 'pack', concrete = false): Promise<AssetLocation | undefined> {
		if (!this.library.catalog.snapshot) { await this.reload(); }
		const key = typeof input === 'string' ? input : input && typeof input === 'object' && 'key' in input ? (input as AssetRow).key : undefined;
		if (key?.startsWith('[')) { const result = this.find(key); if (kind && result.metadata.kind !== kind) { throw new Error('Choose a ' + kind + '.'); } return result; }
		const groups = [...(kind === 'pack' ? [] : this.library.catalog.snapshot!.snippetGroups), ...(kind === 'snippet' ? [] : this.library.catalog.snapshot!.packGroups)];
		const group = key ? groups.find(group => group.key === key) : (await vscode.window.showQuickPick(groups.map(group => ({ label: group.locations[0].metadata.name!, description: group.locations[0].metadata.version!.text + ' · ' + group.locations[0].metadata.kind, group })), { placeHolder: 'Choose a Snippet or Pack' }))?.group;
		if (!group) { return; }
		if (group.locations.length === 1) { return group.locations[0]; }
		if (!concrete && group.status === 'identical') { const workspace = vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)?.uri.toString(); return group.locations.find(asset => asset.root.workspaceId === workspace && workspace) ?? group.locations.find(asset => asset.root.scope === 'workspace') ?? group.locations[0]; }
		return (await vscode.window.showQuickPick(group.locations.map(asset => ({ label: `${asset.metadata.name} ${asset.metadata.version!.text}`, description: asset.root.scope + ' · ' + asset.packName, detail: asset.relativePath + ' · ' + group.status, asset })), { placeHolder: 'Choose a location to inspect or operate on' }))?.asset;
	}
	async showDetails(asset: AssetLocation): Promise<void> {
		const generation = ++this.detailsGeneration;
		const snapshot = this.library.catalog.snapshot!, versions = [...snapshot.snippets, ...snapshot.packs].filter(item => item.metadata.kind === asset.metadata.kind && item.metadata.id === asset.metadata.id);
		const previews: { name: string; text: string }[] = [];
		let bytesBySource: Map<string, Buffer> | undefined;
		try { bytesBySource = await this.library.sources(asset, asset.metadata.sources.slice(0, 20)); } catch { /* Details remain available for stale/dirty sources. */ }
		let previewBudget = 300000, index = 0;
		for (const source of asset.metadata.sources) {
			if (++index > 20 || previewBudget <= 0) { previews.push({ name: source, text: 'Open source to view content. Preview limit reached.' }); continue; }
			try { const bytes = bytesBySource?.get(source); if (!bytes || bytes.includes(0)) { throw new Error('Unavailable/binary source.'); } const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); const limit = Math.min(100000, previewBudget); previews.push({ name: source, text: text.length > limit ? text.slice(0, limit) + '\n[Preview truncated — open source for full content]' : text }); previewBudget -= Math.min(text.length, limit); }
			catch { previews.push({ name: source, text: 'Preview unavailable. Save/revert dirty source editors, or Reload after external changes.' }); }
		}
		if (generation !== this.detailsGeneration) { return; }
		await this.state.touch(this.logicalKey(asset)); if (generation !== this.detailsGeneration) { return; } await this.panel.details(asset, versions, asset.metadata.kind === 'pack' ? this.library.members(asset) : [], previews, this.state.get(this.logicalKey(asset))); this.refresh();
	}
	async edit(asset: AssetLocation): Promise<void> {
		++this.detailsGeneration;
		if (!asset.metadata.canEdit) { throw new Error('Upgrade legacy format or repair metadata before editing. Future formats remain read-only.'); }
		if (await this.panel.form({ kind: asset.metadata.kind, asset, members: asset.metadata.kind === 'pack' ? this.library.members(asset) : undefined })) { this.creation = undefined; }
	}
	private async target(scope?: StorageRoot['scope']): Promise<StorageRoot | undefined> {
		const roots = this.roots().filter(root => !scope || root.scope === scope);
		if (!roots.length) { throw new Error('Open a workspace folder first.'); }
		if (roots.length === 1) { return roots[0]; }
		return (await vscode.window.showQuickPick(roots.map((root, index) => ({ label: root.scope === 'global' ? 'Global' : `Workspace ${index + 1}`, description: root.workspaceId ? vscode.workspace.workspaceFolders?.find(folder => folder.uri.toString() === root.workspaceId)?.name : undefined, root })), { placeHolder: 'Choose destination library' }))?.root;
	}
	private async destination(): Promise<{ name?: string } | undefined> {
		const chosen = await vscode.window.showQuickPick(['Default Pack', 'New Pack'], { placeHolder: 'Choose destination Pack' });
		if (!chosen) { return; } if (chosen === 'Default Pack') { return {}; }
		const name = await vscode.window.showInputBox({ prompt: 'New Pack name', validateInput: value => value.trim() ? undefined : 'Enter a Pack name.' }); return name === undefined ? undefined : { name: name.trim() };
	}
	async create(mode: 'new' | 'selection' | 'file' | 'pack', chosenRoot?: StorageRoot): Promise<void> {
		++this.detailsGeneration;
		const { bytes, name, sourceName, language } = captureSnippet(mode === 'pack' ? 'new' : mode, vscode.window.activeTextEditor);
		if (!this.library.catalog.snapshot) { await this.reload(); }
		if (chosenRoot && !this.roots().some(root => sameRoot(root, chosenRoot))) { throw new Error('Creation target is no longer configured.'); }
		const root = chosenRoot ?? await this.target(); if (!root) { return; }
		const destination = mode === 'pack' ? {} : await this.destination(); if (!destination) { return; }
		const seed: FormSeed = { kind: mode === 'pack' ? 'pack' : 'snippet', name, language, sourceName, members: [], destination: `${root.scope} · ${destination.name ?? (mode === 'pack' ? 'New Pack' : 'Default Pack')}` };
		if (await this.panel.form(seed)) { this.creation = { root, packName: destination.name, bytes }; }
	}
	private async mutate<T>(operation: () => Promise<T>): Promise<T> {
		if (this.rootsDirty) { throw new Error('Library roots changed. Reload before applying.'); }
		if (this.busy) { throw new Error('A library operation is already running.'); } this.busy = true;
		try { const result = await operation(); this.refresh(); return result; }
		finally { this.busy = false; this.changes.event(); }
	}
	async copy(input: unknown, scope: StorageRoot['scope']): Promise<void> {
		const assets = await this.selected(input); if (!assets.length) { return; }
		const root = await this.target(scope); if (!root) { return; }
		if (assets[0].metadata.kind === 'pack') { for (const asset of assets) { await this.mutate(() => this.library.copyPack(asset, root)); } }
		else { const dest = await this.destination(); if (!dest) { return; } const result = await this.mutate(() => this.library.copySnippets(assets, root, dest.name)); void vscode.window.showInformationMessage('Copied Snippets' + (result.added.length ? '. Included dependencies: ' + result.added.join(', ') : '') + '. ' + result.warnings.join(' ')); }
	}
	private async selected(input: unknown): Promise<AssetLocation[]> {
		const suppliedKey = typeof input === 'string' ? input : input && typeof input === 'object' && 'key' in input ? (input as AssetRow).key : undefined;
		const view = suppliedKey?.startsWith('pack:') ? this.packView : this.snippetView;
		const rows = suppliedKey && view.selection.some(row => row.key === suppliedKey) ? view.selection : [];
		if (rows.length > 1) { const result: AssetLocation[] = []; for (const row of rows) { const asset = await this.choose(row.key, undefined, true); if (!asset) { return []; } result.push(asset); } return result; }
		const asset = await this.choose(input, undefined, true); return asset ? [asset] : [];
	}
	async delete(input: unknown): Promise<void> {
		const assets = await this.selected(input); if (!assets.length) { return; }
		if (assets.some(asset => !sameRoot(asset.root, assets[0].root) || packOf(asset) !== packOf(assets[0]))) { throw new Error('Select members of one Pack for bulk deletion. Each Pack is saved atomically.'); }
		const choice = await vscode.window.showWarningMessage(`Delete ${assets.map(asset => asset.metadata.name).join(', ')} from ${assets[0].root.scope}/${assets[0].packName}? Other copies remain.`, { modal: true }, 'Delete');
		if (choice === 'Delete') { await this.mutate(() => this.library.deleteAssets(assets)); this.panel.saved(); this.panel.dispose(); }
	}
	async message(message: Record<string, unknown>): Promise<void> {
		const action = message.action;
		if (action === 'save' || action === 'preview') {
			const seed = this.panel.current?.seed; if (!seed) { throw new Error('No active metadata form.'); }
			if (!message.fields || typeof message.fields !== 'object' || Array.isArray(message.fields)) { throw new Error('Invalid metadata form.'); }
			const fields = message.fields as MetadataFields;
			if (Object.keys(fields).length > 16 || JSON.stringify(message).length > 1024 * 1024) { throw new Error('Form size limit.'); }
			let members: AssetLocation[] = [];
			if (seed.kind === 'pack') { if (!Array.isArray(message.members) || message.members.length > 256 || message.members.some(key => typeof key !== 'string')) { throw new Error('Invalid members.'); } members = message.members.map(key => this.find(key as string)); if (members.some(asset => asset.metadata.kind !== 'snippet')) { throw new Error('Packs contain Snippets.'); } }
			if (action === 'preview') {
				const removed = new Set((seed.members ?? []).filter(member => !members.some(item => item.metadata.id === member.metadata.id)).map(member => member.metadata.id!));
				try { const closure = resolveClosure(members, this.library.catalog.snapshot?.snippets ?? [], { forbidden: removed, workspaceId: seed.asset?.root.workspaceId ?? this.creation?.root.workspaceId }); this.panel.post({ type: 'closure', token: this.panel.session, text: `Pack includes ${closure.members.length} Snippets. Auto-added: ${closure.added.map(item => `${item.metadata.name} ${item.metadata.version!.text} (${item.root.scope})`).join(', ') || 'none'}. ${closure.warnings.join(' ')}` }); }
				catch (error) { this.panel.post({ type: 'closure', token: this.panel.session, text: error instanceof Error ? error.message : 'Closure failed.' }); } return;
			}
			const asset = seed.asset;
			let createdId: string | undefined;
			if (seed.kind === 'pack') {
				const root = asset?.root ?? this.creation?.root; if (!root) { throw new Error('Creation target expired.'); }
				const result = await this.mutate(() => this.library.createOrEditPack(root, { fields, members }, asset)); void vscode.window.showInformationMessage('Pack saved' + (result.added.length ? '. Included dependencies: ' + result.added.join(', ') : '') + '. ' + result.warnings.join(' '));
			} else {
				if (!Array.isArray(message.dependencies) || message.dependencies.length > 256 || message.dependencies.some(row => !row || typeof row !== 'object' || Array.isArray(row))) { throw new Error('Invalid dependencies.'); }
				const dependencies = message.dependencies as unknown as DependencyRow[];
				if (asset) { await this.mutate(() => this.library.editSnippet(asset, fields, dependencies)); }
				else {
					const creation = this.creation; if (!creation || typeof message.sourceName !== 'string') { throw new Error('Creation target expired.'); }
					createdId = await this.mutate(() => this.library.createSnippet(creation.root, { fields, bytes: creation.bytes, sourceName: message.sourceName as string, dependencies }, creation.packName));
				}
			}
			this.panel.saved(); this.creation = undefined;
			const saved = asset ? this.find(locationKey(asset)) : createdId ? this.library.catalog.snapshot?.snippets.find(item => item.metadata.id === createdId) : this.library.catalog.snapshot?.packs.find(item => item.metadata.name === fields.name && item.metadata.version!.text === fields.version);
			if (saved) { await this.showDetails(saved); if (createdId && saved.metadata.sources[0]) { await this.openSource(saved, saved.metadata.sources[0]); } } return;
		}
		if (action === 'searchMembers' || action === 'searchDependencies') {
			if (!this.panel.current?.seed || typeof message.query !== 'string' || message.query.length > 4096) { throw new Error('Invalid search.'); }
			const result = this.library.catalog.search(message.query); if (result.errors.length) { throw new Error(result.errors.join(', ')); }
			this.panel.post({ type: 'candidates', token: this.panel.session, purpose: action === 'searchMembers' ? 'members' : 'dependencies', items: result.hits.flatMap(hit => hit.locations.map(asset => ({ key: locationKey(asset), id: asset.metadata.id, name: asset.metadata.name, version: asset.metadata.version!.text, label: `${asset.metadata.name} ${asset.metadata.version!.text} · ${asset.root.scope}/${asset.packName}` }))).slice(0, 100) }); return;
		}
		if (action === 'cancel') { this.creation = undefined; const asset = this.panel.current?.asset; if (asset) { await this.showDetails(asset); } else { this.panel.dispose(); } return; }
		if (action === 'source') { if (typeof message.key !== 'string' || typeof message.source !== 'string') { throw new Error('Invalid source.'); } await this.openSource(this.find(message.key), message.source); return; }
		if (action === 'rawMetadata') { if (typeof message.key !== 'string') { throw new Error('Invalid item.'); } const asset = this.find(message.key); const filename = asset.metadata.kind + '.json'; await this.library.stores(asset.root).read(asset.relativePath + '/' + filename, 1024 * 1024); await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(this.assetUri(asset, filename)), { preview: false }); return; }
		if (['details', 'edit', 'favorite', 'copyWorkspace', 'copyGlobal', 'delete', 'insert', 'upgrade'].includes(String(action))) {
			if (typeof message.key !== 'string') { throw new Error('Invalid item.'); } this.find(message.key);
			await vscode.commands.executeCommand(prefix + action, message.key);
		}
	}
	async openSource(asset: AssetLocation, source: string): Promise<void> {
		validateRelativePath(source); if (!asset.metadata.sources.includes(source)) { throw new Error('Only declared sources may be opened.'); }
		// Validate disk identity unless an existing dirty editor already owns this exact source.
		const uri = this.assetUri(asset, source);
		if (!vscode.workspace.textDocuments.some(document => document.uri.toString() === uri.toString() && document.isDirty)) { const bytes = await this.library.source(asset, source); if (bytes.includes(0)) { throw new Error('Binary source cannot be opened as code.'); } new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false });
	}
	private async searchView(tree: AssetTree): Promise<void> {
		const groups = tree.kind === 'snippet' ? this.library.catalog.snapshot?.snippetGroups ?? [] : this.library.catalog.snapshot?.packGroups ?? [];
		const pick = vscode.window.createQuickPick<vscode.QuickPickItem & { query?: string }>(); pick.title = 'Search ' + (tree.kind === 'snippet' ? 'Snippets' : 'Packs'); pick.placeholder = 'name lang:"C#" tag:graph scope:workspace (Enter applies the filter)'; pick.value = tree.query;
		const update = () => {
			const result = searchAssets(groups, pick.value);
			pick.items = [{ label: result.errors.length ? result.errors.join(', ') : `Apply filter (${result.hits.length} items)`, query: result.errors.length ? undefined : pick.value },
				...(['lang', 'tag', 'category', 'pack', 'scope', 'version', 'author', 'feature'] as const).flatMap(key => modifierSuggestions(groups, key).map(query => ({ label: query, query: (pick.value.trim() + ' ' + query).trim() }))).filter(item => item.label.toLowerCase().includes(pick.value.split(' ').at(-1)!.toLowerCase())).slice(0, 30)];
		};
		const change = pick.onDidChangeValue(update), accept = pick.onDidAccept(() => { const item = pick.selectedItems[0]; if (item?.query === undefined) { return; } if (item.label.startsWith('Apply filter')) { tree.query = item.query; this.refresh(); pick.hide(); } else { pick.value = item.query; } });
		pick.onDidHide(() => { change.dispose(); accept.dispose(); pick.dispose(); }); update(); pick.show();
	}
	private async openGlobal(reveal: boolean): Promise<void> {
		const root = this.roots().find(root => root.scope === 'global')!; await this.library.stores(root).mkdir('');
		const uri = this.rootUri(root);
		if (reveal && uri.scheme === 'file') { await vscode.commands.executeCommand('revealFileInOS', uri); }
		else { try { await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true }); } catch { void vscode.window.showInformationMessage('This provider cannot open a library folder in a window. Use Configure Global Root to choose a normal folder.'); } }
	}
	private async reviewRecovery(): Promise<void> {
		if (this.rootsDirty) { throw new Error('Reload library roots before reviewing recovery data.'); }
		for (const root of this.roots()) {
			for (const record of await pendingRecovery(this.library.stores(root))) {
				const choice = await vscode.window.showWarningMessage(`Recovery data for ${record.target} (${root.scope}). Restore only if the target is absent; Keep only if the new content is intact.`, { modal: true }, 'Restore', 'Keep new content', 'Later');
				if (choice === 'Restore' || choice === 'Keep new content') { await this.mutate(async () => { await recover(this.library.stores(root), record, choice === 'Restore' ? 'restore' : 'keep'); this.library.catalog.adoptPack(await loadCatalog([root], this.library.stores), root, record.target); }); }
			}
		}
	}
	dispose(): void { this.watchers.forEach(item => item.dispose()); this.subscriptions.forEach(item => item.dispose()); }
}
