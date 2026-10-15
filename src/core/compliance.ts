import type { MetadataDocument } from './metadata/document';

export type CompliancePolicy = 'none' | 'atcoder-20261014';
export interface Attribution { readonly urls: readonly string[]; readonly warnings: readonly string[] }
/** An allowlist is deliberate: a newly registered transform is denied until reviewed for this policy. */
export function assertPolicyTransforms(policy: CompliancePolicy, ids: readonly string[]): void {
	if (policy !== 'none' && policy !== 'atcoder-20261014') { throw new Error('Unknown Compliance Policy.'); }
	if (policy === 'atcoder-20261014' && ids.some(id => !['remove-tcp-markers', 'normalize-whitespace', 'remove-comments', 'remove-xml-docs', 'remove-unused-usings'].includes(id))) { throw new Error('Transform is not reviewed for AtCoder policy; obfuscation/unknown transforms are disabled.'); }
}
/** source[].url is canonical; repository[] remains a location, never silently promoted to a code citation. */
export function attribution(documents: readonly MetadataDocument[], policy: CompliancePolicy, contestStartsAt?: string): Attribution {
	assertPolicyTransforms(policy, []);
	const urls = new Set<string>(), warnings: string[] = []; let bytes = 0;
	const timestamp = (value: string | undefined) => {
		const match = value && /^([0-9]{4})-([0-9]{2})-([0-9]{2})T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.exec(value);
		if (!match) { return NaN; } const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
		const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
		return day > 0 && day <= days[month - 1] ? Date.parse(value!) : NaN;
	};
	const contest = timestamp(contestStartsAt);
	for (const document of documents) {
		const source = document.node(['source']); const citations: { url: string; published: boolean }[] = [];
		if (source && source.type !== 'array') { throw new Error('Invalid source metadata; attribution cannot be preserved.'); }
		for (let i = 0; i < (source?.children?.length ?? 0); i++) {
			const url = document.string(['source', i, 'url']); if (!url) { if (policy !== 'none') { throw new Error('source[] needs an explicit source URL for AtCoder policy.'); } continue; }
			let parsed: URL; try { parsed = new URL(url); } catch { throw new Error('Invalid source URL.'); }
			if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || Buffer.from(url).toString('utf8') !== url || /[\s\u0000-\u001f\u007f\u0085\u2028\u2029]/u.test(url)) { throw new Error('Unsafe source URL.'); }
			if (!urls.has(url)) { urls.add(url); bytes += Buffer.byteLength(url); if (urls.size > 10000 || bytes > 1024 * 1024) { throw new Error('Attribution URL count/size limit exceeded.'); } } const published = timestamp(document.string(['source', i, 'publishedAt']));
			citations.push({ url, published: document.string(['source', i, 'publication']) === 'public' && Number.isFinite(published) && Number.isFinite(contest) && published < contest });
		}
		if (policy === 'atcoder-20261014') {
			const ai = document.string(['provenance', 'aiUsage']) ?? 'unknown';
			if (!['used', 'not-used', 'unknown'].includes(ai)) { throw new Error('Unknown provenance.aiUsage; review metadata.'); }
			if (ai !== 'not-used' && (!citations.length || !citations.every(c => c.published))) { throw new Error('AtCoder policy: AI/unknown origin requires source[].url, public publication assertion, publishedAt before an explicit contest start for every citation. Prior publication is not independently verified.'); }
			if (ai === 'not-used' && !citations.length) { warnings.push('Human-authored assertion has no source URL. Citation is strongly recommended for copied code.'); }
		}
	}
	if (policy !== 'none') { warnings.push('AtCoder policy checks metadata assertions and preserves known attribution; web publication/time, provenance accuracy, complete licenses and submission eligibility are NOT verified. Review official rules.'); }
	return { urls: [...urls], warnings: [...new Set(warnings)] };
}
