import type { MetadataDocument } from '../core/metadata/document';

/** No AST or speculative code placement. The only generic structural target is a plaintext file. */
export function supportsStructure(language: string, document: MetadataDocument): boolean {
	const targets = document.node(['insert', 'targets']);
	return language === 'plaintext' && targets?.type === 'array' && targets.children?.length === 1 && targets.children[0].value === 'file';
}
export function exportNames(document: MetadataDocument): string[] {
	const exports = document.node(['exports']); if (!exports) { return []; }
	if (exports.type !== 'array') { throw new Error('Invalid exports; collision checking cannot proceed.'); }
	return (exports.children ?? []).map((node, index) => {
		const name = document.string(['exports', index, 'name']);
		if (node.type !== 'object' || !name?.trim()) { throw new Error('Invalid export declaration.'); } return name;
	});
}
export function validateCollisions(text: string, items: readonly { name: string; exports: readonly string[]; sources: readonly string[] }[]): void {
	const names = new Set<string>();
	for (const item of items) {
		for (const name of item.exports) {
			// A conservative textual hit is a reason to stop, never proof of compatible implementation.
			if (names.has(name) || text.includes(name)) { throw new Error(`Possible symbol/name collision: ${name}. Comparison is required before insertion.`); } names.add(name);
		}
		if (item.sources.some(source => source.trim() && text.includes(source))) { throw new Error(`Ambiguous existing implementation: ${item.name}.`); }
	}
}
