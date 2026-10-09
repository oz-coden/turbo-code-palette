import { sha256 } from '../core/assets/fingerprint';

export interface SourceMarkerIdentity { readonly id: string; readonly version: string }
export interface MarkerEvidence extends SourceMarkerIdentity { readonly contentHash: string }
/** Comment capability is independent of semantic placement. This v1 provider is deliberately narrow. */
const comments: Readonly<Record<string, string>> = { csharp: '//', c: '//', cpp: '//', java: '//', javascript: '//', javascriptreact: '//', typescript: '//', typescriptreact: '//', go: '//', rust: '//', python: '#' };
const extensions: Readonly<Record<string, string>> = { cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', java: 'java', js: 'javascript', jsx: 'javascriptreact', ts: 'typescript', tsx: 'typescriptreact', go: 'go', rs: 'rust', py: 'python' };
export function sourceLanguage(filename: string): string { return extensions[filename.split('.').at(-1)!.toLowerCase()] ?? ''; }

/** No guessing inside strings/comments/preprocessor continuations or at mid-line positions. */
export function markSource(identity: SourceMarkerIdentity, body: string, language: string, before: string, start: number, end: number, eol: string): string | undefined {
	const prefix = comments[language];
	if (!prefix || !/^[0-9a-f-]{36}$/i.test(identity.id) || !/^v\d+\.\d+\.\d+(?:-\d+)?$/.test(identity.version)) { return; }
	if (start !== 0 && before[start - 1] !== '\n' || end !== before.length && end !== 0 && before[end - 1] !== '\n') { return; }
	// A quote, escape, slash, directive, backtick or possible JSX/XML context requires a real lexer.
	// Refuse this optional annotation rather than extending the generic placement provider.
	if (/["'`\\/#<>]/.test(before.slice(0, start)) || /["'`\\/#<>]/.test(body) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body)) { return; }
	const text = body.replace(/\r\n|\r|\n/g, eol), evidence = { id: identity.id, version: identity.version, contentHash: sha256(text) };
	return `${prefix} TCP BEGIN ${JSON.stringify(evidence)}${eol}${text}${text.endsWith(eol) ? '' : eol}${prefix} TCP END ${JSON.stringify({ id: identity.id, version: identity.version })}${eol}`;
}

/** Candidate evidence, never proof of compatibility. Future Clean Copy must verify lexical context. */
export function markerEvidence(text: string, language: string): MarkerEvidence[] {
	const prefix = comments[language]; if (!prefix) { return []; }
	return text.split(/\r\n|\r|\n/).flatMap(line => {
		if (!line.startsWith(prefix + ' TCP BEGIN ')) { return []; }
		try { const value = JSON.parse(line.slice(prefix.length + 11)) as MarkerEvidence; return typeof value.id === 'string' && /^[0-9a-f-]{36}$/i.test(value.id) && typeof value.version === 'string' && /^v\d+\.\d+\.\d+(?:-\d+)?$/.test(value.version) && /^[0-9a-f]{64}$/.test(value.contentHash) ? [value] : []; } catch { return []; }
	});
}
