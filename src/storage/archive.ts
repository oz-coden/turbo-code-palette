import * as yauzl from 'yauzl';
import * as yazl from 'yazl';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoLinks, containedPath, pathCollisionKey, readBoundedFile, validateRelativePath } from './safePaths';
import { cloneTree, treeDirectories, type MutableTree, type FileTree } from './transaction';
import { inspectPackTree } from './packValidation';

export const archiveLimits = Object.freeze({ compressed: 64 * 1024 * 1024, total: 128 * 1024 * 1024, file: 16 * 1024 * 1024, metadata: 1024 * 1024, entries: 10000, depth: 64, ratio: 1000, milliseconds: 30000 });
const crcTable = Array.from({ length: 256 }, (_, n) => { let crc = n; for (let bit = 0; bit < 8; bit++) { crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; } return crc >>> 0; });
export function crc32(bytes: Buffer): number { let crc = 0xffffffff; for (const value of bytes) { crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8); } return (crc ^ 0xffffffff) >>> 0; }

/** Validate both explicit entries and their implicit parents, on every host OS. */
export function validateArchiveTree(tree: FileTree): void {
	const names = new Map<string, { name: string; directory: boolean }>();
	const add = (name: string, directory: boolean) => {
		validateRelativePath(name);
		if (name.split('/').length > archiveLimits.depth || name.split('/').some(part => /^(?:\.tcp-staging|\.tcp-transactions|\.tmp)$/i.test(part))) { throw new Error('Private staging/deep paths are not permitted in an archive.'); }
		if (!directory && /^(?:pack|snippet)\.json$/i.test(name.split('/').at(-1)!) && name !== 'pack.json' && !/^[^/]+\/snippet\.json$/.test(name)) { throw new Error('Metadata must use canonical root pack.json / direct-member snippet.json paths.'); }
		const key = pathCollisionKey(name), prior = names.get(key);
		if (prior && (prior.name !== name || prior.directory !== directory || !directory)) { throw new Error('Archive path/case/Unicode collision.'); }
		names.set(key, { name, directory });
		if (names.size > archiveLimits.entries) { throw new Error('Archive entry limit exceeded.'); }
	};
	let total = 0;
	for (const [name, bytes] of tree) {
		add(name, false); total += bytes.length;
		if (bytes.length > (/^(?:.*\/)?(?:pack|snippet)\.json$/.test(name) ? archiveLimits.metadata : archiveLimits.file) || total > archiveLimits.total) { throw new Error('Archive uncompressed size limit exceeded.'); }
	}
	for (const name of treeDirectories(tree)) { add(name, true); }
	for (const name of [...tree.keys(), ...treeDirectories(tree)]) { const parts = name.split('/'); for (let length = 1; length < parts.length; length++) { add(parts.slice(0, length).join('/'), true); } }
	if (!tree.has('pack.json')) { throw new Error('Archive must contain root pack.json.'); }
	for (const name of names.values()) { if (name.directory) { (tree as MutableTree).directories?.add(name.name); } }
}

