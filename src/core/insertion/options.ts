import type { CompliancePolicy } from '../compliance';

export type SourceAttribution = 'none' | 'source-urls' | 'full';
export interface InsertOptions { readonly attribution: SourceAttribution; readonly identityMarkers: boolean; readonly preview: boolean }
export const defaultInsertOptions: InsertOptions = { attribution: 'none', identityMarkers: false, preview: false };
export function resolveInsertOptions(defaults: InsertOptions, override: Partial<InsertOptions> | undefined, policy: CompliancePolicy): { options: InsertOptions; forced: readonly string[] } {
	const requested = { ...defaults, ...override };
	if (!['none', 'source-urls', 'full'].includes(requested.attribution) || typeof requested.identityMarkers !== 'boolean' || typeof requested.preview !== 'boolean') { throw new Error('Invalid insertion/output options.'); }
	if (policy !== 'none' && policy !== 'atcoder-20261014') { throw new Error('Unknown Compliance Policy.'); }
	const forced = policy === 'atcoder-20261014' && requested.attribution === 'none' ? ['AtCoder policy requires source URL attribution; Source attribution was changed from none to source-urls for this operation.'] : [];
	return { options: Object.freeze({ ...requested, attribution: forced.length ? 'source-urls' : requested.attribution }), forced };
}
