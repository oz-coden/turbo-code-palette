import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export function validateRelativePath(value: string): string {
	if (!value || value.length > 240 || /[\\:\p{Cc}<>"|?*]/u.test(value) || value.startsWith('/')) { throw new Error('Unsafe relative asset path.'); }
	for (const component of value.split('/')) {
		if (!component || component === '.' || component === '..' || /[. ]$/.test(component)
			|| /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(component)
			|| component.toLowerCase() === '.git') { throw new Error('Unsafe asset path component.'); }
	}
	return value;
}

export function pathCollisionKey(value: string): string { return value.normalize('NFC').toUpperCase().normalize('NFC'); }

export function containedPath(root: string, relative: string): string {
	validateRelativePath(relative);
	const result = path.resolve(root, ...relative.split('/'));
	const check = path.relative(path.resolve(root), result);
	if (!check || check.startsWith('..' + path.sep) || check === '..' || path.isAbsolute(check)) { throw new Error('Asset path escapes its root.'); }
	return result;
}

/** Refuse links/junctions in every ancestor; realpath equality alone misses internal links. */
export async function assertNoLinks(absolute: string): Promise<void> {
	const resolved = path.resolve(absolute);
	const parsed = path.parse(resolved);
	let current = parsed.root;
	for (const component of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
		current = path.join(current, component);
		const stat = await fs.lstat(current);
		if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink > 1)) {
			throw new Error('Links or nonregular filesystem entries are not supported in assets.');
		}
	}
}

export async function readBoundedFile(absolute: string, limit: number): Promise<Buffer> {
	await assertNoLinks(absolute);
	const handle = await fs.open(absolute, 'r');
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.nlink > 1 || stat.size > limit) { throw new Error('File type or size limit exceeded.'); }
		const buffer = Buffer.alloc(stat.size + 1);
		let length = 0;
		while (length < buffer.length) {
			const result = await handle.read(buffer, length, buffer.length - length, null);
			if (!result.bytesRead) { break; }
			length += result.bytesRead;
		}
		const after = await handle.stat();
		if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) { throw new Error('File changed while reading.'); }
		await assertNoLinks(absolute);
		return buffer.subarray(0, length);
	} finally { await handle.close(); }
}
