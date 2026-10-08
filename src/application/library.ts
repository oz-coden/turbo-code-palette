import { randomUUID } from 'node:crypto';
import { MetadataDocument } from '../core/metadata/document';
import { readMetadata, type AssetKind } from '../core/metadata/semantics';
import { validateMetadataChange } from '../core/metadata/changes';
import { resolveClosure, validatePackDependencies } from '../core/dependency/resolver';
import { nextVersion } from '../core/version/parser';
import { sha256 } from '../core/assets/fingerprint';
import { Catalog } from '../storage/catalog';
import { loadCatalog, type AssetLocation } from '../storage/discovery';
import type { StorageRoot } from '../storage/roots';
import { nativeStore, type LibraryStore, type StoreFactory } from '../storage/store';
import { byteFingerprint, cloneTree, commitTree, readTree, treeDirectories, type FileTree, type MutableTree } from '../storage/transaction';
import { pendingRecovery } from '../storage/recovery';
import { pathCollisionKey, validateRelativePath } from '../storage/safePaths';

export type MetadataFields = Readonly<Record<string, string | readonly string[]>>;
export interface DependencyRow { readonly originalIndex?: number; readonly id: string; readonly name: string; readonly version?: string }
export interface SnippetDraft { readonly fields: MetadataFields; readonly sourceName: string; readonly bytes: Buffer; readonly dependencies?: readonly DependencyRow[] }
export interface PackDraft { readonly fields: MetadataFields; readonly members: readonly AssetLocation[] }
export const locationKey = (asset: AssetLocation): string => JSON.stringify([asset.root.uri ?? asset.root.path, asset.relativePath]);
export const sameRoot = (a: StorageRoot, b: StorageRoot): boolean => (a.uri ?? a.path) === (b.uri ?? b.path);
export const packOf = (asset: AssetLocation): string => asset.relativePath.split('/')[0];
const decoder = new TextDecoder('utf-8', { fatal: true });
const folderName = (name: string) => Array.from(name.replace(/[^\p{L}\p{N}_-]+/gu, '-')).slice(0, 40).join('').replace(/^-+|-+$/g, '') || 'Asset';
function memberDirectory(tree: FileTree, asset: AssetLocation): string {
	const occupied = new Set([...tree.keys(), ...treeDirectories(tree)].map(name => pathCollisionKey(name.split('/')[0])));
	const longest = Math.max(0, ...asset.files.map(file => file.path.length), ...(asset.directories ?? []).map(name => name.length));
	const budget = 240 - longest - 1;
	const original = asset.relativePath.split('/').at(-1)!;
	if (original.length <= budget && !occupied.has(pathCollisionKey(original))) { return original; }
	const desired = folderName(asset.metadata.name!) + '-' + asset.metadata.id;
	if (desired.length <= budget && !occupied.has(pathCollisionKey(desired))) { return desired; }
	const prefix = asset.metadata.id!.replaceAll('-', '');
	for (let number = 0; number < 10000; number++) { const suffix = number.toString(36); if (suffix.length > budget) { break; } const name = prefix.slice(0, Math.max(0, budget - suffix.length)) + suffix; if (!occupied.has(pathCollisionKey(name))) { return name; } }
	throw new Error('Source paths cannot fit another Snippet folder in this Pack. Choose a new Pack or shorter relative source paths.');
}
const editable = new Set(['name', 'version', 'description', 'category', 'notes', 'status', 'languages', 'tags', 'features', 'authors', 'sources']);
function mergeFiles(tree: MutableTree, files: FileTree, directory: string): void {
	let bytes = [...tree.values()].reduce((total, file) => total + file.length, 0);
	for (const name of [directory, ...treeDirectories(files).map(name => directory + '/' + name)]) { validateRelativePath(name); tree.directories.add(name); }
	if (tree.directories.size + tree.size > 10000) { throw new Error('Pack entry limit exceeded.'); }
	for (const [name, content] of files) {
		const relative = directory + '/' + name; validateRelativePath(relative);
		bytes += content.length - (tree.get(relative)?.length ?? 0);
		if (bytes > 128 * 1024 * 1024 || !tree.has(relative) && tree.directories.size + tree.size >= 10000) { throw new Error('Pack file/byte limit exceeded. Split this collection into smaller Packs.'); }
		tree.set(relative, content);
	}
}

