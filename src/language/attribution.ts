import { renderLicenseHeader } from './cleanMarkers';
import type { CSharpProvider } from './csharpProvider';

/** Submission citations are independent of optional TCP identity markers. */
export async function attachAttribution(text: string, language: string, notices: readonly string[], urls: readonly string[], csharp?: CSharpProvider): Promise<string> {
	if (!notices.length && !urls.length) { return text; }
	if (language === 'csharp' && csharp?.configured) { return csharp.header(text, notices, urls); }
	const header = renderLicenseHeader([...urls.map(url => 'Source URL: ' + url), ...notices], { fullText: text, start: 0, end: text.length, language });
	if (header === undefined) { throw new Error('Attribution/license comment placement cannot be proven for this language/context. Output stopped.'); }
	return header + text;
}
