import type { CleanFragment, CleanResult } from '../core/clean/types';
import { MetadataDocument } from '../core/metadata/document';
import { UUID } from '../core/metadata/semantics';
import { parseVersion } from '../core/version/parser';

export interface MarkerIdentity { readonly id: string; readonly version: string }
interface Marker extends MarkerIdentity { readonly kind: 'BEGIN' | 'END'; readonly start: number; readonly end: number; readonly safe: boolean }
interface Pair { readonly begin: Marker; readonly end: Marker }
const commentPrefixes: Readonly<Record<string, string>> = { csharp: '//', c: '//', cpp: '//', java: '//', javascript: '//', javascriptreact: '//', typescript: '//', typescriptreact: '//', go: '//', rust: '//', python: '#' };
export function cleanCommentPrefix(language: string): string | undefined { return commentPrefixes[language]; }

function parseLine(line: string, prefix: string): (MarkerIdentity & { kind: Marker['kind'] }) | undefined {
	if (line.length > 4096) { return; }
	const kind = line.startsWith(prefix + ' TCP BEGIN ') ? 'BEGIN' : line.startsWith(prefix + ' TCP END ') ? 'END' : undefined;
	if (!kind) { return; }
	const document = new MetadataDocument(line.slice(prefix.length + (kind === 'BEGIN' ? 11 : 9)));
	const id = document.string(['id']), version = document.string(['version']);
	if (document.diagnostics.length || !id || !UUID.test(id) || !version) { return; }
	try { parseVersion(version); } catch { return; }
	const keys = document.root!.children!.map(node => node.children![0].value as string);
	if (keys.some(key => !['id', 'version', ...(kind === 'BEGIN' ? ['contentHash'] : [])].includes(key)) || keys.length !== (kind === 'BEGIN' ? 3 : 2)) { return; }
	if (kind === 'BEGIN' && !/^[a-f0-9]{64}$/.test(document.string(['contentHash']) ?? '')) { return; }
	return { id: id.toLowerCase(), version, kind };
}

/** Conservative proof from document start. Once lexical context becomes uncertain it never recovers. */
function scan(fragment: CleanFragment): { pairs: Pair[]; markers: Marker[]; provenEnd: boolean } {
	const prefix = cleanCommentPrefix(fragment.language), markers: Marker[] = [], pairs: Pair[] = [];
	if (!prefix) { return { pairs, markers, provenEnd: false }; }
	let safe = true, offset = 0, open: Marker | undefined, nested = false;
	while (offset < fragment.fullText.length) {
		let end = offset; while (end < fragment.fullText.length && fragment.fullText[end] !== '\r' && fragment.fullText[end] !== '\n') { end++; }
		const line = fragment.fullText.slice(offset, end), parsed = parseLine(line, prefix);
		if (parsed) {
			if (markers.length >= 10000) { throw new Error('Clean Copy marker count limit exceeded.'); }
			const marker: Marker = { ...parsed, start: offset, end, safe: safe && !/[\u0085\u2028\u2029\\]/.test(line) }; markers.push(marker);
			if (marker.kind === 'BEGIN') { if (open) { nested = true; } else { open = marker; nested = false; } }
			else if (open) { if (!nested && open.id === marker.id && open.version === marker.version) { pairs.push({ begin: open, end: marker }); } open = undefined; nested = false; }
		}
		// Ordinary comments may carry pragmas/directives. Do not reason through them without a real lexer.
		if (/[\u0085\u2028\u2029\\]/.test(line) || line.includes('??/') || !parsed && /["'`/#<>]/.test(line)) { safe = false; }
		offset = end + (fragment.fullText[end] === '\r' && fragment.fullText[end + 1] === '\n' ? 2 : 1);
	}
	return { pairs, markers, provenEnd: safe };
}

export function relevantMarkerIdentities(fragment: CleanFragment): MarkerIdentity[] {
	const { pairs, markers } = scan(fragment), relevant = markers.filter(marker => marker.start < fragment.end && marker.end > fragment.start);
	for (const pair of pairs) { if (pair.begin.start < fragment.end && pair.end.end > fragment.start) { relevant.push(pair.begin); } }
	return [...new Map(relevant.map(marker => [`${marker.id}:${marker.version}`, { id: marker.id, version: marker.version }])).values()];
}

export function removeCleanMarkers(text: string, fragment: CleanFragment): CleanResult {
	if (text !== fragment.fullText.slice(fragment.start, fragment.end)) { throw new Error('Marker removal must run against the captured original fragment, before other text transforms.'); }
	const { pairs } = scan(fragment), ranges = pairs.filter(pair => pair.begin.safe && pair.end.safe && pair.begin.start >= fragment.start && pair.end.end <= fragment.end).flatMap(pair => [pair.begin, pair.end]);
	let result = text;
	for (const range of ranges.sort((left, right) => right.start - left.start)) { result = result.slice(0, range.start - fragment.start) + result.slice(range.end - fragment.start); }
	const remaining = result.includes('TCP BEGIN ') || result.includes('TCP END ');
	return { text: result, warnings: remaining ? ['TCP marker candidate retained: independent comment context / complete matching pair could not be proven.'] : [] };
}

/** A fresh independent header at a proven line boundary; never wrap notices inside a block comment. */
export function renderLicenseHeader(notices: readonly string[], fragment: CleanFragment): string | undefined {
	const prefix = cleanCommentPrefix(fragment.language); if (!prefix) { return; }
	if (fragment.start && fragment.fullText[fragment.start - 1] !== '\n') { return; }
	if (fragment.start && !scan({ ...fragment, fullText: fragment.fullText.slice(0, fragment.start), start: 0, end: fragment.start }).provenEnd) { return; }
	const body = fragment.fullText.slice(fragment.start, fragment.end);
	if (body.startsWith('\uFEFF') || body.startsWith('#!') || fragment.language === 'python' && body.split(/\r\n|\r|\n/, 2).some(line => /coding[:=]/.test(line))) { return; }
	if (notices.some(notice => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u0085\u2028\u2029\\]/.test(notice) || notice.includes('??/'))) { return; }
	if (fragment.language === 'python' && notices.some(notice => /coding[:=]/.test(notice))) { return; }
	if (fragment.language === 'go' && notices.some(notice => notice.split(/\r\n|\r|\n/).some(line => ['+build', 'go:', 'line '].some(directive => line.trimStart().startsWith(directive))))) { return; }
	const eol = fragment.fullText.includes('\r\n') ? '\r\n' : '\n';
	return notices.flatMap(notice => notice.split(/\r\n|\r|\n/).map(line => prefix + ' ' + line)).join(eol) + eol;
}
