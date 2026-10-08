import { loadCatalog, type CatalogSnapshot } from './discovery';
import type { StorageRoot } from './roots';
import { modifierSuggestions, searchAssets } from '../core/search/index';
import type { Modifier } from '../core/search/query';
import type { ReaderFactory } from './reader';

export class Catalog {
	private current?: CatalogSnapshot;
	private generation = 0;
	get snapshot(): CatalogSnapshot | undefined { return this.current; }
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
