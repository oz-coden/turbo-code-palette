import type { MetadataDocument } from '../metadata/document';
import type { CleanFragment, CleanLanguageProvider, CleanPlan, CleanPreset, CleanScope } from './types';

export function collectNotices(documents: readonly MetadataDocument[]): string[] {
	const notices = new Set<string>(); let bytes = 0;
	for (const document of documents) {
		const node = document.node(['licenseNotices']); if (!node) { continue; }
		if (node.type !== 'array') { throw new Error('Invalid licenseNotices: cannot safely preserve notice metadata.'); }
		for (let index = 0; index < (node.children?.length ?? 0); index++) {
			const text = document.string(['licenseNotices', index, 'text']);
			if (node.children![index].type !== 'object' || text === undefined) { throw new Error('Invalid licenseNotices[].text: repair metadata before Clean Copy.'); }
			if (!notices.has(text)) { notices.add(text); bytes += Buffer.byteLength(text); if (notices.size > 10000 || bytes > 1024 * 1024) { throw new Error('Clean Copy license notice limit exceeded.'); } }
		}
	} return [...notices];
}

export function availableTransforms(provider: CleanLanguageProvider) {
	return provider.transforms.filter(transform => provider.capabilities.has(transform.capability));
}
export function cleanFragment(fragment: CleanFragment, provider: CleanLanguageProvider, preset: CleanPreset, custom?: readonly string[]): { text: string; transforms: string[]; warnings: string[] } {
	if (!Number.isSafeInteger(fragment.start) || !Number.isSafeInteger(fragment.end) || fragment.start < 0 || fragment.end < fragment.start || fragment.end > fragment.fullText.length || Buffer.byteLength(fragment.fullText) > 16 * 1024 * 1024) { throw new Error('Invalid/oversized Clean Copy capture.'); }
	if (fragment.fullText.includes('\0')) { throw new Error('Binary/NUL text is not supported by Clean Copy.'); }
	const ids = preset === 'Custom' ? custom ?? [] : provider.presets[preset];
	if (!ids || new Set(ids).size !== ids.length || ids.length > 64) { throw new Error('Invalid Clean Copy transform pipeline.'); }
	let text = fragment.fullText.slice(fragment.start, fragment.end); const warnings: string[] = [];
	for (const id of ids) {
		const transform = provider.transforms.find(transform => transform.id === id);
		if (!transform || !provider.capabilities.has(transform.capability)) { throw new Error(`Unsupported Clean Copy transform: ${id}. No fallback was applied.`); }
		const result = transform.apply(text, fragment); text = result.text; warnings.push(...result.warnings);
		if (Buffer.byteLength(text) > 32 * 1024 * 1024) { throw new Error('Clean Copy output limit exceeded.'); }
	}
	if (!ids.includes('remove-tcp-markers') && (text.includes('TCP BEGIN ') || text.includes('TCP END '))) { warnings.push('TCP markers retained: removal is unavailable or not selected.'); }
	return { text, transforms: [...ids], warnings };
}

export function textCleanPlan(fragment: CleanFragment, provider: CleanLanguageProvider, options: { scope: Exclude<CleanScope, 'bundle'>; preset: CleanPreset; custom?: readonly string[]; notices: readonly string[]; extension: string; warnings?: readonly string[] }): CleanPlan {
	const cleaned = cleanFragment(fragment, provider, options.preset, options.custom), notices = [...new Set(options.notices)];
	if (notices.length) {
		const header = provider.capabilities.has('license-comment-header') && provider.licenseHeader?.(notices, fragment);
		if (typeof header !== 'string') { throw new Error('License notices cannot be safely reattached for this language/selection. Original text is unchanged. Use a full supported file or Dependency Bundle review JSON.'); }
		cleaned.text = header + cleaned.text;
	}
	if (Buffer.byteLength(cleaned.text) > 32 * 1024 * 1024) { throw new Error('Clean Copy output limit exceeded.'); }
	if (Buffer.from(cleaned.text).toString('utf8') !== cleaned.text) { throw new Error('Clean Copy cannot encode an unpaired UTF-16 surrogate losslessly. Select complete characters.'); }
	return Object.freeze({ scope: options.scope, preset: options.preset, text: cleaned.text, language: fragment.language, extension: options.extension,
		transforms: Object.freeze([...cleaned.transforms, 'preserve-license-notices']), notices: Object.freeze(notices), warnings: Object.freeze([...new Set([...(options.warnings ?? []), ...cleaned.warnings])]), reviewOnly: false });
}

/** Async providers share the same capability checks, ordered transforms and immutable output contract. */
export async function cleanFragmentAsync(fragment: CleanFragment, provider: CleanLanguageProvider, preset: CleanPreset, custom?: readonly string[]): Promise<ReturnType<typeof cleanFragment>> {
	// Validate capture and selection without executing a transform.
	cleanFragment(fragment, provider, 'Custom', []);
	const ids = preset === 'Custom' ? custom ?? [] : provider.presets[preset];
	if (!ids || ids.length > 64 || new Set(ids).size !== ids.length) { throw new Error('Invalid Clean Copy transform pipeline.'); }
	let text = fragment.fullText.slice(fragment.start, fragment.end); const warnings: string[] = [];
	for (const id of ids) {
		const transform = availableTransforms(provider).find(t => t.id === id); if (!transform) { throw new Error('Unsupported transform; no fallback: ' + id); }
		const result = transform.applyAsync ? await transform.applyAsync(text, fragment) : transform.apply(text, fragment); text = result.text; warnings.push(...result.warnings);
		if (Buffer.byteLength(text) > 32 * 1024 * 1024) { throw new Error('Clean Copy output limit exceeded.'); }
	}
	return { text, transforms: [...ids], warnings };
}
export async function textCleanPlanAsync(fragment: CleanFragment, provider: CleanLanguageProvider, options: Parameters<typeof textCleanPlan>[2]): Promise<CleanPlan> {
	const cleaned = await cleanFragmentAsync(fragment, provider, options.preset, options.custom), notices = [...new Set(options.notices)];
	if (notices.length) {
		if (provider.attachNotices) { cleaned.text = await provider.attachNotices(cleaned.text, notices, fragment); }
		else { const header = provider.capabilities.has('license-comment-header') && provider.licenseHeader?.(notices, fragment); if (typeof header !== 'string') { throw new Error('License notices cannot be safely reattached for this language/selection.'); } cleaned.text = header + cleaned.text; }
	}
	if (Buffer.byteLength(cleaned.text) > 32 * 1024 * 1024 || Buffer.from(cleaned.text).toString('utf8') !== cleaned.text) { throw new Error('Invalid/oversized Clean Copy output encoding.'); }
	return Object.freeze({ scope: options.scope, preset: options.preset, text: cleaned.text, language: fragment.language, extension: options.extension, transforms: Object.freeze([...cleaned.transforms, 'preserve-license-notices']), notices: Object.freeze(notices), warnings: Object.freeze([...new Set([...(options.warnings ?? []), ...cleaned.warnings])]), reviewOnly: false });
}
