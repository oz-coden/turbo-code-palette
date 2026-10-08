import { compareVersions } from '../version/parser';
import { MetadataDocument } from './document';
import { readMetadata, type AssetKind } from './semantics';

/** Format-only upgrades preserve asset revision. All semantic edits require a newer revision. */
export function validateMetadataChange(before: MetadataDocument, after: MetadataDocument, kind: AssetKind): void {
	const previous = readMetadata(before, kind), next = readMetadata(after, kind);
	if (!previous.valid || !next.canEdit || !['legacy', 'current'].includes(before.format)) { throw new Error('Unsupported metadata change.'); }
	if (previous.id !== next.id) { throw new Error('A fork requires a separate asset creation transaction.'); }
	const comparableAfter = after.patchKnown(['version'], previous.version!.text);
	const changed = before.canonical(true) !== comparableAfter.canonical(true);
	const order = compareVersions(next.version!, previous.version!);
	if (order < 0 || (changed && order <= 0)) { throw new Error('Semantic changes require a newer asset version.'); }
}
