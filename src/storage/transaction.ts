import { randomUUID } from 'node:crypto';
import { sha256 } from '../core/assets/fingerprint';
import { pathCollisionKey, validateRelativePath } from './safePaths';
import type { LibraryStore } from './store';

export type FileTree = ReadonlyMap<string, Buffer> & { readonly directories?: ReadonlySet<string> };
export type MutableTree = Map<string, Buffer> & { directories: Set<string> };
export function cloneTree(tree?: FileTree): MutableTree { return Object.assign(new Map(tree), { directories: new Set(tree?.directories ?? []) }); }
export function treeDirectories(tree: FileTree): string[] {
	const directories = new Set(tree.directories ?? []);
	for (const file of [...tree.keys(), ...(tree.directories ?? [])]) { const parts = file.split('/'); parts.pop(); while (parts.length) { directories.add(parts.join('/')); parts.pop(); } }
	return [...directories].sort();
}
export function byteFingerprint(tree: FileTree): string {
	return sha256(JSON.stringify({ files: [...tree].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, bytes]) => [name, sha256(bytes)]), directories: treeDirectories(tree) }));
}
export async function readTree(store: LibraryStore, directory: string): Promise<MutableTree> {
	const files = cloneTree(), keys = new Set<string>(); let total = 0, count = 0;
	const walk = async (prefix: string, depth: number): Promise<void> => {
		if (depth > 64) { throw new Error('Tree depth limit.'); }
		for (const entry of await store.list(directory + (prefix ? '/' + prefix.slice(0, -1) : ''))) {
			const relative = validateRelativePath(prefix + entry.name), key = pathCollisionKey(relative);
			if (++count > 10000 || keys.has(key)) { throw new Error('Entry limit or path collision.'); } keys.add(key);
			if (entry.directory) { files.directories.add(relative); await walk(relative + '/', depth + 1); }
			else {
				const bytes = await store.read(directory + '/' + relative, /(?:^|\/)(?:pack|snippet)\.json$/.test(relative) ? 1024 * 1024 : 16 * 1024 * 1024);
				total += bytes.length; if (total > 128 * 1024 * 1024) { throw new Error('Pack size limit.'); } files.set(relative, bytes);
			}
		}
	};
	await walk('', 0); return files;
}
function validateTree(tree: FileTree): void {
	const keys = new Set<string>(); let bytes = 0;
	if (tree.size > 10000) { throw new Error('Entry limit.'); }
	for (const [name, data] of tree) {
		validateRelativePath(name); const key = pathCollisionKey(name);
		if (keys.has(key) || name.split('/').length > 64 || data.length > (/json$/.test(name) && /(?:pack|snippet)\.json$/.test(name) ? 1024 * 1024 : 16 * 1024 * 1024)) { throw new Error('Unsafe or oversized tree.'); }
		keys.add(key); bytes += data.length;
		if (bytes > 128 * 1024 * 1024) { throw new Error('Pack size limit.'); }
	}
	for (const key of keys) { const parts = key.split('/'); parts.pop(); while (parts.length) { if (keys.has(parts.join('/'))) { throw new Error('File/directory collision.'); } parts.pop(); } }
	for (const directory of treeDirectories(tree)) { validateRelativePath(directory); const key = pathCollisionKey(directory); if (keys.has(key) || directory.split('/').length > 64) { throw new Error('Directory collision or depth limit.'); } keys.add(key); }
	if (keys.size > 10000) { throw new Error('Tree entry limit.'); }
}

export interface TransactionGuard { (transactionId?: string): Promise<void> }
/** One Pack commit, with durable relative-path journal and recoverable backup. Never overwrite unreviewed targets. */
export async function commitTree(store: LibraryStore, target: string, expected: string | undefined, tree: FileTree | undefined,
	guard: TransactionGuard = async () => {}, validate: (tree: FileTree) => Promise<void> = async () => {}): Promise<void> {
	validateRelativePath(target); if (target.includes('/')) { throw new Error('A transaction targets one direct Pack folder.'); }
	if (tree) { validateTree(tree); await validate(tree); }
	await guard();
	const check = async () => {
		const exists = await store.exists(target);
		if (expected === undefined ? exists : !exists || byteFingerprint(await readTree(store, target)) !== expected) { throw new Error('The destination changed. Reload before applying.'); }
	};
	await check();
	const id = randomUUID(), base = `.tcp-staging/${id}`, stage = `${base}/new`, backup = `${base}/old`, journal = `.tcp-transactions/${id}`;
	let backedUp = false, installed = false, journalCreated = false;
	await store.mkdir('.tcp-staging'); await store.mkdir(base, true);
	try {
		if (tree) {
			await store.mkdir(stage);
			for (const directory of treeDirectories(tree)) { await store.mkdir(stage + '/' + directory); }
			for (const [name, bytes] of tree) {
				const slash = name.lastIndexOf('/'); if (slash >= 0) { await store.mkdir(stage + '/' + name.slice(0, slash)); }
				await store.writeNew(stage + '/' + name, bytes);
			}
			if (byteFingerprint(await readTree(store, stage)) !== byteFingerprint(tree)) { throw new Error('Staging verification failed.'); }
		}
		await store.mkdir('.tcp-transactions');
		await store.writeNew(journal, Buffer.from(JSON.stringify({ id, target, base, expected, replacement: tree ? byteFingerprint(tree) : null }), 'utf8')); journalCreated = true;
		await guard(id); await check();
		if (expected !== undefined) {
			await store.rename(target, backup); backedUp = true;
			if (byteFingerprint(await readTree(store, backup)) !== expected) { throw new Error('Destination changed during commit.'); }
		}
		if (tree) { await store.rename(stage, target); installed = true; if (byteFingerprint(await readTree(store, target)) !== byteFingerprint(tree)) { throw new Error('Installed files changed; recovery data retained.'); } }
	} catch (error) {
		if (backedUp && !installed && !(await store.exists(target))) {
			await store.rename(backup, target); backedUp = false;
		}
		if (!backedUp && !installed) {
			await store.remove(base); if (journalCreated) { await store.remove(journal); }
		}
		throw error;
	}
	// Preserve changed backups or failed cleanup for recovery, rather than deleting another writer's data.
	if (backedUp && byteFingerprint(await readTree(store, backup)) !== expected) { throw new Error('Committed with a changed backup retained for recovery.'); }
	try { await store.remove(base); if (journalCreated) { await store.remove(journal); } }
	catch (error) { throw new Error('Saved files are installed, but recovery cleanup failed. Review Interrupted Save before retrying.', { cause: error }); }
}
