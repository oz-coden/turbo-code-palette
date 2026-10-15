import { renderLicenseHeader } from './cleanMarkers';
import type { AttributionLanguageProvider } from './provider';
import type { MetadataDocument } from '../core/metadata/document';
import { attribution, type CompliancePolicy } from '../core/compliance';
import { collectNotices } from '../core/clean/pipeline';
import type { SourceAttribution } from '../core/insertion/options';
import type { CleanFragment } from '../core/clean/types';

export function collectAttribution(snippets: readonly MetadataDocument[], noticeDocuments: readonly MetadataDocument[], level: SourceAttribution, policy: CompliancePolicy, contestStart?: string): { urls: readonly string[]; details: readonly string[]; notices: readonly string[]; warnings: readonly string[] } {
	const origin = level !== 'none' || policy !== 'none' ? attribution(snippets, policy, contestStart) : { urls: [], warnings: [] };
	const details = level === 'full' ? snippets.map(doc => {
		const authors = (doc.node(['authors'])?.children ?? []).map((node, i) => node.type === 'string' ? String(node.value) : doc.string(['authors', i, 'name'])).filter(Boolean);
		const text = `Snippet: ${doc.string(['name']) ?? 'Unnamed'} ${doc.string(['version']) ?? ''}${authors.length ? ' | Authors: ' + authors.join(', ') : ''}`;
		if (/[\u0000-\u001f\u007f\u0085\u2028\u2029]/u.test(text)) { throw new Error('Attribution details contain unsafe line/control characters.'); } return text;
	}) : [];
	return { urls: level === 'none' ? [] : origin.urls, details: [...new Set(details)], notices: collectNotices(noticeDocuments), warnings: origin.warnings };
}

/** Submission citations are independent of optional TCP identity markers. */
export async function attachAttribution(text: string, language: string, notices: readonly string[], urls: readonly string[], provider?: AttributionLanguageProvider, details: readonly string[] = [], fragment?: CleanFragment): Promise<string> {
	if (!notices.length && !urls.length && !details.length) { return text; }
	if (fragment && (fragment.start !== 0 || fragment.end !== fragment.fullText.length)) {
		const header = renderLicenseHeader([...new Set([...urls.map(url => 'Source URL: ' + url), ...details, ...notices.flatMap(notice => notice.split(/\r\n|\r|\n/).map(line => 'TCP License: ' + line))])], fragment);
		if (header === undefined) { throw new Error('Attribution/license comment placement cannot be proven for this selection. Output stopped.'); }
		return header + text;
	}
	if (provider?.languages.has(language) && provider.configured && provider.header) { return provider.header(text, notices, urls, details); }
	const entries = [...new Set([...urls.map(url => 'Source URL: ' + url), ...details, ...notices.flatMap(notice => notice.split(/\r\n|\r|\n/).map(line => 'TCP License: ' + line))])];
	if (language === 'html') {
		if (entries.some(entry => entry.includes('--') || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u0085\u2028\u2029]/u.test(entry))) { throw new Error('Attribution/license cannot be encoded as a safe HTML comment. Output stopped.'); }
		const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''; return bom + entries.map(entry => '<!-- ' + entry + ' -->\n').join('') + text.slice(bom.length);
	}
	const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '', body = text.slice(bom.length);
	const header = renderLicenseHeader(entries, { fullText: body, start: 0, end: body.length, language });
	if (header === undefined) { throw new Error('Attribution/license cannot be safely encoded: comment placement cannot be proven for this language/context. Output stopped.'); }
	return bom + header + body;
}