export function patchDependencies(document: MetadataDocument, rows?: readonly DependencyRow[]): MetadataDocument {
	if (rows === undefined) { return document; }
	let result = document; const used = new Set<number>();
	for (const row of rows) {
		if (typeof row.id !== 'string' || typeof row.name !== 'string' || row.version !== undefined && typeof row.version !== 'string') { throw new Error('Invalid dependency form value.'); }
		if (row.originalIndex === undefined) { continue; }
		const index = row.originalIndex;
		if (used.has(index) || !Number.isSafeInteger(index) || index < 0 || !document.node(['dependencies', index])) { throw new Error('Invalid dependency form index.'); } used.add(index);
		for (const key of ['id', 'name', 'version'] as const) { const value = row[key]; if (key === 'version' && !value) { result = result.removeDependencyVersion(index); } else if (value !== result.string(['dependencies', index, key])) { result = result.patchKnown(['dependencies', index, key], value); } }
	}
	for (let index = (document.node(['dependencies'])?.children?.length ?? 0) - 1; index >= 0; index--) { if (!used.has(index)) { result = result.removeDependency(index); } }
	for (const row of rows.filter(row => row.originalIndex === undefined)) { result = result.appendDependency({ id: row.id, name: row.name, ...(row.version ? { version: row.version } : {}) }); }
	return result;
}

export function patchFields(document: MetadataDocument, fields: MetadataFields): MetadataDocument {
	let result = document;
	for (const [key, value] of Object.entries(fields)) {
		if (!editable.has(key)) { throw new Error('Unsupported form field.'); }
		if (typeof value !== 'string' && !(Array.isArray(value) && value.every(item => typeof item === 'string'))) { throw new Error('Invalid form value.'); }
		if (key === 'authors') { if (!Array.isArray(value)) { throw new Error('Authors must be a list.'); } result = result.patchAuthors(value); continue; }
		const node = result.node([key]);
		const unchanged = typeof value === 'string' ? node?.type === 'string' && node.value === value
			: node?.type === 'array' && JSON.stringify(node.children?.map(child => child.value) ?? []) === JSON.stringify(value);
		if (!unchanged) { result = result.patchKnown([key], value); }
	}
	return result;
}
function newMetadata(kind: AssetKind, fields: MetadataFields, sourceName?: string): MetadataDocument {
	const document = new MetadataDocument(JSON.stringify({ formatVersion: 1, id: randomUUID(), name: 'Untitled', version: 'v1.0.0',
		...(kind === 'snippet' ? { sources: [sourceName] } : {}) }, null, 2) + '\n');
	const edited = patchFields(document, fields);
	if (!readMetadata(edited, kind).valid) { throw new Error('Invalid required metadata.'); } return edited;
}

