import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { MetadataDocument } from '../core/metadata/document';
import { validateMetadataChange } from '../core/metadata/changes';
import { sha256 } from '../core/assets/fingerprint';
import type { AssetKind } from '../core/metadata/semantics';
import { assertNoLinks, containedPath, readBoundedFile } from './safePaths';

/** Explicit metadata-only write. This is not the later multi-file asset transaction layer. */
export async function writeMetadata(root: string, relative: string, expectedByteHash: string,
	transform: (document: MetadataDocument) => MetadataDocument, kind: AssetKind): Promise<MetadataDocument> {
	const target = containedPath(root, relative);
	const original = await readBoundedFile(target, 1024 * 1024);
	if (sha256(original) !== expectedByteHash) { throw new Error('Stale metadata target.'); }
	const before = new MetadataDocument(new TextDecoder('utf-8', { fatal: true }).decode(original));
	const after = transform(before);
	validateMetadataChange(before, after, kind);
	const temporary = target + '.' + randomUUID() + '.tmp';
	let created = false;
	try {
		const handle = await fs.open(temporary, 'wx', 0o600); created = true;
		try { await handle.writeFile(after.text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
		await assertNoLinks(target);
		if (sha256(await readBoundedFile(target, 1024 * 1024)) !== expectedByteHash) { throw new Error('Stale metadata target.'); }
		await fs.rename(temporary, target); created = false;
		return after;
	} finally { if (created) { await fs.unlink(temporary); } }
}
