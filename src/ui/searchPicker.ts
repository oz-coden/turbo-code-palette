import type { QuickPickItem } from 'vscode';
import type { AssetGroup } from '../core/assets/identity';
import type { AssetLocation } from '../storage/discovery';
import { modifierSuggestions, searchAssets } from '../core/search/index';
import { modifierNames } from '../core/search/query';

export interface SearchPickerItem extends QuickPickItem { readonly action: 'apply' | 'clear' | 'condition' | 'error'; readonly query?: string }
function activeToken(value: string): { text: string; start: number } {
	let start = 0, quoted = false, escaped = false;
	for (let index = 0; index < value.length; index++) {
		const char = value[index];
		if (escaped) { escaped = false; } else if (quoted && char === '\\') { escaped = true; }
		else if (char === '"') { quoted = !quoted; } else if (!quoted && /\s/.test(char)) { start = index + 1; }
	}
	return { text: value.slice(start), start };
}
/** TCP owns query parsing. VS Code's label filter must not hide actions or filter twice. */
export function searchPickerItems(groups: readonly AssetGroup<AssetLocation>[], value: string): SearchPickerItem[] {
	const result = searchAssets(groups, value), items: SearchPickerItem[] = [result.errors.length
		? { label: 'Cannot apply filter', description: result.errors.join(', '), action: 'error', alwaysShow: true }
		: { label: `Apply filter (${result.hits.length} items)`, description: value || 'All items', action: 'apply', query: value, alwaysShow: true },
		{ label: 'Clear search', description: 'Show all items allowed by All / Favorites / Recent', action: 'clear', query: '', alwaysShow: true }];
	// Accepted conditions end in a space, leaving every dimension available again.
	const tail = activeToken(value), active = /^[A-Za-z]+:/.test(tail.text) ? tail.text.replaceAll('"', '').toLowerCase() : undefined;
	const base = active ? value.slice(0, tail.start).trimEnd() : value.trimEnd();
	for (const key of modifierNames) {
		const suggestions = modifierSuggestions(groups, key).filter(query => !active || query.replaceAll('"', '').toLowerCase().startsWith(active));
		for (const query of suggestions.slice(0, active ? 30 : 10)) {
			if (!active && value.includes(query)) { continue; }
			items.push({ label: query, description: 'Add condition; then select Apply filter', action: 'condition', query: (base ? base + ' ' : '') + query + ' ', alwaysShow: true });
		}
	}
	return items;
}
