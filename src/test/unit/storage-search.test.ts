import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { loadCatalog } from '../../storage/discovery';
import { Catalog } from '../../storage/catalog';
import { resolveRoots, preferredRoots, type StorageRoot } from '../../storage/roots';
import { containedPath, validateRelativePath, pathCollisionKey, readBoundedFile } from '../../storage/safePaths';
import { writeMetadata } from '../../storage/metadataWrite';
import { sha256 } from '../../core/assets/fingerprint';
import { parseQuery } from '../../core/search/query';
import { modifierSuggestions, searchAssets } from '../../core/search/index';

const fixture = path.resolve('src/test/fixtures/library');
const id = '00000000-0000-0000-0000-000000000001';
const packId = '00000000-0000-0000-0000-000000000010';
async function sandbox(run: (directory: string) => Promise<void>): Promise<void> {
	const base = path.resolve('.vscode-test/phase1-unit');
	await fs.mkdir(base, { recursive: true });
	const directory = await fs.mkdtemp(path.join(base, 'case-'));
	try { await run(directory); }
	finally { assert.equal(path.dirname(directory), base); await fs.rm(directory, { recursive: true, force: true }); }
}
async function write(file: string, content: string): Promise<void> { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); }
async function pack(root: string, folder = 'Pack'): Promise<string> {
	const directory = path.join(root, folder);
	await write(path.join(directory, 'pack.json'), JSON.stringify({ formatVersion: 1, id: packId, name: folder, version: 'v1.0.0' }));
	return directory;
}
async function snippet(directory: string, name: string, extra: Record<string, unknown> = {}, code = 'demo\n'): Promise<void> {
	await write(path.join(directory, name, 'snippet.json'), JSON.stringify({ formatVersion: 1, id, name, version: 'v1.0.0', sources: ['code.cs'], ...extra }));
	await write(path.join(directory, name, 'code.cs'), code);
}
const globalRoot = (directory: string): StorageRoot => ({ scope: 'global', path: directory });

test('portable relative paths reject traversal, ADS, reserved names, git data and ambiguous separators', () => {
	for (const value of ['../code.cs', '/code.cs', 'a/../code.cs', 'a//b', 'a\\b', 'drive:relative', 'code.cs:stream', 'CON.cs', 'com¹.txt', 'a.', 'a ', '.git/config', 'nul', 'a\u0000b', 'x'.repeat(241)]) { assert.throws(() => validateRelativePath(value), value); }
	assert.equal(validateRelativePath('nested/コード.cs'), 'nested/コード.cs');
	assert.equal(pathCollisionKey('E\u0301.cs'), pathCollisionKey('é.cs'));
	assert.equal(pathCollisionKey('σ.cs'), pathCollisionKey('ς.cs'));
	assert.throws(() => containedPath(fixture, '../escape'));
});

test('roots cover all workspace folders and configured Global; loading missing roots creates no data', async () => sandbox(async directory => {
	const roots = resolveRoots(path.join(directory, 'storage'), [{ id: 'a', path: path.join(directory, 'a') }, { id: 'b', path: path.join(directory, 'b') }]);
	assert.equal(roots.length, 3);
	assert.equal(preferredRoots(roots, 'b')[0].workspaceId, 'b');
	assert.equal(resolveRoots(directory, [], fixture)[0].path, fixture);
	assert.throws(() => resolveRoots(directory, [], 'relative'));
	assert.equal((await loadCatalog(roots)).snippets.length, 0);
	assert.deepEqual(await fs.readdir(directory), []);
}));

test('shared loader groups identical Global/Workspace copies and preserves unknown fixture metadata', async () => sandbox(async directory => {
	await fs.cp(fixture, path.join(directory, 'workspace'), { recursive: true });
	const snapshot = await loadCatalog([globalRoot(fixture), { scope: 'workspace', workspaceId: 'active', path: path.join(directory, 'workspace') }]);
	assert.equal(snapshot.snippets.length, 2);
	assert.equal(snapshot.packs.length, 2);
	assert.equal(snapshot.snippetGroups[0].status, 'identical');
	assert.equal(snapshot.packGroups[0].status, 'identical');
	assert.equal(snapshot.snippets[0].metadata.document.raw(['custom', 'huge']), '1234567890123456789012345678901234567890');
	assert.deepEqual(snapshot.diagnostics, []);
	const result = searchAssets(snapshot.snippetGroups, 'lang:"C#" tag:"small helper" scope:workspace', 'active');
	assert.equal(result.hits.length, 1);
	assert.equal(result.hits[0].locations[0].root.workspaceId, 'active');
}));