export class Library {
	readonly catalog = new Catalog();
	private pending: Promise<unknown> = Promise.resolve();
	constructor(readonly roots: () => readonly StorageRoot[], readonly stores: StoreFactory = nativeStore,
		private readonly dirtyGuard: (roots: readonly StorageRoot[], packs: readonly string[]) => Promise<void> = async () => {}) {}
	async reload() { return this.catalog.reload(this.roots(), this.stores); }
	private serial<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.pending.then(operation); this.pending = result.catch(() => {}); return result;
	}
	private async tree(asset: AssetLocation): Promise<MutableTree> {
		const store = this.stores(asset.root), files = await readTree(store, asset.relativePath);
		if (files.size !== asset.files.length || asset.files.some(file => !files.has(file.path) || sha256(files.get(file.path)!) !== file.hash) || asset.directories && JSON.stringify(asset.directories) !== JSON.stringify([...files.directories].sort())) {
			throw new Error('Source changed. Reload the library before applying.');
		}
		await this.dirtyGuard([asset.root], [packOf(asset)]); return files;
	}
	private parent(asset: AssetLocation): AssetLocation {
		const pack = this.catalog.snapshot?.packs.find(pack => sameRoot(pack.root, asset.root) && pack.relativePath === packOf(asset));
		if (!pack) { throw new Error('Pack is no longer loaded.'); } return pack;
	}
	members(pack: AssetLocation): AssetLocation[] {
		return (this.catalog.snapshot?.snippets ?? []).filter(asset => sameRoot(asset.root, pack.root) && packOf(asset) === pack.relativePath);
	}
	private requireEditable(pack: AssetLocation): void {
		if (!pack.metadata.canEdit || !pack.integrityHash || !pack.semanticHash) { throw new Error('This Pack is incomplete, legacy or future-format. Upgrade/repair it before editing.'); }
	}
	private async validate(tree: FileTree, root: StorageRoot): Promise<void> {
		const document = new MetadataDocument(decoder.decode(tree.get('pack.json') ?? Buffer.alloc(0)));
		if (!readMetadata(document, 'pack').valid) { throw new Error('Invalid Pack metadata.'); }
		// Reuse the actual discovery model on staged bytes, including source/reference validation.
		const memory: LibraryStore = {
			...this.stores(root),
			async list(relative) {
				if (!relative) { return [{ name: 'Pack', directory: true }]; }
				const prefix = relative === 'Pack' ? '' : relative.slice('Pack/'.length) + '/';
				const entries = new Map<string, boolean>();
				for (const name of [...tree.keys(), ...treeDirectories(tree).map(name => name + '/')]) { if (name.startsWith(prefix)) { const suffix = name.slice(prefix.length), head = suffix.split('/')[0]; if (head) { entries.set(head, suffix.includes('/')); } } }
				return [...entries].map(([name, directory]) => ({ name, directory }));
			},
			async read(relative, limit) { const bytes = tree.get(relative.slice('Pack/'.length)); if (!bytes || bytes.length > limit) { throw new Error('Missing/oversized staged file.'); } return bytes; },
		};
		const staging = new Catalog(); const snapshot = await staging.reload([root], () => memory);
		const optionalIssues = new Set([...snapshot.packs, ...snapshot.snippets].flatMap(asset => asset.metadata.issues.filter(issue => issue.severity === 'warning').map(issue => `${asset.relativePath}/${asset.metadata.kind}.json:${issue.code}`)));
		if (snapshot.packs.length !== 1 || !snapshot.packs[0].integrityHash || snapshot.diagnostics.some(issue => !optionalIssues.has(`${issue.asset}:${issue.code}`))) { throw new Error('Staged Pack validation failed. Repair invalid metadata/references first.'); }
		if (document.format !== 'future' && snapshot.snippets.every(asset => asset.metadata.document.format !== 'future')) { validatePackDependencies(snapshot.snippets); }
	}
	private async apply(root: StorageRoot, target: string, previous: FileTree | undefined, next: FileTree | undefined,
		sources: readonly AssetLocation[] = []): Promise<void> {
		const guard = async (transactionId?: string) => { if (!this.roots().some(current => sameRoot(current, root))) { throw new Error('Library root changed. Reload before applying.'); } if ((await pendingRecovery(this.stores(root))).some(record => record.target === target && record.id !== transactionId)) { throw new Error('Review the interrupted save for this Pack before changing it.'); } await this.dirtyGuard([root, ...sources.map(source => source.root)], [target, ...sources.map(packOf)]); for (const source of sources) { await this.tree(source); } };
		await commitTree(this.stores(root), target, previous && byteFingerprint(previous), next, guard, tree => this.validate(tree, root));
		this.catalog.adoptPack(await loadCatalog([root], this.stores), root, target);
	}
	private defaultPack(root: StorageRoot): AssetLocation | undefined {
		return this.catalog.snapshot?.packs.find(pack => sameRoot(pack.root, root) && pack.relativePath === 'Default');
	}
	private async destination(root: StorageRoot, name?: string): Promise<{ target: string; previous?: MutableTree; tree: MutableTree; pack?: AssetLocation }> {
		const existing = name === undefined ? this.defaultPack(root) : undefined;
		if (existing) { this.requireEditable(existing); const previous = await this.tree(existing); return { target: existing.relativePath, previous, tree: cloneTree(previous), pack: existing }; }
		const document = newMetadata('pack', { name: name ?? 'Default', version: 'v1.0.0' });
		return { target: name === undefined ? 'Default' : folderName(name) + '-' + randomUUID(), tree: cloneTree(new Map([['pack.json', Buffer.from(document.text)]])) };
	}
	private async addMembers(tree: MutableTree, members: readonly AssetLocation[], existing: readonly AssetLocation[] = []): Promise<boolean> {
		let changed = false;
		for (const asset of members) {
			const present = existing.find(member => member.metadata.id === asset.metadata.id);
			if (present) {
				if (present.metadata.version!.text !== asset.metadata.version!.text || present.semanticHash !== asset.semanticHash) { throw new Error('Destination already contains another version/implementation of this Snippet UUID. Choose a new Pack.'); }
				continue;
			}
			const bytes = await this.tree(asset), directory = memberDirectory(tree, asset);
			mergeFiles(tree, bytes, directory);
			changed = true;
		} return changed;
	}
	createSnippet(root: StorageRoot, draft: SnippetDraft, newPackName?: string): Promise<string> { return this.serial(async () => {
		if (draft.bytes.length > 16 * 1024 * 1024) { throw new Error('Source file size limit exceeded.'); }
		validateRelativePath(draft.sourceName); if (draft.sourceName.includes('/') || ['snippet.json', 'pack.json'].includes(draft.sourceName.toLowerCase())) { throw new Error('Choose a source filename other than metadata filenames.'); }
		decoder.decode(draft.bytes); const metadata = patchDependencies(newMetadata('snippet', draft.fields, draft.sourceName), draft.dependencies);
		const destination = await this.destination(root, newPackName), directory = folderName(metadata.string(['name'])!) + '-' + metadata.string(['id']);
		mergeFiles(destination.tree, new Map([['snippet.json', Buffer.from(metadata.text)], [draft.sourceName, Buffer.from(draft.bytes)]]), directory);
		const existing = destination.pack ? this.members(destination.pack) : [];
		const created: AssetLocation = { root, relativePath: destination.target + '/' + directory, metadata: readMetadata(metadata, 'snippet'), files: [], packName: destination.pack?.packName ?? newPackName ?? 'Default', semanticHash: sha256(metadata.canonical(true)), usable: false };
		const closure = resolveClosure([...existing, created], this.catalog.snapshot?.snippets ?? [], { workspaceId: root.workspaceId });
		const dependencies = closure.members.filter(asset => asset !== created && !existing.includes(asset));
		await this.addMembers(destination.tree, dependencies, existing);
		if (destination.pack) { destination.tree.set('pack.json', Buffer.from(destination.pack.metadata.document.patchKnown(['version'], nextVersion(destination.pack.metadata.version!)).text)); }
		await this.apply(root, destination.target, destination.previous, destination.tree, dependencies);
		return metadata.string(['id'])!;
	}); }
	editSnippet(asset: AssetLocation, fields: MetadataFields, dependencies?: readonly DependencyRow[]): Promise<void> { return this.serial(async () => {
		const pack = this.parent(asset); this.requireEditable(pack);
		const document = patchDependencies(patchFields(asset.metadata.document, fields), dependencies); validateMetadataChange(asset.metadata.document, document, 'snippet');
		const previous = await this.tree(pack), next = cloneTree(previous), relative = asset.relativePath.slice(pack.relativePath.length + 1) + '/snippet.json';
		next.set(relative, Buffer.from(document.text));
		if (byteFingerprint(previous) === byteFingerprint(next)) { return; }
		const oldMembers = this.members(pack), updated = { ...asset, metadata: readMetadata(document, 'snippet'), semanticHash: sha256(document.canonical(true)) };
		const closure = resolveClosure([...oldMembers.filter(member => member.metadata.id !== asset.metadata.id), updated], this.catalog.snapshot?.snippets ?? [], { workspaceId: pack.root.workspaceId });
		const dependenciesAdded = closure.members.filter(member => member !== updated && !oldMembers.includes(member));
		await this.addMembers(next, dependenciesAdded, oldMembers);
		next.set('pack.json', Buffer.from(pack.metadata.document.patchKnown(['version'], nextVersion(pack.metadata.version!)).text));
		await this.apply(pack.root, pack.relativePath, previous, next, [asset, ...dependenciesAdded]);
	}); }
	createOrEditPack(root: StorageRoot, draft: PackDraft, existing?: AssetLocation): Promise<{ added: readonly string[]; warnings: readonly string[] }> { return this.serial(async () => {
		if (existing && !sameRoot(existing.root, root)) { throw new Error('Edit targets the existing Pack library.'); }
		if (existing) { this.requireEditable(existing); }
		const oldMembers = existing ? this.members(existing) : [];
		const selected = new Set(draft.members.map(member => member.metadata.id!));
		const forbidden = new Set(oldMembers.filter(member => !selected.has(member.metadata.id!)).map(member => member.metadata.id!));
		const closure = resolveClosure(draft.members, this.catalog.snapshot?.snippets ?? [], { workspaceId: root.workspaceId, forbidden });
		const document = existing ? patchFields(existing.metadata.document, draft.fields) : newMetadata('pack', draft.fields);
		if (existing) { validateMetadataChange(existing.metadata.document, document, 'pack'); }
		const previous = existing ? await this.tree(existing) : undefined;
		const next = cloneTree(previous);
		for (const member of oldMembers) { const directory = member.relativePath.slice(existing!.relativePath.length + 1), prefix = directory + '/'; for (const name of next.keys()) { if (name.startsWith(prefix)) { next.delete(name); } } for (const name of next.directories) { if (name === directory || name.startsWith(prefix)) { next.directories.delete(name); } } }
		next.set('pack.json', Buffer.from(document.text));
		for (const member of closure.members) {
			const prior = oldMembers.find(old => old.metadata.id === member.metadata.id);
			const directory = prior ? prior.relativePath.slice(existing!.relativePath.length + 1) : memberDirectory(next, member);
			mergeFiles(next, await this.tree(member), directory);
		}
		if (existing && previous && byteFingerprint(previous) !== byteFingerprint(next) && document.string(['version']) === existing.metadata.version!.text) { throw new Error('Pack content changes require a newer version.'); }
		await this.apply(root, existing?.relativePath ?? folderName(document.string(['name'])!) + '-' + randomUUID(), previous, next, closure.members);
		return { added: closure.added.map(asset => asset.metadata.name!), warnings: closure.warnings };
	}); }
	copySnippets(assets: readonly AssetLocation[], root: StorageRoot, newPackName?: string): Promise<{ added: readonly string[]; warnings: readonly string[] }> { return this.serial(async () => {
		const destination = await this.destination(root, newPackName), existing = destination.pack ? this.members(destination.pack) : [];
		if (existing.length) { validatePackDependencies(existing); }
		const closure = resolveClosure([...existing, ...assets], this.catalog.snapshot?.snippets ?? [], { workspaceId: root.workspaceId });
		if (!await this.addMembers(destination.tree, closure.members, existing)) { return { added: [], warnings: closure.warnings }; }
		if (destination.pack) { destination.tree.set('pack.json', Buffer.from(destination.pack.metadata.document.patchKnown(['version'], nextVersion(destination.pack.metadata.version!)).text)); }
		await this.apply(root, destination.target, destination.previous, destination.tree, closure.members);
		return { added: closure.added.map(asset => asset.metadata.name!), warnings: closure.warnings };
	}); }
	copyPack(asset: AssetLocation, root: StorageRoot): Promise<void> { return this.serial(async () => {
		if (asset.metadata.kind !== 'pack' || !asset.integrityHash) { throw new Error('Cannot copy an incomplete Pack.'); }
		const source = await this.tree(asset);
		const copies = this.catalog.snapshot?.packs.filter(pack => sameRoot(pack.root, root) && pack.metadata.id === asset.metadata.id && pack.metadata.version!.text === asset.metadata.version!.text) ?? [];
		for (const copy of copies) { if (asset.semanticHash && asset.semanticHash === copy.semanticHash || byteFingerprint(await this.tree(copy)) === byteFingerprint(source)) { return; } }
		if (copies.length) { throw new Error('Destination contains a conflicting Pack revision. Create a newer version before copying.'); }
		await this.apply(root, folderName(asset.metadata.name!) + '-' + randomUUID(), undefined, source, [asset]);
	}); }
	deleteAssets(assets: readonly AssetLocation[]): Promise<void> { return this.serial(async () => {
		if (!assets.length) { return; }
		const pack = assets[0].metadata.kind === 'pack' ? assets[0] : this.parent(assets[0]); this.requireEditable(pack);
		if (assets.some(asset => !sameRoot(asset.root, pack.root) || packOf(asset) !== pack.relativePath)) { throw new Error('Bulk deletion must select members of one Pack.'); }
		const previous = await this.tree(pack);
		if (assets.some(asset => asset.metadata.kind === 'pack')) { await this.apply(pack.root, pack.relativePath, previous, undefined); return; }
		const removed = new Set(assets.map(asset => asset.metadata.id!)), members = this.members(pack);
		if (members.filter(member => !removed.has(member.metadata.id!)).some(member => member.metadata.dependencies.some(dependency => removed.has(dependency.id)))) {
			throw new Error('Cannot delete a Snippet still required by a remaining member. Select dependent members too.');
		}
		const next = cloneTree(previous);
		for (const asset of assets) { const directory = asset.relativePath.slice(pack.relativePath.length + 1), prefix = directory + '/'; for (const name of next.keys()) { if (name.startsWith(prefix)) { next.delete(name); } } for (const name of next.directories) { if (name === directory || name.startsWith(prefix)) { next.directories.delete(name); } } }
		next.set('pack.json', Buffer.from(pack.metadata.document.patchKnown(['version'], nextVersion(pack.metadata.version!)).text));
		await this.apply(pack.root, pack.relativePath, previous, next, assets);
	}); }
	upgrade(asset: AssetLocation): Promise<void> { return this.serial(async () => {
		const pack = asset.metadata.kind === 'pack' ? asset : this.parent(asset), previous = await this.tree(pack), next = cloneTree(previous);
		if (pack.metadata.document.format === 'future') { throw new Error('Future-format Packs cannot be changed.'); }
		const relative = asset.metadata.kind === 'pack' ? 'pack.json' : asset.relativePath.slice(pack.relativePath.length + 1) + '/snippet.json';
		next.set(relative, Buffer.from(asset.metadata.document.upgradeFormat().text));
		await this.apply(pack.root, pack.relativePath, previous, next, [asset]);
	}); }
	async source(asset: AssetLocation, source: string): Promise<Buffer> {
		return (await this.sources(asset, [source])).get(source)!;
	}
	async sources(asset: AssetLocation, sources: readonly string[]): Promise<Map<string, Buffer>> {
		for (const source of sources) { validateRelativePath(source); if (!asset.metadata.sources.includes(source)) { throw new Error('Source is not declared by this Snippet.'); } }
		if (!sources.length) { return new Map(); } const tree = await this.tree(asset); return new Map(sources.map(source => [source, tree.get(source)!]));
	}
}
