import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { assertNoLinks, containedPath, readBoundedFile } from './safePaths';
import { nativeReader, type LibraryReader } from './reader';
import type { StorageRoot } from './roots';

export interface LibraryStore extends LibraryReader {
	exists(relative: string): Promise<boolean>;
	mkdir(relative: string, exclusive?: boolean): Promise<void>;
	writeNew(relative: string, bytes: Uint8Array): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	remove(relative: string): Promise<void>;
}
export type StoreFactory = (root: StorageRoot) => LibraryStore;
export const nativeStore: StoreFactory = root => {
	const reader = nativeReader(root);
	const resolve = (relative: string) => relative ? containedPath(root.path, relative) : path.resolve(root.path);
	const existingParent = async (absolute: string) => {
		let current = absolute;
		for (;;) {
			try { await assertNoLinks(current); return; }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
			const parent = path.dirname(current); if (parent === current) { throw new Error('Missing filesystem root.'); } current = parent;
		}
	};
	return {
		...reader,
		async exists(relative) {
			try { await assertNoLinks(resolve(relative)); return true; }
			catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return false; } throw error; }
		},
		async mkdir(relative, exclusive = false) { const target = resolve(relative); await existingParent(target); await fs.mkdir(target, { recursive: !exclusive }); await assertNoLinks(target); },
		async writeNew(relative, bytes) {
			const target = resolve(relative); await assertNoLinks(path.dirname(target));
			const handle = await fs.open(target, 'wx', 0o600);
			try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
		},
		async rename(from, to) {
			await assertNoLinks(resolve(from)); await assertNoLinks(path.dirname(resolve(to)));
			if (await this.exists(to)) { throw new Error('Destination already exists.'); }
			await fs.rename(resolve(from), resolve(to)); await assertNoLinks(resolve(to));
		},
		async remove(relative) {
			// Application code may remove only its private transaction objects.
			if (!/^\.tcp-(staging|transactions)\/[a-f\d-]+(?:\/.*)?$/i.test(relative)) { throw new Error('Refusing removal outside owned transaction storage.'); }
			const target = resolve(relative); await assertNoLinks(target);
			await fs.rm(target, { recursive: true, force: false });
		},
		read: (relative, limit) => readBoundedFile(resolve(relative), limit),
	};
};
