import type { LibraryStore } from './store';
import { byteFingerprint, readTree } from './transaction';
import { validateRelativePath } from './safePaths';

export interface RecoveryRecord { readonly id: string; readonly target: string; readonly base: string; readonly expected?: string; readonly replacement: string | null }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
export async function pendingRecovery(store: LibraryStore): Promise<RecoveryRecord[]> {
	if (!await store.exists('.tcp-transactions')) { return []; }
	const entries = await store.list('.tcp-transactions'); if (entries.length > 1000) { throw new Error('Recovery entry limit.'); }
	const records: RecoveryRecord[] = [];
	for (const entry of entries) {
		if (entry.directory || !uuid.test(entry.name)) { throw new Error('Unrecognized recovery data; inspect the library folder.'); }
		const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await store.read('.tcp-transactions/' + entry.name, 4096))) as RecoveryRecord;
		if (data.id !== entry.name || data.base !== '.tcp-staging/' + entry.name || typeof data.target !== 'string' || data.target.includes('/') || data.target.startsWith('.') ||
			data.expected !== undefined && !hash.test(data.expected) || data.replacement !== null && !hash.test(data.replacement)) { throw new Error('Invalid recovery record; inspect the library folder.'); }
		validateRelativePath(data.target); records.push(data);
	}
	return records;
}
/** Explicit recovery only. Never replace a target or discard a backup with unknown contents. */
export async function recover(store: LibraryStore, record: RecoveryRecord, choice: 'restore' | 'keep'): Promise<void> {
	const loaded = (await pendingRecovery(store)).find(item => item.id === record.id);
	if (!loaded || JSON.stringify(loaded) !== JSON.stringify(record)) { throw new Error('Recovery record changed.'); }
	const backup = record.base + '/old', stage = record.base + '/new';
	const current = await store.exists(record.target) ? byteFingerprint(await readTree(store, record.target)) : null;
	const old = await store.exists(backup) ? byteFingerprint(await readTree(store, backup)) : undefined;
	if (old !== undefined && old !== record.expected) { throw new Error('Backup has external changes. Inspect it manually.'); }
	if (await store.exists(stage) && byteFingerprint(await readTree(store, stage)) !== record.replacement) { throw new Error('Staged data has external changes. Inspect it manually.'); }
	if (choice === 'keep') {
		if (current !== record.replacement) { throw new Error('Replacement is not intact; cannot discard recovery data.'); }
	} else {
		if (current !== null && current !== record.expected) { throw new Error('A target exists. Inspect it before restoring; it will not be overwritten.'); }
		if (current === null && record.expected) { if (!old) { throw new Error('Backup is missing.'); } await store.rename(backup, record.target); }
	}
	if (await store.exists(record.base)) { await store.remove(record.base); } await store.remove('.tcp-transactions/' + record.id);
}
