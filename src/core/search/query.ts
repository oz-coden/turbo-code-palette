import { parseConstraint, type VersionConstraint } from '../version/constraint';

export const modifierNames = ['lang', 'tag', 'category', 'pack', 'scope', 'version', 'author', 'feature'] as const;
export type Modifier = typeof modifierNames[number];
export interface SearchQuery {
	readonly words: readonly string[];
	readonly filters: readonly { key: Modifier; value: string; constraint?: VersionConstraint }[];
	readonly errors: readonly string[];
}

export function parseQuery(input: string): SearchQuery {
	const words: string[] = [], filters: SearchQuery['filters'][number][] = [], errors: string[] = [];
	if (input.length > 8192) { return { words, filters, errors: ['query-size-limit'] }; }
	const tokens: string[] = [];
	let token = '', quote = false, escaped = false;
	for (const char of input) {
		if (escaped) { token += char; escaped = false; }
		else if (quote && char === '\\') { escaped = true; }
		else if (char === '"') { quote = !quote; }
		else if (!quote && /\s/.test(char)) { if (token) { tokens.push(token); token = ''; } }
		else { token += char; }
	}
	if (quote || escaped) { errors.push('unclosed-quote'); }
	if (token) { tokens.push(token); }
	if (tokens.length > 64) { errors.push('query-token-limit'); }
	for (const value of tokens.slice(0, 64)) {
		const colon = value.indexOf(':');
		if (colon < 0) { words.push(value.toLowerCase()); continue; }
		const key = value.slice(0, colon).toLowerCase(), operand = value.slice(colon + 1);
		if (!modifierNames.includes(key as Modifier)) { errors.push('unknown-modifier'); continue; }
		if (!operand) { errors.push('empty-modifier'); continue; }
		try {
			const constraint = key === 'version' ? parseConstraint(operand.startsWith('v') ? '=' + operand : operand) : undefined;
			if (constraint?.empty) { errors.push('empty-version-range'); }
			if (key === 'scope' && !['workspace', 'global'].includes(operand.toLowerCase())) { errors.push('invalid-scope'); }
			filters.push({ key: key as Modifier, value: operand.toLowerCase(), constraint });
		} catch { errors.push('invalid-version-filter'); }
	}
	return { words, filters, errors };
}