export async function decodeArchive(bytes: Buffer): Promise<MutableTree> {
	if (bytes.length > archiveLimits.compressed) { throw new Error('Archive compressed size limit exceeded.'); }
	const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true, autoClose: false }, (error, zip) => error ? reject(error) : resolve(zip!)));
	const tree = cloneTree(), explicit = new Set<string>(), deadline = Date.now() + archiveLimits.milliseconds; let count = 0, total = 0;
	try {
		for await (const entry of zip.eachEntry()) {
			if (Date.now() > deadline) { throw new Error('Archive validation time limit exceeded.'); }
			if (++count > archiveLimits.entries) { throw new Error('Archive entry limit exceeded.'); }
			const directory = entry.fileName.endsWith('/'), name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
			validateRelativePath(name); const key = pathCollisionKey(name);
			// Also reject dangerous ASCII syntax in raw names when a Unicode extra field overrides decoding.
			const rawName = entry.fileNameRaw.toString('latin1').replace(/[\u0080-\u00ff]/g, 'x'); validateRelativePath(rawName.endsWith('/') ? rawName.slice(0, -1) : rawName);
			if (explicit.has(key)) { throw new Error('Duplicate/case/Unicode archive entry.'); } explicit.add(key);
			const mode = entry.externalFileAttributes >>> 16, kind = mode & 0xf000, dos = entry.externalFileAttributes & 0xffff;
			if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod) || kind && kind !== (directory ? 0x4000 : 0x8000) || dos & 0x400 || dos & 0x8 || !directory && dos & 0x10 || entry.extraFields.some(field => [0x000d, 0x756e].includes(field.id))) { throw new Error('Encrypted, link/reparse, device or unsupported archive entry.'); }
			const limit = /^(?:.*\/)?(?:pack|snippet)\.json$/.test(name) ? archiveLimits.metadata : archiveLimits.file;
			if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > limit || total + entry.uncompressedSize > archiveLimits.total || directory && entry.uncompressedSize !== 0 || entry.uncompressedSize > archiveLimits.metadata && entry.uncompressedSize / Math.max(1, entry.compressedSize) > archiveLimits.ratio) { throw new Error('Archive uncompressed size/ratio limit exceeded.'); }
			// Local headers may not redirect the central-directory name or compression method.
			const header = await zip.readLocalFileHeaderPromise(entry);
			if (!header.fileName.equals(entry.fileNameRaw) || header.compressionMethod !== entry.compressionMethod || header.generalPurposeBitFlag !== entry.generalPurposeBitFlag) { throw new Error('Inconsistent ZIP local header.'); }
			if (!(entry.generalPurposeBitFlag & 8)) {
				let uncompressed = BigInt(header.uncompressedSize), compressed = BigInt(header.compressedSize);
				if (header.uncompressedSize === 0xffffffff || header.compressedSize === 0xffffffff) {
					let found = false;
					for (let offset = 0; offset + 4 <= header.extraField.length;) { const id = header.extraField.readUInt16LE(offset), size = header.extraField.readUInt16LE(offset + 2); offset += 4; if (offset + size > header.extraField.length) { throw new Error('Malformed ZIP64 local header.'); } if (id === 1) { const needed = (header.uncompressedSize === 0xffffffff ? 8 : 0) + (header.compressedSize === 0xffffffff ? 8 : 0); if (size < needed) { throw new Error('Incomplete ZIP64 local sizes.'); } let cursor = offset; if (header.uncompressedSize === 0xffffffff) { uncompressed = header.extraField.readBigUInt64LE(cursor); cursor += 8; } if (header.compressedSize === 0xffffffff) { compressed = header.extraField.readBigUInt64LE(cursor); } found = true; break; } offset += size; }
					if (!found) { throw new Error('Missing ZIP64 local sizes.'); }
				}
				if (header.crc32 !== entry.crc32 || uncompressed !== BigInt(entry.uncompressedSize) || compressed !== BigInt(entry.compressedSize)) { throw new Error('Inconsistent ZIP local size/CRC declaration.'); }
			}
			const stream = await zip.openReadStreamPromise(entry), chunks: Buffer[] = []; let length = 0;
			const timeout = setTimeout(() => stream.destroy(new Error('Archive validation time limit exceeded.')), Math.max(1, deadline - Date.now()));
			try { for await (const chunk of stream) { const data = Buffer.from(chunk); length += data.length; if (length > entry.uncompressedSize || length > limit || total + length > archiveLimits.total) { stream.destroy(); throw new Error('Archive actual size limit exceeded.'); } chunks.push(data); } } finally { clearTimeout(timeout); }
			const content = Buffer.concat(chunks, length);
			if (length !== entry.uncompressedSize || crc32(content) !== entry.crc32) { throw new Error('Archive size/CRC mismatch.'); } total += length;
			if (directory) { tree.directories.add(name); } else { tree.set(name, content); }
		}
		validateArchiveTree(tree);
		await inspectPackTree(tree, { scope: 'global', path: 'staged-archive' }, true, true);
		return tree;
	} finally { zip.close(); }
}

export async function encodeArchive(tree: FileTree): Promise<Buffer> {
	const checked = cloneTree(tree); validateArchiveTree(checked); await inspectPackTree(checked, { scope: 'global', path: 'staged-archive' }, true, true);
	const zip = new yazl.ZipFile(), chunks: Buffer[] = []; let length = 0;
	const collected = new Promise<Buffer>((resolve, reject) => {
		zip.on('error', reject); zip.outputStream.on('error', reject);
		zip.outputStream.on('data', (chunk: Buffer) => { length += chunk.length; if (length > archiveLimits.compressed) { reject(new Error('Export compressed size limit exceeded.')); (zip.outputStream as import('node:stream').Readable).destroy(); } else { chunks.push(chunk); } });
		zip.outputStream.on('end', () => resolve(Buffer.concat(chunks, length)));
	});
	const options = { mtime: new Date('2000-01-01T00:00:00Z'), mode: 0o100644, compress: true };
	for (const name of [...checked.directories].sort()) { zip.addEmptyDirectory(name, { mtime: options.mtime, mode: 0o40755 }); }
	for (const [name, content] of [...checked].sort(([a], [b]) => a.localeCompare(b, 'en'))) { zip.addBuffer(content, name, options); }
	zip.end(); return collected;
}

/** Exclusive destination publish: never replace an existing archive, including races. */
export async function publishArchive(destination: string, bytes: Buffer, revalidate: () => Promise<void> = async () => {}): Promise<void> {
	const parent = path.dirname(destination), name = path.basename(destination); validateRelativePath(name); await assertNoLinks(parent);
	if (!name.toLowerCase().endsWith('.tcp-sp')) { throw new Error('Export filename must end in .tcp-sp.'); }
	const temporary = containedPath(parent, '.tcp-export-' + randomUUID() + '.tmp');
	const handle = await fs.open(temporary, 'wx'); let published = false;
	try {
		await handle.writeFile(bytes); await handle.sync(); await handle.close();
		if (!(await readBoundedFile(temporary, archiveLimits.compressed)).equals(bytes)) { throw new Error('Temporary archive verification failed.'); }
		await revalidate(); await assertNoLinks(parent);
		// Hard-link creation has exclusive/no-overwrite semantics on native filesystems;
		// unlike rename(), it cannot silently clobber a competing destination on POSIX.
		await fs.link(temporary, destination); published = true;
	} finally { await handle.close().catch(() => {}); await fs.unlink(temporary); }
	if (published) { await assertNoLinks(destination); }
}
