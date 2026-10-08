import { createHash } from 'node:crypto';
import type { MetadataDocument } from '../metadata/document';

export const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export interface FingerprintFile { readonly path: string; readonly hash: string; readonly metadata?: MetadataDocument }

/** Framed records avoid path/content delimiter ambiguity; source bytes and array order remain significant. */
export function treeFingerprint(files: readonly FingerprintFile[], semantic: boolean): string | undefined {
	if (semantic && files.some(file => file.metadata && ['future', 'invalid'].includes(file.metadata.format))) { return undefined; }
	const records = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(file =>
		[file.path, file.metadata ? sha256(file.metadata.canonical(semantic)) : file.hash]);
	return sha256(JSON.stringify(records));
}
