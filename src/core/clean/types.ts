export type CleanScope = 'selection' | 'file' | 'bundle';
export type CleanPreset = 'Readable' | 'Competitive' | 'Custom';
export interface CleanFragment {
	readonly fullText: string; readonly start: number; readonly end: number; readonly language: string;
}
export interface CleanResult { readonly text: string; readonly warnings: readonly string[] }
export interface CleanTransform {
	readonly id: string; readonly label: string; readonly capability: string;
	apply(text: string, original: CleanFragment): CleanResult;
}
/** Providers must implement capabilities explicitly; there is no regex fallback for missing operations. */
export interface CleanLanguageProvider {
	readonly id: string; readonly capabilities: ReadonlySet<string>; readonly transforms: readonly CleanTransform[];
	readonly presets: Readonly<Record<'Readable' | 'Competitive', readonly string[]>>;
	licenseHeader?(notices: readonly string[], fragment: CleanFragment): string | undefined;
}
export interface CleanPlan {
	readonly scope: CleanScope; readonly preset: CleanPreset; readonly text: string; readonly language: string; readonly extension: string;
	readonly transforms: readonly string[]; readonly notices: readonly string[]; readonly warnings: readonly string[];
	readonly reviewOnly: boolean;
}
