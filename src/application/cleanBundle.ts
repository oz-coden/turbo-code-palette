import { Library, locationKey, packOf, sameRoot } from './library';
import type { AssetLocation, CatalogSnapshot } from '../storage/discovery';
import { resolveClosure } from '../core/dependency/resolver';
import { dependencyOrder } from '../core/dependency/order';
import { exportNames, validateCollisions } from '../language/genericProvider';
import { sourceLanguage } from '../language/sourceMarker';
import { ConflictError } from '../core/conflict';
import { cleanFragmentAsync, collectNotices } from '../core/clean/pipeline';
import type { CleanFragment, CleanLanguageProvider, CleanPlan, CleanPreset } from '../core/clean/types';

export interface ReferenceCandidate { readonly asset: AssetLocation; readonly exports: readonly string[]; readonly confirmed: false }
/** Text hits are diagnostics, including hits inside strings/comments. They never resolve a symbol. */
export function bundleCandidates(text: string, snapshot: CatalogSnapshot): ReferenceCandidate[] {
	return snapshot.snippets.filter(asset => asset.usable && !asset.root.uri && !asset.metadata.blockedFeatures.has('exports')).flatMap(asset => {
		const names = exportNames(asset.metadata.document).filter(name => text.includes(name)); return names.length ? [{ asset, exports: names, confirmed: false as const }] : [];
	});
}
/** Preserve Pack-internal dependency identity; combine closures with the SAME resolver, never substitute. */
export function bundleClosure(library: Library, selected: readonly AssetLocation[]): { assets: AssetLocation[]; warnings: string[] } {
	if (!selected.length) { throw new Error('Select at least one Snippet explicitly. Generic text matches are not resolved references.'); }
	const snapshot = library.catalog.snapshot!;
	const closures = selected.map(asset => {
		if (!snapshot.snippets.includes(asset) || !asset.usable || asset.root.uri) { throw new Error('Bundle sources require loaded, verified native local Snippets.'); }
		const pack = snapshot.packs.find(pack => sameRoot(pack.root, asset.root) && pack.relativePath === packOf(asset)); if (!pack?.usable) { throw new Error('Bundle source Pack is incomplete or unsafe.'); }
		return resolveClosure([asset], library.members(pack), { strictConflicts: true, workspaceId: asset.root.workspaceId });
	});
	const merged = resolveClosure(closures.flatMap(closure => closure.members), closures.flatMap(closure => closure.members), { strictConflicts: true });
	for (const asset of merged.members) {
		const conflicts = snapshot.snippets.filter(other => other.metadata.id === asset.metadata.id && other.metadata.version!.text === asset.metadata.version!.text && other.semanticHash !== asset.semanticHash);
		if (conflicts.length) { throw new ConflictError('Bundle same UUID/version content conflict. Compare before copying.', { incoming: asset, existing: conflicts }); }
	}
	return { assets: dependencyOrder(merged.members), warnings: [...new Set([...closures.flatMap(closure => closure.warnings), ...merged.warnings])] };
}
export interface ReviewFile { readonly source: string; readonly text: string; readonly language: string; readonly asset?: { readonly id: string; readonly version: string } }
export async function bundleReviewPlan(library: Library, fragment: CleanFragment, preset: CleanPreset, selected: readonly AssetLocation[], providers: { get(language: string): CleanLanguageProvider }, custom: readonly string[] = [], currentNotices: readonly string[] = [], currentWarnings: readonly string[] = []): Promise<{ plan: CleanPlan; assets: readonly AssetLocation[] }> {
	const closure = bundleClosure(library, selected), files: ReviewFile[] = [], warnings = ['Generic Dependency Bundle is a review JSON document, not merged/executable code. Text hits are unverified; unresolved/ambiguous references are not resolved. Templates remain source data.', ...currentWarnings], transforms: string[] = [];
	let serializedBytes = 0;
	const addFile = (file: ReviewFile) => { serializedBytes += Buffer.byteLength(JSON.stringify(file, null, 2)) + 128; if (files.length >= 10000 || serializedBytes > 31 * 1024 * 1024) { throw new Error('Dependency Bundle file/serialized byte limit exceeded.'); } files.push(file); };
	const current = await cleanFragmentAsync(fragment, providers.get(fragment.language), preset, custom); addFile({ source: 'current-file', text: current.text, language: fragment.language }); warnings.push(...current.warnings);
	for (const asset of closure.assets) {
		const bytes = await library.sources(asset, asset.metadata.sources);
		for (const source of asset.metadata.sources) {
			const buffer = bytes.get(source)!; if (buffer.includes(0)) { throw new Error('Binary source cannot be copied as text.'); }
			const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer), language = sourceLanguage(source) || 'plaintext';
			const result = await cleanFragmentAsync({ fullText: text, start: 0, end: text.length, language }, providers.get(language), preset, custom);
			addFile({ source, text: result.text, language, asset: { id: asset.metadata.id!, version: asset.metadata.version!.text } }); warnings.push(...result.warnings); transforms.push(...result.transforms);
		}
	}
	// Reuse insertion's conservative collision checks as diagnostics for the review manifest.
	// No code is merged, deduplicated or replaced on the strength of these textual hits.
	try { validateCollisions(fragment.fullText, closure.assets.map(asset => ({ name: asset.metadata.name!, exports: exportNames(asset.metadata.document), sources: files.filter(file => file.asset?.id === asset.metadata.id).map(file => file.text) }))); }
	catch (error) { warnings.push((error as Error).message + ' Review only; no automatic merge/replacement is available.'); }
	const packs = closure.assets.map(asset => snapshotPack(library, asset));
	const notices = [...new Set([...currentNotices, ...collectNotices([...closure.assets, ...packs].map(asset => asset.metadata.document))])];
	warnings.push(...closure.warnings);
	const text = JSON.stringify({ format: 'tcp-dependency-review', formatVersion: 1, executable: false, warnings: [...new Set(warnings)], licenseNotices: notices, files }, null, 2) + '\n';
	if (Buffer.byteLength(text) > 32 * 1024 * 1024) { throw new Error('Dependency Bundle output limit exceeded.'); }
	return { assets: closure.assets, plan: Object.freeze({ scope: 'bundle', preset, text, language: 'json', extension: '.json', transforms: Object.freeze([...new Set([...current.transforms, ...transforms]), 'preserve-license-notices']), notices: Object.freeze(notices), warnings: Object.freeze([...new Set(warnings)]), reviewOnly: true }) };
}
function snapshotPack(library: Library, asset: AssetLocation): AssetLocation {
	const pack = library.catalog.snapshot!.packs.find(pack => sameRoot(pack.root, asset.root) && pack.relativePath === packOf(asset)); if (!pack) { throw new Error('Pack disappeared: ' + locationKey(asset)); } return pack;
}