test('malformed assets, missing source and unsafe reference are isolated while good members remain readable', async () => sandbox(async directory => {
	const folder = await pack(directory);
	await snippet(folder, 'Good');
	await write(path.join(folder, 'Bad', 'snippet.json'), '{broken');
	await snippet(folder, 'Missing', { id: '00000000-0000-0000-0000-000000000002', sources: ['absent.cs'] });
	await snippet(folder, 'Unsafe', { id: '00000000-0000-0000-0000-000000000003', refer: [{ path: '../outside.cs' }] });
	await write(path.join(directory, 'BadPack', 'pack.json'), '{}');
	const snapshot = await loadCatalog([globalRoot(directory)]);
	assert.deepEqual(snapshot.snippets.map(asset => asset.metadata.name), ['Good']);
	assert.equal(snapshot.packs.length, 1);
	assert.equal(snapshot.packs[0].usable, false);
	assert.ok(snapshot.diagnostics.length >= 4);
	assert.ok(snapshot.diagnostics.every(diagnostic => !diagnostic.asset.includes(directory)));
}));

test('future metadata is readable, unverified and unavailable for semantic use', async () => sandbox(async directory => {
	const folder = await pack(directory);
	await snippet(folder, 'Future', { formatVersion: 2, custom: { next: true } });
	const snapshot = await loadCatalog([globalRoot(directory)]);
	assert.equal(snapshot.snippets.length, 1);
	assert.equal(snapshot.snippets[0].metadata.canEdit, false);
	assert.equal(snapshot.snippetGroups[0].status, 'unverified');
	assert.equal(searchAssets(snapshot.snippetGroups, '').hits[0].canInsert, false);
	assert.equal(snapshot.packs[0].semanticHash, undefined);
}));

test('Unicode path collisions quarantine both conflicting member locations', async () => sandbox(async directory => {
	const folder = await pack(directory);
	await snippet(folder, 'é', { id: '00000000-0000-0000-0000-000000000002' });
	await snippet(folder, 'e\u0301', { id: '00000000-0000-0000-0000-000000000003' });
	await snippet(folder, 'Good');
	const snapshot = await loadCatalog([globalRoot(directory)]);
	assert.deepEqual(snapshot.snippets.map(asset => asset.metadata.name), ['Good']);
	assert.ok(snapshot.diagnostics.some(item => item.code === 'unsafe-or-unreadable-entry'));
}));

test('revision conflicts include source bytes and documentation; duplicate UUID inside one Pack prevents use', async () => sandbox(async directory => {
	const first = path.join(directory, 'first'), second = path.join(directory, 'second');
	await fs.cp(fixture, first, { recursive: true }); await fs.cp(fixture, second, { recursive: true });
	await fs.appendFile(path.join(second, 'Algorithms/Minimum/README.md'), '\nchanged\n');
	let snapshot = await loadCatalog([globalRoot(first), { scope: 'workspace', workspaceId: 'two', path: second }]);
	assert.equal(snapshot.snippetGroups[0].status, 'conflict');
	assert.equal(searchAssets(snapshot.snippetGroups, '').hits[0].canInsert, false);
	await fs.cp(path.join(first, 'Algorithms/Minimum'), path.join(first, 'Algorithms/Copy'), { recursive: true });
	snapshot = await loadCatalog([globalRoot(first)]);
	assert.equal(snapshot.snippets.length, 2);
	assert.ok(snapshot.snippets.every(asset => !asset.usable));
	assert.ok(snapshot.diagnostics.some(item => item.code === 'duplicate-snippet-uuid'));
}));

test('link/junction and hardlink content is quarantined without reading an outside target', async () => sandbox(async directory => {
	const folder = await pack(path.join(directory, 'root'));
	await snippet(folder, 'Good');
	await snippet(folder, 'Linked', { id: '00000000-0000-0000-0000-000000000002' });
	const outside = path.join(directory, 'outside'); await write(path.join(outside, 'private.txt'), 'synthetic fixture');
	await fs.symlink(outside, path.join(folder, 'Linked/link'), process.platform === 'win32' ? 'junction' : 'dir');
	await snippet(folder, 'Hardlink', { id: '00000000-0000-0000-0000-000000000003' });
	await fs.link(path.join(outside, 'private.txt'), path.join(folder, 'Hardlink/alias.txt'));
	const snapshot = await loadCatalog([globalRoot(path.join(directory, 'root'))]);
	assert.deepEqual(snapshot.snippets.map(asset => asset.metadata.name), ['Good']);
	assert.ok(snapshot.diagnostics.some(item => item.code === 'unsafe-or-unreadable-entry'));
}));

