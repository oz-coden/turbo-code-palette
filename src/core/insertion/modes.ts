import type { MetadataDocument } from '../metadata/document';
export const modes = ['cursor', 'end-of-file', 'replace-selection', 'structure-aware', 'separate-files', 'merge-sources'] as const;
export type InsertMode = typeof modes[number];
export function modePolicy(document: MetadataDocument, capabilities: { structure: boolean; files: boolean }): { available: InsertMode[]; preferred?: InsertMode } {
	const array = (key: string): string[] | undefined => {
		const node = document.node(['insert', key]); if (!node) { return; }
		if (node.type !== 'array' || node.children?.some(child => child.type !== 'string')) { throw new Error('Invalid insertion mode policy.'); }
		return (node.children ?? []).map(child => child.value as string);
	};
	const allowed = array('allowedModes'), denied = array('deniedModes') ?? [];
	const available = modes.filter(mode => !denied.includes(mode) && (!allowed || allowed.includes(mode)) && (mode !== 'structure-aware' || capabilities.structure) && (mode !== 'separate-files' || capabilities.files));
	const preferred = document.string(['insert', 'defaultMode']) ?? 'cursor';
	return { available, preferred: available.includes(preferred as InsertMode) ? preferred as InsertMode : undefined };
}
