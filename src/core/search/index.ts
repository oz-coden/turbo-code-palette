import type { AssetGroup } from '../assets/identity';
import { compareVersions } from '../version/parser';
import { satisfies } from '../version/constraint';
import type { AssetLocation } from '../../storage/discovery';
import { parseQuery, type Modifier } from './query';

export interface SearchHit {
	readonly group: AssetGroup<AssetLocation>;
	readonly score: number;
	readonly locations: readonly AssetLocation[];
	readonly canInsert: boolean;
}
const lower = (values: readonly string[]): string[] => values.map(value => value.toLowerCase());
function values(asset: AssetLocation, key: Modifier): readonly string[] {
	const metadata = asset.metadata;
	switch (key) {
		case 'lang': return metadata.languages;
		case 'tag': return metadata.tags;
		case 'category': return metadata.category ? [metadata.category] : [];
		case 'pack': return [asset.packName];
		case 'scope': return [asset.root.scope];
		case 'version': return [metadata.version!.text];
		case 'author': return metadata.authors;
		case 'feature': return metadata.features;
	}
}
function score(asset: AssetLocation, words: readonly string[]): number | undefined {
	if (!words.length) { return 0; }
	const metadata = asset.metadata, name = metadata.name!.toLowerCase();
	const phrase = words.join(' ');
	const wordRank = (word: string): number | undefined => name === word ? 0 : name.startsWith(word) ? 1 : name.includes(word) ? 2
		: lower([...metadata.tags, ...(metadata.category ? [metadata.category] : [])]).some(value => value.includes(word)) ? 3
			: lower(metadata.features).some(value => value.includes(word)) ? 4
				: metadata.description?.toLowerCase().includes(word) ? 5 : undefined;
	const ranks = words.map(wordRank);
	if (ranks.some(rank => rank === undefined)) { return undefined; }
	return name === phrase ? 0 : name.startsWith(phrase) ? 1 : name.includes(phrase) ? 2 : Math.max(...ranks as number[]);
}
function scopeRank(asset: AssetLocation, targetWorkspace?: string): number {
	return targetWorkspace && asset.root.workspaceId === targetWorkspace ? 0 : asset.root.scope === 'workspace' ? 1 : 2;
}

export function searchAssets(groups: readonly AssetGroup<AssetLocation>[], input: string, targetWorkspace?: string):
	{ readonly hits: readonly SearchHit[]; readonly errors: readonly string[] } {
	const query = parseQuery(input);
	if (query.errors.length) { return { hits: [], errors: query.errors }; }
	const hits: SearchHit[] = [];
	for (const group of groups) {
		const matches = group.locations.filter(asset => query.filters.every(filter => filter.constraint
			? satisfies(asset.metadata.version!, filter.constraint) : lower(values(asset, filter.key)).includes(filter.value)))
			.map(asset => ({ asset, rank: score(asset, query.words) })).filter(item => item.rank !== undefined);
		if (!matches.length) { continue; }
		matches.sort((a, b) => a.rank! - b.rank! || scopeRank(a.asset, targetWorkspace) - scopeRank(b.asset, targetWorkspace)
			|| a.asset.relativePath.localeCompare(b.asset.relativePath, 'en'));
		const locations = matches.map(item => item.asset);
		hits.push({ group, score: matches[0].rank!, locations,
			canInsert: group.status === 'identical' && locations.every(asset => asset.usable) });
	}
	hits.sort((a, b) => a.score - b.score || scopeRank(a.locations[0], targetWorkspace) - scopeRank(b.locations[0], targetWorkspace)
		|| -compareVersions(a.locations[0].metadata.version!, b.locations[0].metadata.version!)
		|| a.group.key.localeCompare(b.group.key, 'en'));
	return { hits, errors: [] };
}

/** Values come from the loaded library, with quoting so suggestions remain valid queries. */
export function modifierSuggestions(groups: readonly AssetGroup<AssetLocation>[], key: Modifier): string[] {
	const all = new Set(groups.flatMap(group => group.locations.flatMap(asset => [...values(asset, key)])));
	return [...all].sort((a, b) => a.localeCompare(b, 'en')).map(value => `${key}:${JSON.stringify(value)}`);
}
