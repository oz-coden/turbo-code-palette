import { loadCatalog, type CatalogSnapshot } from './discovery';
import type { StorageRoot } from './roots';
import { treeDirectories, type FileTree } from './transaction';
import { validatePackDependencies } from '../core/dependency/resolver';

/** Discovery and dependency validation are identical for library saves and staged archives. */
export async function inspectPackTree(tree: FileTree, root: StorageRoot, verifiedFileIdentity = true, requireSupported = false): Promise<CatalogSnapshot> {
	const snapshot = await loadCatalog([root], () => ({
		verifiedFileIdentity,
		async list(relative) {
			if (!relative) { return [{ name: 'Pack', directory: true }]; }
			const prefix = relative === 'Pack' ? '' : relative.slice(5) + '/';
			const entries = new Map<string, boolean>();
			for (const name of [...tree.keys(), ...treeDirectories(tree).map(name => name + '/')]) {
				if (name.startsWith(prefix)) { const suffix = name.slice(prefix.length), head = suffix.split('/')[0]; if (head) { entries.set(head, suffix.includes('/') || entries.get(head) === true); } }
			}
			return [...entries].map(([name, directory]) => ({ name, directory }));
		},
		async read(relative, limit) { const bytes = tree.get(relative.slice(5)); if (!bytes || bytes.length > limit) { throw new Error('Missing/oversized staged file.'); } return bytes; },
	}));
	const assets = [...snapshot.packs, ...snapshot.snippets];
	const warnings = new Set(assets.flatMap(asset => asset.metadata.issues.filter(issue => issue.severity === 'warning').map(issue => `${asset.relativePath}/${asset.metadata.kind}.json:${issue.code}`)));
	if (snapshot.packs.length !== 1 || !snapshot.packs[0].integrityHash || snapshot.diagnostics.some(issue => !warnings.has(`${issue.asset}:${issue.code}`))) { throw new Error('Staged Pack validation failed. Repair invalid metadata/references first.'); }
	if (requireSupported && assets.some(asset => !asset.metadata.canEdit || asset.metadata.blockedFeatures.has('dependencies'))) { throw new Error('Archive requires supported metadata and verifiable dependencies. Upgrade/repair it first.'); }
	if (requireSupported && new Set(assets.map(asset => asset.metadata.id)).size !== assets.length) { throw new Error('Duplicate Pack/Snippet UUID in archive.'); }
	if (assets.every(asset => asset.metadata.document.format !== 'future')) { validatePackDependencies(snapshot.snippets); }
	return snapshot;
}
