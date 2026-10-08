import type { CatalogSnapshot } from '../storage/discovery';
import { locationKey } from './library';
export function snapshotStamp(snapshot: CatalogSnapshot | undefined): string {
	return JSON.stringify({ assets: [...(snapshot?.packs ?? [])].map(asset => [locationKey(asset), asset.files.map(file => [file.path, file.hash]).sort(), asset.directories]).sort(), diagnostics: snapshot?.diagnostics ?? [] });
}
/** A watcher compares disk bytes to the loaded snapshot; it never adopts disk contents. */
export class ChangeTracker {
	pending = false;
	private notified = false;
	private timer?: ReturnType<typeof setTimeout>;
	private running = false;
	private again = false;
	constructor(private readonly expected: () => CatalogSnapshot | undefined, private readonly read: () => Promise<CatalogSnapshot>,
		private readonly notify: () => Promise<void>, private readonly badge: (pending: boolean) => void) {}
	event(): void { clearTimeout(this.timer); this.timer = setTimeout(() => { void this.check().catch(() => this.changed()); }, 500); }
	async changed(): Promise<void> { this.pending = true; this.badge(true); if (!this.notified) { this.notified = true; void this.notify().catch(() => {}); } }
	async check(): Promise<void> {
		if (this.running) { this.again = true; return; } this.running = true;
		try {
			if (snapshotStamp(await this.read()) !== snapshotStamp(this.expected())) {
				await this.changed();
			}
		} finally { this.running = false; if (this.again) { this.again = false; this.event(); } }
	}
	reloaded(): void { this.pending = false; this.notified = false; this.badge(false); }
	dispose(): void { clearTimeout(this.timer); }
}
