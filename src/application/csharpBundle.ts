import type { Library } from './library';
import { locationKey } from './library';
import { bundleClosure } from './cleanBundle';
import type { AssetLocation } from '../storage/discovery';
import type { CSharpProvider } from '../language/csharpProvider';
import type { CSharpDocument } from '../language/csharpClient';

export async function csharpDocuments(library: Library, assets: readonly AssetLocation[]): Promise<{ documents: CSharpDocument[]; owners: Map<string, AssetLocation> }> {
	const documents: CSharpDocument[] = [], owners = new Map<string, AssetLocation>();
	for (const asset of assets) {
		if (!asset.usable || asset.root.uri || asset.metadata.blockedFeatures.has('exports') || asset.metadata.sources.some(source => !source.toLowerCase().endsWith('.cs'))) { throw new Error('Semantic C# Bundle requires verified native C# assets with valid exports.'); }
		const sources = await library.sources(asset, asset.metadata.sources);
		for (const source of asset.metadata.sources) {
			const bytes = sources.get(source)!; if (bytes.includes(0)) { throw new Error('Binary Bundle source.'); }
			const id = 'snippet-' + documents.length + '.cs'; documents.push({ id, source: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }); owners.set(id, asset);
			if (documents.length >= 128) { throw new Error('C# Bundle document limit (127 Snippet sources plus current file). Select a smaller library/closure.'); }
		}
	}
	return { documents, owners };
}
/** Binding determines roots; the existing Pack-aware resolver determines the recursive closure. */
export async function csharpBundleRoots(library: Library, current: string, provider: CSharpProvider): Promise<readonly AssetLocation[]> {
	const groups = new Map<string, AssetLocation>();
	for (const asset of library.catalog.snapshot!.snippets.filter(a => a.usable && !a.root.uri && a.metadata.sources.every(s => s.toLowerCase().endsWith('.cs')))) {
		const previous = groups.get(asset.metadata.id!);
		if (previous && (previous.metadata.version!.text !== asset.metadata.version!.text || previous.semanticHash !== asset.semanticHash)) { throw new Error('Multiple C# library revisions/candidates. Select explicit roots through the review path; semantic discovery will not substitute.'); }
		if (!previous || previous.root.scope === 'global' && asset.root.scope === 'workspace') { groups.set(asset.metadata.id!, asset); }
	}
	const assets = [...groups.values()], { documents, owners } = await csharpDocuments(library, assets);
	const reference = await provider.client.request('references', [{ id: 'current.cs', source: current }, ...documents]);
	const roots = [...new Map(reference.result.documents.map(id => { const asset = owners.get(id); if (!asset) { throw new Error('Unknown Bundle source returned by helper.'); } return [locationKey(asset), asset] as const; })).values()];
	if (!roots.length) { throw new Error('No proven known-export references. Use review JSON / explicit selection.'); }
	// Require referenced assets to declare exports; never silently infer metadata dependencies from names.
	for (const root of roots) {
		const metadata = root.metadata.document, rows = metadata.node(['exports'])?.children ?? [];
		const matches = reference.result.references.filter(r => owners.get(r.document) === root).some(r => rows.some((_, i) => metadata.string(['exports', i, 'name']) === r.name && ['namespace', 'container', 'signature'].every(k => { const value = metadata.string(['exports', i, k]); return value === undefined || value === r[k as 'namespace' | 'container' | 'signature']; })));
		if (!matches) { throw new Error('Bound symbol does not match reviewed exports metadata. Review candidates before semantic Bundle.'); }
	}
	return roots;
}
export async function csharpBundleText(library: Library, current: string, roots: readonly AssetLocation[], provider: CSharpProvider): Promise<{ text: string; warnings: string[] }> {
	const closure = bundleClosure(library, roots), { documents } = await csharpDocuments(library, closure.assets);
	const result = await provider.client.request('bundle', [{ id: 'current.cs', source: current }, ...documents]);
	return { text: result.result.text, warnings: [...closure.warnings, ...result.diagnostics, 'Bundle compiled in an isolated runtime-reference context; original project configuration, external packages and behavioral equivalence are not certified.'] };
}
