export interface StateStorage { get<T>(key: string, fallback: T): T; update(key: string, value: unknown): PromiseLike<void> }
interface Entry { favorite: boolean; recent: number; usage: number }
export class UserState {
	private readonly entries: Record<string, Entry>;
	constructor(private readonly storage: StateStorage) { this.entries = storage.get<Record<string, Entry>>('tcp.userState.v1', {}); }
	get(key: string): Readonly<Entry> { return this.entries[key] ?? { favorite: false, recent: 0, usage: 0 }; }
	private async save(key: string, changes: Partial<Entry>): Promise<void> {
		this.entries[key] = { ...this.get(key), ...changes };
		const ordered = Object.entries(this.entries).sort((a, b) => b[1].recent - a[1].recent);
		for (const [oldKey, value] of ordered.slice(2000)) { if (!value.favorite) { delete this.entries[oldKey]; } }
		await this.storage.update('tcp.userState.v1', this.entries);
	}
	async toggle(key: string): Promise<void> { await this.save(key, { favorite: !this.get(key).favorite }); }
	async touch(key: string): Promise<void> { await this.save(key, { recent: Date.now() }); }
	/** Only the completed Phase 3 pipeline may call this after a successful edit. */
	async inserted(key: string): Promise<void> { await this.save(key, { recent: Date.now(), usage: this.get(key).usage + 1 }); }
}
