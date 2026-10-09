import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Library } from '../../application/library';
import { PackImportSession, exportPack, forkPackTree } from '../../application/packArchive';
import { archiveLimits, crc32, decodeArchive, encodeArchive, publishArchive, validateArchiveTree } from '../../storage/archive';
import { byteFingerprint, cloneTree, readTree, type MutableTree } from '../../storage/transaction';
import { nativeStore } from '../../storage/store';
import { inspectPackTree } from '../../storage/packValidation';
import { ConflictError } from '../../core/conflict';
import { pendingRecovery, recover } from '../../storage/recovery';
import { markSource, markerEvidence } from '../../language/sourceMarker';

const uuid = (n: number) => '40000000-0000-0000-0000-' + String(n).padStart(12, '0');
function tree(code = 'int Value = 1;', version = 'v1.0.0'): MutableTree {
	const result = cloneTree(new Map([
		['pack.json', Buffer.from(`{"formatVersion":1,"id":"${uuid(0)}","name":"Pack","version":"${version}","unknown":{"huge":1e999}}`)],
		['Member/snippet.json', Buffer.from(`{"formatVersion":1,"id":"${uuid(1)}","name":"Member","version":"${version}","sources":["code.cs"],"future":123456789012345678901234567890}`)],
		['Member/code.cs', Buffer.from(code)], ['README.md', Buffer.from('Asset documentation')],
	])); result.directories.add('Empty'); return result;
}
interface Entry { name: string; bytes?: Buffer; mode?: number; attributes?: number; method?: number; flag?: number; size?: number; crc?: number; localName?: string; extra?: Buffer }
/** Handcrafted hostile ZIPs avoid the writer's safety checks. */
function zip(entries: Entry[]): Buffer {
	const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
	for (const entry of entries) {
		const name = Buffer.from(entry.name), localName = Buffer.from(entry.localName ?? entry.name), data = entry.bytes ?? Buffer.alloc(0), extra = entry.extra ?? Buffer.alloc(0), crc = entry.crc ?? crc32(data), local = Buffer.alloc(30), directory = Buffer.alloc(46);
		local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(entry.flag ?? 0x800, 6); local.writeUInt16LE(entry.method ?? 0, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(entry.size ?? data.length, 22); local.writeUInt16LE(localName.length, 26); local.writeUInt16LE(extra.length, 28);
		directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x31e, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(entry.flag ?? 0x800, 8); directory.writeUInt16LE(entry.method ?? 0, 10); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(entry.size ?? data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt16LE(extra.length, 30); directory.writeUInt32LE(((entry.mode ?? 0x81a4) * 65536 + (entry.attributes ?? 0)) >>> 0, 38); directory.writeUInt32LE(offset, 42);
		locals.push(local, localName, extra, data); central.push(directory, name, extra); offset += local.length + localName.length + extra.length + data.length;
	}
	const end = Buffer.alloc(22), centralBytes = Buffer.concat(central); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...locals, centralBytes, end]);
}
const entries = (source = tree()) => [...source].map(([name, bytes]) => ({ name, bytes }));
async function sandbox(run: (base: string) => Promise<void>): Promise<void> {
	const parent = path.resolve('.vscode-test/phase4-unit'); await fs.mkdir(parent, { recursive: true }); const base = await fs.mkdtemp(path.join(parent, 'case-'));
	try { await run(base); } finally { assert.equal(path.dirname(base), parent); await fs.rm(base, { recursive: true, force: true }); }
}
async function archiveFile(base: string, source = tree(), name = 'incoming.tcp-sp'): Promise<string> { const file = path.join(base, name); await fs.writeFile(file, await encodeArchive(source)); return file; }

test('ordinary ZIP roundtrip preserves exact source/unknown JSON/reference bytes and empty directories', async () => {
	const source = tree(), archive = await encodeArchive(source); assert.equal(archive.readUInt32LE(0), 0x04034b50); assert.equal(byteFingerprint(await decodeArchive(archive)), byteFingerprint(source)); assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});
