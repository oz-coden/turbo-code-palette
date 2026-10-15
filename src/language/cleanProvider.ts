import type { CleanLanguageProvider } from '../core/clean/types';
import { cleanCommentPrefix, removeCleanMarkers, renderLicenseHeader } from './cleanMarkers';

/** New syntax/semantic providers can register capabilities without changing the pipeline. */
export class CleanProviders {
	private readonly providers = new Map<string, CleanLanguageProvider>();
	private revision = 0;
	get generation(): number { return this.revision; }
	register(language: string, provider: CleanLanguageProvider): { dispose(): void } {
		if (this.providers.has(language)) { throw new Error('A Clean Copy provider is already registered for this language.'); }
		this.providers.set(language, provider); this.revision++; return { dispose: () => { if (this.providers.get(language) === provider) { this.providers.delete(language); this.revision++; } } };
	}
	get(language: string): CleanLanguageProvider {
		const registered = this.providers.get(language); if (registered) { return registered; }
		const supported = !!cleanCommentPrefix(language);
		return {
			id: supported ? 'conservative-line-comments-v1' : 'generic-preserve-v1', capabilities: new Set(supported ? ['tcp-marker-lines', 'license-comment-header'] : []),
			transforms: supported ? [{ id: 'remove-tcp-markers', label: 'Remove proven TCP marker comment lines', capability: 'tcp-marker-lines', apply: removeCleanMarkers }] : [],
			presets: { Readable: supported ? ['remove-tcp-markers'] : [], Competitive: supported ? ['remove-tcp-markers'] : [] },
			...(supported ? { licenseHeader: renderLicenseHeader } : {}),
		};
	}
}
