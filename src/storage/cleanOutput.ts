import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoLinks, containedPath, pathCollisionKey, readBoundedFile, validateRelativePath } from './safePaths';

const limit = 32 * 1024 * 1024;
export interface CleanOutputProtection { readonly sourceFiles: readonly string[]; readonly libraryRoots: readonly string[] }
function contains(root: string, destination: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(destination)); return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
export async function validateCleanDestination(destination: string, protection: CleanOutputProtection): Promise<void> {
	const resolved = path.resolve(destination), parent = path.dirname(resolved), name = path.basename(resolved); validateRelativePath(name); await assertNoLinks(parent);
	// All platforms use the stricter case/NFC spelling rule as an extra guard.
	if (protection.sourceFiles.some(source => pathCollisionKey(path.resolve(source)) === pathCollisionKey(resolved)) || protection.libraryRoots.some(root => contains(root, resolved) || contains(pathCollisionKey(root), pathCollisionKey(resolved)))) { throw new Error('Clean Copy cannot save over source URI or inside a library root.'); }
	if ((await fs.readdir(parent)).some(sibling => pathCollisionKey(sibling) === pathCollisionKey(name))) { throw new Error('Clean Copy Save As requires a new filename. Existing files, links and aliases are never overwritten.'); }
}
/** Single exclusive publish; no resource writes until the user explicitly chooses Save As. */
export async function publishCleanOutput(destination: string, text: string, protection: CleanOutputProtection, revalidate: () => Promise<void>, hooks?: { beforeWrite?(): Promise<void>; beforePublish?(): Promise<void>; assertCurrent?(): void }): Promise<{ cleanupWarning?: string }> {
	const bytes = Buffer.from(text); if (bytes.length > limit) { throw new Error('Clean Copy output limit exceeded.'); }
	await revalidate(); await validateCleanDestination(destination, protection);
	const parent = path.dirname(path.resolve(destination)), name = '.tcp-clean-' + randomUUID() + '.tmp', temporary = containedPath(parent, name);
	let created = false, published = false, warning: string | undefined;
	try {
		const handle = await fs.open(temporary, 'wx', 0o600); created = true;
		try { await hooks?.beforeWrite?.(); await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
		if (!(await readBoundedFile(temporary, limit)).equals(bytes)) { throw new Error('Clean Copy temporary output changed.'); }
		await hooks?.beforePublish?.(); await revalidate(); await validateCleanDestination(destination, protection);
		await assertNoLinks(temporary); hooks?.assertCurrent?.();
		await fs.link(temporary, destination); published = true;
	} finally {
		if (created) {
			if (path.dirname(temporary) !== parent || path.basename(temporary) !== name) { throw new Error('Unexpected Clean Copy temporary location.'); }
			try { await fs.unlink(temporary); } catch (error) { if (!published) { throw error; } warning = 'Output was saved, but owned temporary cleanup failed. Do not retry over the saved file.'; }
		}
	}
	return warning ? { cleanupWarning: warning } : {};
}
