import type { MarkerEvidence } from './sourceMarker';

/** Optional language capabilities. Core text insertion never requires a syntax/semantic process. */
export interface InsertionLanguageProvider extends AttributionLanguageProvider {
	readonly id: string;
	readonly languages: ReadonlySet<string>;
	readonly configured: boolean;
	availability(): Promise<{ available: boolean; reason: string }>;
	markers(source: string): Promise<readonly MarkerEvidence[]>;
	place(source: string, incoming: string, offset: number, targets: readonly string[], eol?: '\n' | '\r\n'): Promise<{ result: { offset: number; text: string; context: string }; diagnostics: string[] }>;
	validate(source: string): Promise<string[]>;
}
export interface AttributionLanguageProvider {
	readonly languages: ReadonlySet<string>;
	readonly configured: boolean;
	header?(source: string, notices: readonly string[], urls: readonly string[], details?: readonly string[]): Promise<string>;
}
