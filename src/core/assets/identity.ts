import type { MetadataView } from '../metadata/semantics';

export interface IdentifiedAsset {
	readonly metadata: MetadataView;
	readonly semanticHash?: string;
}
export interface AssetGroup<T extends IdentifiedAsset> {
	readonly key: string;
	readonly status: 'identical' | 'conflict' | 'unverified';
	readonly locations: readonly T[];
}

export function groupAssets<T extends IdentifiedAsset>(assets: readonly T[]): AssetGroup<T>[] {
	const groups = new Map<string, T[]>();
	for (const asset of assets) {
		const { kind, id, version } = asset.metadata;
		if (!id || !version) { continue; }
		const key = `${kind}:${id}:${version.text}`;
		const copies = groups.get(key) ?? [];
		copies.push(asset); groups.set(key, copies);
	}
	return [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, locations]) => ({
		key, locations, status: locations.some(asset => !asset.semanticHash) ? 'unverified'
			: new Set(locations.map(asset => asset.semanticHash)).size === 1 ? 'identical' : 'conflict',
	}));
}
