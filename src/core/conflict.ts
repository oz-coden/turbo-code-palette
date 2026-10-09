import type { AssetLocation } from '../storage/discovery';

/** Comparison evidence only. Never authorizes replacement or semantic equivalence. */
export class ConflictError extends Error {
	constructor(message: string, readonly evidence: {
		incoming?: AssetLocation; existing?: readonly AssetLocation[];
		currentText?: string; requestedText?: string;
	} = {}) { super(message); this.name = 'ConflictError'; }
}
