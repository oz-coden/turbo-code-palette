import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Library, sameRoot } from './library';
import { archiveLimits, decodeArchive, encodeArchive, publishArchive } from '../storage/archive';
import { assertNoLinks, readBoundedFile } from '../storage/safePaths';
import { byteFingerprint, cloneTree, readTree, type MutableTree } from '../storage/transaction';
import { nativeStore } from '../storage/store';
import { inspectPackTree } from '../storage/packValidation';
import { loadCatalog, type AssetLocation, type CatalogSnapshot } from '../storage/discovery';
import type { StorageRoot } from '../storage/roots';
import { sha256 } from '../core/assets/fingerprint';
import { MetadataDocument } from '../core/metadata/document';
import { compareVersions } from '../core/version/parser';
import { validateMetadataChange } from '../core/metadata/changes';
import { ConflictError } from '../core/conflict';

export type ImportCategory = 'addition' | 'identical' | 'different-version' | 'conflict';
export interface ImportRow { readonly incoming: AssetLocation; readonly category: ImportCategory; readonly existing: readonly AssetLocation[] }
export function classifyImport(incoming: CatalogSnapshot, current: CatalogSnapshot, root: StorageRoot): ImportRow[] {
	return [...incoming.packs, ...incoming.snippets].map(asset => {
		const existing = (asset.metadata.kind === 'pack' ? current.packs : current.snippets).filter(other => other.metadata.id === asset.metadata.id).sort((left, right) => Number(sameRoot(right.root, root)) - Number(sameRoot(left.root, root)));
		const exact = existing.filter(other => other.metadata.version!.text === asset.metadata.version!.text);
		return { incoming: asset, existing, category: exact.some(other => other.semanticHash !== asset.semanticHash || !other.integrityHash) ? 'conflict' : exact.length ? 'identical' : existing.length ? 'different-version' : 'addition' };
	});
}
const stamp = (snapshot: CatalogSnapshot) => JSON.stringify({ packs: snapshot.packs.map(asset => [asset.root.uri ?? asset.root.path, asset.relativePath, asset.integrityHash]).sort(), diagnostics: snapshot.diagnostics });

