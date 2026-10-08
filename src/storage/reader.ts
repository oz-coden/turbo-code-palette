import * as fs from 'node:fs/promises';
import { assertNoLinks, containedPath, readBoundedFile } from './safePaths';
import type { StorageRoot } from './roots';

export interface LibraryEntry { readonly name: string; readonly directory: boolean }
export interface LibraryReader {
	/** False if the provider cannot verify physical link identity. Inspection only. */
	readonly verifiedFileIdentity: boolean;
	list(relativeDirectory: string): Promise<readonly LibraryEntry[]>;
	read(relativeFile: string, limit: number): Promise<Buffer>;
}
export type ReaderFactory = (root: StorageRoot) => LibraryReader;
export const nativeReader: ReaderFactory = root => {
	if (root.uri) { throw new Error('URI storage requires a public filesystem provider adapter.'); }
	const resolve = (relative: string) => relative ? containedPath(root.path, relative) : root.path;
	return {
		verifiedFileIdentity: true,
		async list(relative) {
			const absolute = resolve(relative); await assertNoLinks(absolute);
			return (await fs.readdir(absolute, { withFileTypes: true })).map(entry => ({ name: entry.name, directory: entry.isDirectory() }));
		},
		read: (relative, limit) => readBoundedFile(resolve(relative), limit),
	};
};