for (const name of ['../escape', '/absolute', 'C:' + '/absolute', 'C:relative', '\\server\\share', 'a\\b', 'a:stream', 'NUL.txt', 'COM¹.cs', 'a./b', 'a /b', 'a//b', './a', 'a/../b', 'a\u0000b', '.git/config', '.tcp-staging/data']) {
	test('archive refuses unsafe path ' + JSON.stringify(name), async () => { await assert.rejects(decodeArchive(zip([...entries(), { name }])), /unsafe|invalid|path|relative|staging/i); });
}
test('duplicate/case/NFC/file-parent collisions and directory aliases are rejected on every OS', async () => {
	for (const names of [['a', 'a'], ['a', 'A'], ['é', 'e\u0301'], ['a', 'a/file'], ['a/file', 'A/other']]) { await assert.rejects(decodeArchive(zip([...entries(), ...names.map(name => ({ name }))])), /collision|Duplicate/); }
	await assert.rejects(decodeArchive(zip([...entries(), { name: 'a/', mode: 0x41ed }, { name: 'a/', mode: 0x41ed }])), /Duplicate/);
});
test('link/reparse/device/encryption/method/Unix-link-extra attributes fail closed', async () => {
	for (const attributes of [{ mode: 0xa1ff }, { mode: 0x21ff }, { attributes: 0x400 }, { attributes: 0x8 }, { attributes: 0x10 }, { flag: 0x801 }, { method: 99 }, { extra: Buffer.from([0x0d, 0, 0, 0]) }, { extra: Buffer.from([0x6e, 0x75, 0, 0]) }]) { await assert.rejects(decodeArchive(zip([...entries(), { name: 'link', ...attributes }]))); }
});
test('CRC corruption, forged size, inconsistent local filename, truncated ZIP and missing root fail before staging', async () => {
	for (const altered of [{ crc: 123 }, { size: archiveLimits.file + 1 }, { localName: 'evil' }]) { await assert.rejects(decodeArchive(zip([...entries(), { name: 'data', bytes: Buffer.from('text'), ...altered }]))); }
	await assert.rejects(decodeArchive(zip(entries()).subarray(0, 50))); await assert.rejects(decodeArchive(zip([{ name: 'Member/code.cs' }])));
});
test('entry, file, metadata, total, depth and compression-ratio budgets are enforced', async () => {
	await assert.rejects(decodeArchive(zip([...entries(), ...Array.from({ length: 10001 }, (_, n) => ({ name: 'data-' + n }))])), /entry limit/);
	await assert.rejects(decodeArchive(zip([...entries(), { name: 'data', method: 8, size: 2 * 1024 * 1024, bytes: Buffer.from('x') }])), /ratio/);
	for (const [name, length] of [['Member/snippet.json', archiveLimits.metadata + 1], ['data', archiveLimits.file + 1]] as const) { assert.throws(() => validateArchiveTree(cloneTree(new Map([['pack.json', Buffer.alloc(0)], [name, Buffer.alloc(length)]]))), /size limit/); }
	const tooLarge = tree(); for (let n = 0; n < 9; n++) { tooLarge.set('data-' + n, Buffer.alloc(archiveLimits.file)); } assert.throws(() => validateArchiveTree(tooLarge), /size limit/);
	const tooDeep = tree(); tooDeep.set('a/'.repeat(65) + 'f', Buffer.alloc(0)); assert.throws(() => validateArchiveTree(tooDeep), /deep/);
});
test('malformed/duplicate-key/future metadata, duplicate UUID, missing source and broken closure are rejected', async () => {
	for (const bad of ['{', tree().get('pack.json')!.toString().replace('"name":"Pack"', '"name":"Pack","name":"Other"'), tree().get('pack.json')!.toString().replace('"formatVersion":1', '"formatVersion":99')]) { const source = tree(); source.set('pack.json', Buffer.from(bad)); await assert.rejects(decodeArchive(zip(entries(source)))); }
	const duplicate = tree(); duplicate.set('Other/snippet.json', duplicate.get('Member/snippet.json')!); duplicate.set('Other/code.cs', Buffer.from('Other')); await assert.rejects(decodeArchive(zip(entries(duplicate))), /validation|Duplicate/);
	const missing = tree(); missing.delete('Member/code.cs'); await assert.rejects(decodeArchive(zip(entries(missing))), /validation/);
	const dependency = tree(); dependency.set('Member/snippet.json', Buffer.from(dependency.get('Member/snippet.json')!.toString().replace('"sources"', `"dependencies":[{"id":"${uuid(2)}","name":"Missing"}],"sources"`))); await assert.rejects(decodeArchive(zip(entries(dependency))), /dependency|closure/i);
	const nested = tree(); nested.set('Nested/deep/snippet.json', Buffer.from('{')); await assert.rejects(decodeArchive(zip(entries(nested))), /canonical/);
});
test('explicit Fork remaps UUID/dependency identity, preserves versions and lossless unknown tokens', async () => {
	const source = tree(); source.set('Dep/snippet.json', Buffer.from(`{"formatVersion":1,"id":"${uuid(2)}","name":"Dep","version":"v1.0.0","sources":["code.cs"]}`)); source.set('Dep/code.cs', Buffer.from('DEPENDENCY'));
	source.set('Member/snippet.json', Buffer.from(source.get('Member/snippet.json')!.toString().replace('"sources"', `"dependencies":[{"id":"${uuid(2)}","name":"Dep","extra":1e999}],"sources"`)));
	const forked = forkPackTree(source), snapshot = await inspectPackTree(forked, { scope: 'global', path: 'test-library' }, true, true);
	assert.ok(snapshot.snippets.every(asset => ![uuid(1), uuid(2)].includes(asset.metadata.id!))); assert.ok(forked.get('Member/snippet.json')!.includes('123456789012345678901234567890')); assert.ok(forked.get('Member/snippet.json')!.includes('1e999')); assert.equal(snapshot.snippets.find(asset => asset.metadata.name === 'Member')!.metadata.dependencies[0].id, snapshot.snippets.find(asset => asset.metadata.name === 'Dep')!.metadata.id); assert.deepEqual(forked.get('Member/code.cs'), source.get('Member/code.cs'));
});
test('Import preview/cancel never creates a library; add, identical and conflicting revisions are classified', async () => sandbox(async base => {
	const root = { scope: 'global' as const, path: path.join(base, 'library') }, library = new Library(() => [root]); await library.reload(); const archive = await archiveFile(base);
	let session = await PackImportSession.prepare(library, archive, root); assert.deepEqual(session.rows.map(row => row.category), ['addition', 'addition']); await assert.rejects(fs.stat(root.path)); await session.dispose(); await assert.rejects(fs.stat(root.path));
	session = await PackImportSession.prepare(library, archive, root); try { assert.equal(await session.commit('add'), 'imported'); } finally { await session.dispose(); }
	session = await PackImportSession.prepare(library, archive, root); try { assert.deepEqual(session.rows.map(row => row.category), ['identical', 'identical']); assert.equal(await session.commit('add'), 'identical'); } finally { await session.dispose(); }
	const conflict = await archiveFile(base, tree('int DIFFERENT = 1;'), 'conflict.tcp-sp'); session = await PackImportSession.prepare(library, conflict, root);
	try { assert.ok(session.rows.every(row => row.category === 'conflict')); await assert.rejects(session.commit('add'), ConflictError); assert.equal(await session.commit('fork'), 'imported'); assert.equal(library.catalog.snapshot!.packs.length, 2); assert.equal(new Set(library.catalog.snapshot!.snippets.map(asset => asset.metadata.id)).size, 2); } finally { await session.dispose(); }
}));
test('newer versions coexist; explicit Replace respects asset revision rules', async () => sandbox(async base => {
	const root = { scope: 'global' as const, path: path.join(base, 'library') }, library = new Library(() => [root]); await library.reload();
	for (const [n, source] of [tree(), tree('int Changed = 2;', 'v2.0.0')].entries()) { const session = await PackImportSession.prepare(library, await archiveFile(base, source, n + '.tcp-sp'), root); try { if (n) { assert.deepEqual(session.rows.map(row => row.category), ['different-version', 'different-version']); assert.equal(session.replacements().length, 1); await session.commit('replace', session.replacements()[0]); } else { await session.commit('add'); } } finally { await session.dispose(); } }
	assert.equal(library.catalog.snapshot!.packs.length, 1); assert.equal(library.catalog.snapshot!.snippets[0].metadata.version!.text, 'v2.0.0');
}));
test('different versions can be added as separate Packs; unchanged Snippet version blocks changed-content Replace', async () => sandbox(async base => {
	const root = { scope: 'global' as const, path: path.join(base, 'library') }, library = new Library(() => [root]); await library.reload();
	for (const [n, source] of [tree(), tree('int Changed = 2;', 'v2.0.0')].entries()) { const session = await PackImportSession.prepare(library, await archiveFile(base, source, n + '.tcp-sp'), root); try { await session.commit('add'); } finally { await session.dispose(); } }
	assert.equal(library.catalog.snapshot!.packs.length, 2); assert.equal(library.catalog.snapshot!.snippetGroups.length, 2);
	const invalid = tree('int WRONG = 9;', 'v3.0.0'); invalid.set('Member/snippet.json', tree().get('Member/snippet.json')!); const session = await PackImportSession.prepare(library, await archiveFile(base, invalid, 'invalid-revision.tcp-sp'), root); try { assert.equal(session.replacements().length, 0); assert.equal(session.rows[1].category, 'conflict'); await assert.rejects(session.commit('replace', library.catalog.snapshot!.packs[0]), ConflictError); } finally { await session.dispose(); }
}));
test('Import compares all scopes but identical assets in another scope still copy into the selected root', async () => sandbox(async base => {
	const global = { scope: 'global' as const, path: path.join(base, 'global') }, workspace = { scope: 'workspace' as const, path: path.join(base, 'workspace'), workspaceId: 'test' }, library = new Library(() => [global, workspace]); await library.reload(); const archive = await archiveFile(base);
	for (const root of [global, workspace]) { const session = await PackImportSession.prepare(library, archive, root); try { assert.equal(await session.commit('add'), 'imported'); } finally { await session.dispose(); } }
	assert.equal(library.catalog.snapshot!.packGroups[0].locations.length, 2); assert.equal(library.catalog.snapshot!.snippetGroups[0].locations.length, 2);
}));
test('replacement rename failure restores the previous Pack; failed cleanup retains a recoverable journal', async () => sandbox(async base => {
	const root = { scope: 'global' as const, path: path.join(base, 'library') }; let fault: 'rename' | 'cleanup' | undefined;
	const library = new Library(() => [root], root => { const store = nativeStore(root); return { ...store, rename: async (from, to) => { if (fault === 'rename' && from.endsWith('/new')) { throw new Error('replace rename failure'); } await store.rename(from, to); }, remove: async name => { if (fault === 'cleanup' && name.startsWith('.tcp-staging/')) { throw new Error('cleanup failure'); } await store.remove(name); } }; }); await library.reload();
	let session = await PackImportSession.prepare(library, await archiveFile(base), root); try { await session.commit('add'); } finally { await session.dispose(); } const oldPack = library.catalog.snapshot!.packs[0], original = await library.assetTree(oldPack);
	const newer = await archiveFile(base, tree('int NEWER = 2;', 'v2.0.0'), 'newer.tcp-sp'); session = await PackImportSession.prepare(library, newer, root); fault = 'rename'; try { await assert.rejects(session.commit('replace', session.replacements()[0]), /rename failure/); assert.equal(byteFingerprint(await library.assetTree(oldPack)), byteFingerprint(original)); assert.equal((await pendingRecovery(nativeStore(root))).length, 0); } finally { fault = undefined; await session.dispose(); }
	session = await PackImportSession.prepare(library, newer, root); fault = 'cleanup'; try { await assert.rejects(session.commit('replace', session.replacements()[0]), /recovery cleanup/); const records = await pendingRecovery(nativeStore(root)); assert.equal(records.length, 1); assert.equal(records[0].target, oldPack.relativePath); fault = undefined; await recover(nativeStore(root), records[0], 'keep'); await library.reload(); assert.equal(library.catalog.snapshot!.packs[0].metadata.version!.text, 'v2.0.0'); } finally { fault = undefined; await session.dispose(); }
}));
test('stale external target, root/catalog Reload and changed archive reject Import without altering existing files', async () => sandbox(async base => {
	const root = { scope: 'global' as const, path: path.join(base, 'library') }, library = new Library(() => [root]); await library.reload(); const archive = await archiveFile(base);
	for (const change of [async () => library.reload(), async () => fs.writeFile(archive, Buffer.from('changed')), async () => { await fs.mkdir(path.join(root.path, 'Unexpected'), { recursive: true }); await fs.writeFile(path.join(root.path, 'Unexpected/pack.json'), '{'); }]) {
		await fs.writeFile(archive, await encodeArchive(tree())); await library.reload(); const session = await PackImportSession.prepare(library, archive, root); try { await change(); await assert.rejects(session.commit('add'), /changed|Reload|Archive/); } finally { await session.dispose(); }
	}
}));
test('failed import writes / publish rename roll back without partially installing a Pack; export refuses overwrite', async () => sandbox(async base => {
	const root = { scope: 'global' as const, path: path.join(base, 'library') }; let fail: 'write' | 'rename' | undefined;
	const library = new Library(() => [root], root => { const store = nativeStore(root); return { ...store, writeNew: async (name, bytes) => { if (fail === 'write' && name.endsWith('/code.cs')) { throw new Error('injected write failure'); } await store.writeNew(name, bytes); }, rename: async (from, to) => { if (fail === 'rename' && from.endsWith('/new')) { throw new Error('injected rename failure'); } await store.rename(from, to); } }; }); await library.reload(); const archive = await archiveFile(base);
	for (const fault of ['write', 'rename'] as const) { const session = await PackImportSession.prepare(library, archive, root); fail = fault; try { await assert.rejects(session.commit('add'), /injected/); assert.equal((await library.reload()).packs.length, 0); } finally { fail = undefined; await session.dispose(); } }
	const session = await PackImportSession.prepare(library, archive, root); try { await session.commit('add'); } finally { await session.dispose(); }
	const original = await readTree(nativeStore(root), library.catalog.snapshot!.packs[0].relativePath), output = path.join(base, 'export.tcp-sp'); await exportPack(library, library.catalog.snapshot!.packs[0], output); assert.equal(byteFingerprint(await decodeArchive(await fs.readFile(output))), byteFingerprint(original)); await assert.rejects(exportPack(library, library.catalog.snapshot!.packs[0], output), /EEXIST/); assert.equal(byteFingerprint(await readTree(nativeStore(root), library.catalog.snapshot!.packs[0].relativePath)), byteFingerprint(original));
	const failed = path.join(base, 'failed.tcp-sp'); await assert.rejects(publishArchive(failed, await fs.readFile(output), async () => { throw new Error('stale export'); }), /stale/); await assert.rejects(fs.stat(failed)); assert.ok(!(await fs.readdir(base)).some(name => name.startsWith('.tcp-export-')));
}));
test('marker uses language-owned line comments; unsupported/mid-line/literal context gets no annotation', () => {
	const identity = { id: uuid(1), version: 'v1.0.0' }, body = 'int VALUE = 1;\n', marked = markSource(identity, body, 'csharp', 'class Target {}\n', 16, 16, '\n'); assert.ok(marked?.startsWith('// TCP BEGIN ')); assert.deepEqual(markerEvidence(marked!, 'csharp').map(value => [value.id, value.version]), [[uuid(1), 'v1.0.0']]); assert.ok(markSource(identity, 'value = 1', 'python', '', 0, 0, '\n')?.startsWith('# TCP BEGIN'));
	for (const language of ['plaintext', 'json', 'html', 'unknown']) { assert.equal(markSource(identity, body, language, '', 0, 0, '\n'), undefined); }
	assert.equal(markSource(identity, body, 'csharp', 'abc', 1, 1, '\n'), undefined); assert.equal(markSource(identity, body, 'csharp', '"open\n', 6, 6, '\n'), undefined); assert.equal(markSource(identity, 'string s = "x";', 'csharp', '', 0, 0, '\n'), undefined); assert.deepEqual(markerEvidence('// TCP BEGIN {"id":"bad"}', 'csharp'), []);
	assert.equal(markSource(identity, 'expression', 'javascriptreact', '<div>\n', 6, 6, '\n'), undefined);
});
