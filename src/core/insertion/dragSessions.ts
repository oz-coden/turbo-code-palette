import type { DemoSnippet } from './plan';

export const DRAG_SCHEME = 'tcp-snippet';
export const URI_LIST_MIME = 'text/uri-list';

/** Only references issued by this extension instance can resolve to code. */
export class DragSessions {
	private readonly sessions = new Map<string, { snippet: DemoSnippet; expiresAt: number }>();

	constructor(
		private readonly createId: () => string,
		private readonly now: () => number = Date.now,
		private readonly lifetimeMs = 120_000,
		private readonly limit = 128,
	) {}

	issue(snippet: DemoSnippet): string {
		this.prune();
		while (this.sessions.size >= this.limit) {
			this.sessions.delete(this.sessions.keys().next().value!);
		}
		const id = this.createId();
		if (!/^[a-zA-Z0-9-]{1,64}$/.test(id)) {
			throw new Error('Invalid drag session identifier.');
		}
		const uri = `${DRAG_SCHEME}://drag/${id}`;
		this.sessions.set(uri, { snippet: Object.freeze({ ...snippet }), expiresAt: this.now() + this.lifetimeMs });
		return uri;
	}

	resolve(uri: string): DemoSnippet | undefined {
		this.prune();
		return this.sessions.get(uri)?.snippet;
	}

	resolveTransfer(value: string): DemoSnippet | undefined {
		if (value.length > 4096) {
			return undefined;
		}
		const uris = value.split(/\r?\n/).filter(line => line && !line.startsWith('#'));
		// Multi-item D&D is intentionally unsupported, even with mixed unrelated URIs.
		return uris.length === 1 ? this.resolve(uris[0]) : undefined;
	}

	clear(): void {
		this.sessions.clear();
	}

	private prune(): void {
		const now = this.now();
		for (const [uri, entry] of this.sessions) {
			if (entry.expiresAt <= now) {
				this.sessions.delete(uri);
			}
		}
	}
}