/** Private staging exists outside the destination library until explicit commit. */
export class PackImportSession {
	private closed = false;
	private constructor(readonly library: Library, readonly root: StorageRoot, readonly tree: MutableTree, readonly snapshot: CatalogSnapshot,
		readonly rows: readonly ImportRow[], private readonly stage: string, private readonly archive: string, private readonly archiveHash: string,
		private readonly catalog: CatalogSnapshot, private readonly rootsStamp: string) {}
	static async prepare(library: Library, archive: string, root: StorageRoot): Promise<PackImportSession> {
		if (root.uri || !library.roots().some(other => sameRoot(root, other))) { throw new Error('Pack Import requires a configured native local root.'); }
		const catalog = library.catalog.snapshot; if (!catalog) { throw new Error('Reload the library first.'); }
		const rootsStamp = JSON.stringify(library.roots()), bytes = await readBoundedFile(archive, archiveLimits.compressed), tree = await decodeArchive(bytes);
		const stage = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'tcp-import-'));
		try {
			await assertNoLinks(stage); const store = nativeStore({ scope: 'global', path: stage }); await store.mkdir('Pack');
			for (const name of tree.directories) { await store.mkdir('Pack/' + name); }
			for (const [name, data] of tree) { await store.mkdir(path.posix.dirname('Pack/' + name)); await store.writeNew('Pack/' + name, data); }
			const staged = await readTree(store, 'Pack'); if (byteFingerprint(staged) !== byteFingerprint(tree)) { throw new Error('Staging fingerprint mismatch.'); }
			const snapshot = await inspectPackTree(staged, root, true, true);
			const result = new PackImportSession(library, root, staged, snapshot, classifyImport(snapshot, catalog, root), stage, archive, sha256(bytes), catalog, rootsStamp);
			await result.revalidate(); return result;
		} catch (error) { await PackImportSession.removeStage(stage); throw error; }
	}
	private static async removeStage(stage: string): Promise<void> {
		if (path.dirname(stage) !== await fs.realpath(os.tmpdir()) || !path.basename(stage).startsWith('tcp-import-')) { throw new Error('Unexpected import staging directory.'); }
		await assertNoLinks(stage); await fs.rm(stage, { recursive: true });
	}
	async revalidate(): Promise<void> {
		if (this.closed || this.library.catalog.snapshot !== this.catalog || JSON.stringify(this.library.roots()) !== this.rootsStamp) { throw new Error('Import catalog/root changed. Prepare the preview again.'); }
		if (stamp(await loadCatalog(this.library.roots(), this.library.stores)) !== stamp(this.catalog)) { throw new Error('Library changed externally. Reload before Import.'); }
		if (sha256(await readBoundedFile(this.archive, archiveLimits.compressed)) !== this.archiveHash) { throw new Error('Archive changed after preview. Prepare Import again.'); }
		const staged = await readTree(nativeStore({ scope: 'global', path: this.stage }), 'Pack');
		if (byteFingerprint(staged) !== byteFingerprint(this.tree)) { throw new Error('Import staging changed.'); }
	}
	replacements(): AssetLocation[] {
		const incoming = this.snapshot.packs[0];
		return this.catalog.packs.filter(asset => sameRoot(asset.root, this.root) && asset.metadata.id === incoming.metadata.id && compareVersions(incoming.metadata.version!, asset.metadata.version!) > 0).filter(asset => {
			try { validateMetadataChange(asset.metadata.document, incoming.metadata.document, 'pack'); for (const member of this.library.members(asset)) { const next = this.snapshot.snippets.find(other => other.metadata.id === member.metadata.id); if (next && next.semanticHash !== member.semanticHash && compareVersions(next.metadata.version!, member.metadata.version!) <= 0) { return false; } if (next) { validateMetadataChange(member.metadata.document, next.metadata.document, 'snippet'); } } return true; } catch { return false; }
		});
	}
	async commit(action: 'add' | 'fork' | 'replace', replacement?: AssetLocation): Promise<'imported' | 'identical'> {
		await this.revalidate();
		if (action !== 'fork' && this.rows.some(row => row.category === 'conflict')) { const row = this.rows.find(row => row.category === 'conflict')!; throw new ConflictError('Import revision conflict. Compare, create a newer version, or explicitly Fork the whole Pack.', { incoming: row.incoming, existing: row.existing }); }
		if (action === 'replace' && (!replacement || !this.replacements().includes(replacement))) { throw new Error('Replace requires a compatible, explicitly newer Pack and changed Snippet revisions.'); }
		if (action === 'add' && this.rows[0].category === 'identical' && this.rows[0].existing.some(asset => sameRoot(asset.root, this.root) && asset.metadata.version!.text === this.snapshot.packs[0].metadata.version!.text)) { return 'identical'; }
		const next = action === 'fork' ? forkPackTree(this.tree) : this.tree;
		await this.library.importPack(next, this.root, () => this.revalidate(), action === 'replace' ? replacement : undefined); return 'imported';
	}
	async dispose(): Promise<void> { if (!this.closed) { this.closed = true; await PackImportSession.removeStage(this.stage); } }
}

/** Explicit separate asset creation. Known UUID references change; unknown fields remain lossless. */
export function forkPackTree(tree: MutableTree): MutableTree {
	const result = cloneTree(tree), documents = [...tree].filter(([name]) => name === 'pack.json' || /^[^/]+\/snippet\.json$/.test(name)).map(([name, bytes]) => [name, new MetadataDocument(new TextDecoder('utf-8', { fatal: true }).decode(bytes))] as const);
	const ids = new Map(documents.map(([, document]) => [document.string(['id'])!.toLowerCase(), randomUUID()]));
	for (const [name, original] of documents) {
		let document = original.patchKnown(['id'], ids.get(original.string(['id'])!.toLowerCase())!);
		for (const [index] of (original.node(['dependencies'])?.children ?? []).entries()) { const id = original.string(['dependencies', index, 'id'])!.toLowerCase(); if (!ids.has(id)) { throw new Error('Fork requires a closed dependency graph.'); } document = document.patchKnown(['dependencies', index, 'id'], ids.get(id)!); }
		result.set(name, Buffer.from(document.text));
	} return result;
}

export async function exportPack(library: Library, pack: AssetLocation, destination: string): Promise<void> {
	if (pack.metadata.kind !== 'pack' || pack.root.uri || !pack.usable) { throw new Error('Export requires a valid supported Pack in a native local library.'); }
	const tree = await library.assetTree(pack), bytes = await encodeArchive(tree);
	await publishArchive(destination, bytes, async () => { await library.assetTree(pack); });
}
