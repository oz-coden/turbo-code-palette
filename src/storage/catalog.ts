import { loadCatalog, type CatalogSnapshot } from './discovery';
import type { StorageRoot } from './roots';
import { modifierSuggestions, searchAssets } from '../core/search/index';
import type { Modifier } from '../core/search/query';
import type { ReaderFactory } from './reader';
import { groupAssets } from '../core/assets/identity';
import type { AssetLocation } from './discovery';

export class Catalog {
	private current?: CatalogSnapshot;
	private generation = 0;
	get snapshot(): CatalogSnapshot | undefined { return this.current; }
	/** Adopt only the Pack written by our transaction; external changes await explicit Reload. */
	adoptPack(snapshot: CatalogSnapshot, root: StorageRoot, target: string): void {
		++this.generation;
		const matches = (asset: AssetLocation) => (asset.root.uri ?? asset.root.path) === (root.uri ?? root.path) && asset.relativePath.split('/')[0] === target;
		const snippets = [...(this.current?.snippets ?? []).filter(asset => !matches(asset)), ...snapshot.snippets.filter(matches)];
		const packs = [...(this.current?.packs ?? []).filter(asset => !matches(asset)), ...snapshot.packs.filter(matches)];
		this.current = { snippets, packs, snippetGroups: groupAssets(snippets), packGroups: groupAssets(packs),
			diagnostics: [...(this.current?.diagnostics ?? []).filter(item => item.rootKey !== (root.uri ?? root.path) || item.asset.split('/')[0] !== target),
				...snapshot.diagnostics.filter(item => item.asset.split('/')[0] === target)] };
	}
	async reload(roots: readonly StorageRoot[], readerFactory?: ReaderFactory): Promise<CatalogSnapshot> {
		const generation = ++this.generation;
		const snapshot = await loadCatalog(roots, readerFactory);
		// A slow previous reload must never replace a newer request's snapshot.
		if (generation === this.generation) { this.current = snapshot; }
		return snapshot;
	}
	search(input: string, targetWorkspace?: string) { return searchAssets(this.current?.snippetGroups ?? [], input, targetWorkspace); }
	suggestions(key: Modifier) { return modifierSuggestions(this.current?.snippetGroups ?? [], key); }
}