test('bounded reads and stale metadata writes fail without changing the original; explicit migration only changes format', async () => sandbox(async directory => {
	const target = path.join(directory, 'snippet.json');
	const legacy = JSON.stringify({ id, name: 'Legacy', version: 'v1.0.0', sources: ['code.cs'], custom: { retained: true } });
	await write(target, legacy);
	await assert.rejects(readBoundedFile(target, 4));
	await assert.rejects(writeMetadata(directory, 'snippet.json', sha256('stale'), doc => doc.upgradeFormat(), 'snippet'));
	assert.equal(await fs.readFile(target, 'utf8'), legacy);
	const current = await writeMetadata(directory, 'snippet.json', sha256(legacy), doc => doc.upgradeFormat(), 'snippet');
	assert.equal(current.string(['version']), 'v1.0.0');
	assert.equal(current.format, 'current');
	await assert.rejects(writeMetadata(directory, 'snippet.json', sha256(current.text), doc => doc.patchKnown(['name'], 'Renamed'), 'snippet'));
	assert.equal(await fs.readFile(target, 'utf8'), current.text);
	// Simulate an external writer during planning; revalidation preserves its edit.
	await assert.rejects(writeMetadata(directory, 'snippet.json', sha256(current.text), doc => {
		// Synchronous callback deliberately injects an independent writer before commit.
		writeFileSync(target, current.text + '\n');
		return doc.patchKnown(['name'], 'Renamed').patchKnown(['version'], 'v1.0.0-0');
	}, 'snippet'));
	assert.equal(await fs.readFile(target, 'utf8'), current.text + '\n');
	assert.deepEqual(await fs.readdir(directory), ['snippet.json']);
}));

test('quoted modifiers, exact/ranged versions, errors and suggestions are consistent with indexed metadata', async () => {
	const snapshot = await loadCatalog([globalRoot(fixture)]);
	assert.equal(searchAssets(snapshot.snippetGroups, 'author:"Fixture Author" feature:comparison version:">=v1.0.0 <v2.0.0"').hits.length, 1);
	assert.equal(searchAssets(snapshot.snippetGroups, 'version:v1.0.0-0').hits.length, 1);
	for (const query of ['unknown:x', 'lang:', 'lang:"unclosed', 'version:^v1.0.0', 'version:">v1.0.0 <v1.0.0-0"', 'scope:other']) {
		const result = searchAssets(snapshot.snippetGroups, query);
		assert.ok(result.errors.length, query); assert.deepEqual(result.hits, []);
	}
	assert.deepEqual(modifierSuggestions(snapshot.snippetGroups, 'tag'), ['tag:"numeric"', 'tag:"small helper"']);
	assert.equal(parseQuery('tag:"escaped \\"quoted\\""').errors.length, 0);
});

test('ranking prioritizes exact/prefix/partial name, tags/category, features, description; scope/version break ties', async () => sandbox(async directory => {
	const folder = await pack(directory);
	const cases = [ ['needle', {}], ['needle prefix', {}], ['a needle b', {}], ['Tagged', { tags: ['needle'] }], ['Featured', { features: ['needle'] }], ['Described', { description: 'needle' }] ] as const;
	for (let index = 0; index < cases.length; index++) {
		await snippet(folder, cases[index][0], { ...cases[index][1], id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}` });
	}
	const snapshot = await loadCatalog([globalRoot(directory)]);
	assert.deepEqual(searchAssets(snapshot.snippetGroups, 'needle').hits.map(hit => hit.locations[0].metadata.name), cases.map(item => item[0]));
	const other = path.join(directory, 'other'); await fs.cp(fixture, other, { recursive: true });
	const tie = await loadCatalog([{ scope: 'workspace', workspaceId: 'active', path: other }, globalRoot(fixture)]);
	assert.equal(searchAssets(tie.snippetGroups, '', 'active').hits[0].locations[0].root.workspaceId, 'active');
	await snippet(folder, 'Newer', { name: 'needle', version: 'v1.0.0-0' });
	const newer = await loadCatalog([globalRoot(directory)]);
	assert.equal(searchAssets(newer.snippetGroups, 'needle').hits[0].locations[0].metadata.version!.text, 'v1.0.0-0');
}));

test('Catalog reload replaces snapshots explicitly; later external content is not silently adopted', async () => sandbox(async directory => {
	await fs.cp(fixture, directory, { recursive: true });
	const catalog = new Catalog(); await catalog.reload([globalRoot(directory)]);
	const before = catalog.snapshot;
	await fs.appendFile(path.join(directory, 'Algorithms/Minimum/code.cs'), '\nchanged\n');
	assert.equal(catalog.snapshot, before);
	await catalog.reload([globalRoot(directory)]);
	assert.notEqual(catalog.snapshot?.snippets[0].semanticHash, before?.snippets[0].semanticHash);
	assert.equal(catalog.search('Minimum').hits.length, 1);
}));
