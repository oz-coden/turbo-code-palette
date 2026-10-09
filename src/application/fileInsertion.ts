import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoLinks, containedPath, pathCollisionKey, validateRelativePath } from '../storage/safePaths';
import { nativeStore } from '../storage/store';
import { readTree } from '../storage/transaction';

export interface FileOutput { readonly parent: string; readonly folder: string; readonly files: ReadonlyMap<string, string> }
export function validateOutput(output: FileOutput): void {
	validateRelativePath(output.folder); if (output.folder.includes('/')) { throw new Error('Choose one new output folder name.'); }
	const names = new Set<string>(), components = new Map<string, string>(); let bytes = 0;
	if (!output.files.size || output.files.size > 10000) { throw new Error('Output file limit.'); }
	for (const [name, text] of output.files) {
		validateRelativePath(name); const key = pathCollisionKey(name);
		const parts = name.split('/'); for (let index = 1; index <= parts.length; index++) { const component = parts.slice(0, index).join('/'), componentKey = pathCollisionKey(component), original = components.get(componentKey); if (original && original !== component) { throw new Error('Ambiguous output path spelling.'); } components.set(componentKey, component); }
		if (names.has(key) || [...names].some(other => other.startsWith(key + '/') || key.startsWith(other + '/'))) { throw new Error('Output source path collision.'); } names.add(key);
		const size = Buffer.byteLength(text); bytes += size; if (size > 16 * 1024 * 1024 || bytes > 128 * 1024 * 1024) { throw new Error('Output byte limit.'); }
	}
	if (components.size > 10000) { throw new Error('Output entry limit.'); }
}
export async function validateDestination(output: FileOutput): Promise<void> {
	validateOutput(output); await assertNoLinks(output.parent);
	if (!(await fs.lstat(output.parent)).isDirectory()) { throw new Error('Output parent must be an existing directory.'); }
	const siblings = await fs.readdir(output.parent); if (siblings.some(name => pathCollisionKey(name) === pathCollisionKey(output.folder))) { throw new Error('Output folder already exists. Existing files are never overwritten.'); }
}
/** Files become visible together through one rename. No file writes occur before the pipeline's apply step. */
export async function applyFiles(output: FileOutput, revalidate: () => Promise<void>, beforeWrite?: (index: number) => Promise<void>): Promise<void> {
	await validateDestination(output);
	const name = '.tcp-insert-' + randomUUID(), staging = containedPath(output.parent, name), target = containedPath(output.parent, output.folder);
	await fs.mkdir(staging, { recursive: false }); let moved = false;
	try {
		let index = 0;
		for (const [relative, text] of output.files) {
			await beforeWrite?.(index++); const filename = containedPath(staging, relative);
			await fs.mkdir(path.dirname(filename), { recursive: true }); await assertNoLinks(path.dirname(filename));
			const handle = await fs.open(filename, 'wx', 0o600); try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
		}
		const tree = await readTree(nativeStore({ scope: 'workspace', path: output.parent }), name);
		const directories = new Set([...output.files.keys()].flatMap(name => name.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'))));
		if (tree.size !== output.files.size || tree.directories.size !== directories.size || [...tree.directories].some(name => !directories.has(name)) || [...output.files].some(([name, text]) => !tree.get(name)?.equals(Buffer.from(text)))) { throw new Error('Staging content changed before publish.'); }
		await revalidate(); await validateDestination(output); await assertNoLinks(staging);
		// As with other native transactions, hostile concurrent directory replacement is outside v1's guarantee.
		await fs.rename(staging, target); moved = true;
	} finally {
		if (!moved) {
			if (path.dirname(staging) !== path.resolve(output.parent) || path.basename(staging) !== name) { throw new Error('Unexpected owned staging location.'); }
			await assertNoLinks(staging); await fs.rm(staging, { recursive: true, force: false });
		}
	}
}
