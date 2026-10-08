import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Library, patchDependencies } from '../../application/library';
import { UserState } from '../../application/userState';
import { ChangeTracker } from '../../application/changes';
import { MetadataDocument } from '../../core/metadata/document';
import { readMetadata } from '../../core/metadata/semantics';
import { resolveClosure } from '../../core/dependency/resolver';
import { nextVersion, parseVersion } from '../../core/version/parser';
import { loadCatalog, type AssetLocation } from '../../storage/discovery';
import type { StorageRoot } from '../../storage/roots';
import { nativeStore } from '../../storage/store';
import { commitTree, byteFingerprint, readTree } from '../../storage/transaction';
import { pendingRecovery, recover } from '../../storage/recovery';
import { validateStoragePath } from '../../storage/safePaths';

const id = (n: number) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const fixture = path.resolve('src/test/fixtures/library');
async function sandbox(run: (root: StorageRoot, workspace: StorageRoot) => Promise<void>): Promise<void> {
	const base = path.resolve('.vscode-test/phase2-unit'); await fs.mkdir(base, { recursive: true });
	const directory = await fs.mkdtemp(path.join(base, 'case-'));
	try { await run({ scope: 'global', path: path.join(directory, 'global') }, { scope: 'workspace', workspaceId: 'active', path: path.join(directory, 'workspace') }); }
	finally { assert.equal(path.dirname(directory), base); await fs.rm(directory, { recursive: true, force: true }); }
}
async function write(file: string, content: string): Promise<void> { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); }
async function seed(root: StorageRoot): Promise<void> { await fs.cp(fixture, root.path, { recursive: true }); }
function candidate(n: number, version = 'v1.0.0', dependencies: { id: string; name: string; version?: string }[] = [], hash = version): AssetLocation {
	return { root: { scope: 'global', path: 'library' }, relativePath: 'Pack/Member-' + n, packName: 'Pack', files: [], semanticHash: hash, usable: true,
		metadata: readMetadata(new MetadataDocument(JSON.stringify({ formatVersion: 1, id: id(n), name: 'Member-' + n, version, sources: ['code.cs'], dependencies })), 'snippet') };
}
const dep = (n: number, version?: string) => ({ id: id(n), name: 'Member-' + n, ...(version ? { version } : {}) });

test('Pack resolver backtracks across diamond constraints and handles cycles without duplicate versions', () => {
	const a = candidate(1, 'v1.0.0', [dep(2), dep(3)]), b2 = candidate(2, 'v2.0.0', [dep(4, '=v2.0.0')]), b1 = candidate(2, 'v1.0.0', [dep(4, '=v1.0.0')]);
	const c = candidate(3, 'v1.0.0', [dep(4, '=v1.0.0')]), d1 = candidate(4), d2 = candidate(4, 'v2.0.0');
	const closure = resolveClosure([a], [b2, b1, c, d1, d2]); assert.equal(closure.members.find(item => item.metadata.id === id(2))!.metadata.version!.text, 'v1.0.0'); assert.equal(closure.added.length, 3);
	const cycleA = candidate(1, 'v1.0.0', [dep(2)]), cycleB = candidate(2, 'v1.0.0', [dep(1)]); assert.equal(resolveClosure([cycleA], [cycleA, cycleB]).members.length, 2);
});
test('Pack resolver refuses fixed duplicate revisions, ambiguous implementations and required removals; bounded cancellation works', () => {
	assert.throws(() => resolveClosure([candidate(1), candidate(1, 'v2.0.0')], []), /One Pack/);
	const a = candidate(1, 'v1.0.0', [dep(2)]);
	assert.throws(() => resolveClosure([a], [candidate(2, 'v1.0.0', [], 'a'), candidate(2, 'v1.0.0', [], 'b')]), /unambiguous/);
	assert.throws(() => resolveClosure([a], [candidate(2)], { forbidden: new Set([id(2)]) }), /Cannot remove/);
	assert.throws(() => resolveClosure([a], [candidate(2)], { maxNodes: 1 }), /limit/);
	const abort = new AbortController(); abort.abort(); assert.throws(() => resolveClosure([a], [], { signal: abort.signal }), /Cancelled/);
});
test('dependency field edits preserve nested unknown numeric tokens, append and remove safely', () => {
	const document = new MetadataDocument('{"formatVersion":1,"id":"' + id(1) + '","name":"A","version":"v1.0.0","sources":["a.cs"],"dependencies":[{"id":"' + id(2) + '","name":"B","version":"=v1.0.0","unknown":{"large":1234567890123456789012345678901234567890}},{"id":"' + id(3) + '","name":"C"}],"future":{"raw":1e999}}');
	const changed = patchDependencies(document, [{ originalIndex: 0, id: id(2), name: 'Renamed' }, { id: id(4), name: 'D', version: '>=v1.0.0' }]);
	assert.equal(changed.raw(['dependencies', 0, 'unknown']), document.raw(['dependencies', 0, 'unknown'])); assert.equal(changed.raw(['future']), document.raw(['future'])); assert.equal(changed.node(['dependencies', 0, 'version']), undefined); assert.equal(changed.string(['dependencies', 1, 'id']), id(4)); assert.equal(changed.node(['dependencies'])!.children!.length, 2);
	assert.throws(() => patchDependencies(document, [{ originalIndex: 4, id: id(2), name: 'B' }]));
});
test('first New/Selection/File creation is lazy, preserves captured bytes and searches immediately', async () => sandbox(async (root, workspace) => {
	const library = new Library(() => [root, workspace]); await library.reload(); await assert.rejects(fs.stat(root.path));
	for (const [name, code] of [['New', ''], ['Selection', 'a\r\nb\r\n'], ['File', 'full\nsource\n']]) { const created = await library.createSnippet(root, { fields: { name, version: 'v1.0.0', languages: ['C#'] }, sourceName: 'code.cs', bytes: Buffer.from(code) }); const asset = library.catalog.snapshot!.snippets.find(item => item.metadata.id === created)!; assert.equal((await library.source(asset, 'code.cs')).toString(), code); assert.equal(library.catalog.search(name).hits.length, 1); }
	assert.equal(library.catalog.snapshot!.packs[0].relativePath, 'Default'); assert.equal(library.catalog.snapshot!.packs[0].metadata.version!.text, 'v1.0.0-1'); await assert.rejects(fs.stat(workspace.path));
}));
test('copy is scope-symmetric, preserves originals and groups identical content; distinct revisions remain actionable', async () => sandbox(async (root, workspace) => {
	await seed(root); const library = new Library(() => [root, workspace]); await library.reload(); const original = library.catalog.snapshot!.snippets[0], bytes = await library.source(original, 'code.cs');
	await library.copySnippets([original], workspace); assert.equal(library.catalog.snapshot!.snippetGroups.length, 1); assert.equal(library.catalog.snapshot!.snippetGroups[0].locations.length, 2);
	const copied = library.catalog.snapshot!.snippets.find(item => item.root.scope === 'workspace')!;
	await library.editSnippet(copied, { name: 'Edited', version: 'v1.0.0-1' }); assert.equal(library.catalog.snapshot!.snippetGroups.length, 2);
	assert.deepEqual(await library.source(original, 'code.cs'), bytes); await assert.rejects(library.copySnippets([original], workspace), /One Pack|another version/);
	await library.copySnippets([library.catalog.snapshot!.snippets.find(item => item.root.scope === 'workspace')!], root, 'Other revision'); assert.equal(library.catalog.snapshot!.snippets.length, 3);
}));
test('metadata editing requires newer asset version and preserves all unknown fields; Pack revision advances', async () => sandbox(async root => {
	await seed(root); const library = new Library(() => [root]); await library.reload(); const original = library.catalog.snapshot!.snippets[0];
	await assert.rejects(library.editSnippet(original, { description: 'Changed' }), /newer/);
	await library.editSnippet(original, { description: 'Changed', version: 'v1.0.0-1' }); const after = library.catalog.snapshot!.snippets[0];
	assert.equal(after.metadata.document.raw(['custom']), original.metadata.document.raw(['custom'])); assert.equal(library.catalog.snapshot!.packs[0].metadata.version!.text, 'v1.0.0-0');
}));
test('Pack create auto-adds recursive closure, same form edits it, breaking removal is rejected, dependent bulk delete succeeds', async () => sandbox(async (root, workspace) => {
	await write(path.join(root.path, 'Input/pack.json'), JSON.stringify({ formatVersion: 1, id: id(10), name: 'Input', version: 'v1.0.0' }));
	for (const [n, deps] of [[1, [dep(2)]], [2, [dep(3)]], [3, []]] as const) {
		const asset = candidate(n, 'v1.0.0', [...deps]); await write(path.join(root.path, `Input/${n}/snippet.json`), asset.metadata.document.text); await write(path.join(root.path, `Input/${n}/code.cs`), 'code-' + n);
	}
	const library = new Library(() => [root, workspace]); await library.reload(); const a = library.catalog.snapshot!.snippets.find(item => item.metadata.id === id(1))!;
	const result = await library.createOrEditPack(workspace, { fields: { name: 'Bundle', version: 'v1.0.0' }, members: [a] }); assert.equal(result.added.length, 2);
	const pack = library.catalog.snapshot!.packs.find(item => item.root.scope === 'workspace')!, members = library.members(pack); assert.equal(members.length, 3);
	await assert.rejects(library.createOrEditPack(workspace, { fields: { name: 'Bundle', version: 'v1.0.0-0' }, members: members.filter(item => item.metadata.id !== id(3)) }, pack), /Cannot remove/);
	await assert.rejects(library.deleteAssets([members.find(item => item.metadata.id === id(2))!]), /still required/);
	await library.deleteAssets(members); assert.equal(library.catalog.snapshot!.snippets.filter(item => item.root.scope === 'workspace').length, 0); assert.equal(library.catalog.snapshot!.snippets.filter(item => item.root.scope === 'global').length, 3);
}));
test('Snippet creation with a dependency includes its transitive closure in Default', async () => sandbox(async (root, workspace) => {
	await seed(root); const library = new Library(() => [root, workspace]); await library.reload(); const dependency = library.catalog.snapshot!.snippets[0];
	await library.createSnippet(workspace, { fields: { name: 'Uses minimum', version: 'v1.0.0' }, sourceName: 'code.cs', bytes: Buffer.from('use();'), dependencies: [{ id: dependency.metadata.id!, name: dependency.metadata.name!, version: '=' + dependency.metadata.version!.text }] }); assert.equal(library.catalog.snapshot!.snippets.filter(item => item.root.scope === 'workspace').length, 2);
}));
test('whole Pack copy keeps ancillary files and exact bytes, repeated copy is a no-op', async () => sandbox(async (root, workspace) => {
	await seed(root); await write(path.join(root.path, 'Algorithms/LICENSE.txt'), 'fixture license');
	const library = new Library(() => [root, workspace]); await library.reload(); const original = library.catalog.snapshot!.packs[0];
	await library.copyPack(original, workspace); const copy = library.catalog.snapshot!.packs.find(item => item.root.scope === 'workspace')!;
	assert.equal(byteFingerprint(await readTree(nativeStore(root), original.relativePath)), byteFingerprint(await readTree(nativeStore(workspace), copy.relativePath)));
	await library.copyPack(original, workspace); assert.equal(library.catalog.snapshot!.packs.length, 2);
}));
test('format-only migration changes formatVersion in place without increasing Snippet or Pack revision', async () => sandbox(async root => {
	await seed(root); const file = path.join(root.path, 'Algorithms/Minimum/snippet.json'); const text = await fs.readFile(file, 'utf8'); const legacy = text.replace(/"formatVersion"\s*:\s*1\s*,/, ''); await fs.writeFile(file, legacy);
	const library = new Library(() => [root]); await library.reload(); const before = library.catalog.snapshot!.snippets[0]; await library.upgrade(before); const after = library.catalog.snapshot!.snippets[0]; assert.equal(after.metadata.document.format, 'current'); assert.equal(before.metadata.version!.text, after.metadata.version!.text); assert.equal(library.catalog.snapshot!.packs[0].metadata.version!.text, 'v1.0.0'); assert.equal(before.semanticHash, after.semanticHash);
}));
test('external source changes and dirty documents stop writes; unsafe filenames leave roots untouched', async () => sandbox(async (root, workspace) => {
	await seed(root); const library = new Library(() => [root, workspace]); await library.reload(); const original = library.catalog.snapshot!.snippets[0]; await fs.appendFile(path.join(root.path, original.relativePath, 'code.cs'), '// external');
	await assert.rejects(library.copySnippets([original], workspace), /Source changed/); await assert.rejects(fs.stat(path.join(workspace.path, 'Default')));
	const dirty = new Library(() => [root], nativeStore, async () => { throw new Error('dirty'); }); await dirty.reload(); await assert.rejects(dirty.editSnippet(dirty.catalog.snapshot!.snippets[0], { version: 'v1.0.0-0' }), /dirty/);
	for (const sourceName of ['../outside.cs', 'snippet.json', 'pack.json', 'nested/code.cs']) { await assert.rejects(library.createSnippet(workspace, { fields: { name: 'Bad', version: 'v1.0.0' }, sourceName, bytes: Buffer.alloc(0) })); }
}));
test('own write adopts only its Pack while another externally changed Pack awaits Reload', async () => sandbox(async root => {
	await seed(root); const library = new Library(() => [root]); await library.reload(); const original = library.catalog.snapshot!.snippets[0], loadedHash = original.semanticHash;
	await fs.appendFile(path.join(root.path, original.relativePath, 'code.cs'), '// external');
	await library.createSnippet(root, { fields: { name: 'Own new', version: 'v1.0.0' }, sourceName: 'code.txt', bytes: Buffer.from('new') }); assert.equal(library.catalog.snapshot!.snippets.find(item => item.metadata.id === original.metadata.id)!.semanticHash, loadedHash);
	await library.reload(); assert.notEqual(library.catalog.snapshot!.snippets.find(item => item.metadata.id === original.metadata.id)!.semanticHash, loadedHash);
}));
test('transaction rename failure restores original and clears only owned scratch; stale destination is untouched', async () => sandbox(async root => {
	await seed(root); const store = nativeStore(root), tree = await readTree(store, 'Algorithms'), changed = new Map(tree); changed.set('note.txt', Buffer.from('new'));
	const fail = { ...store, rename: async (from: string, to: string) => { if (from.endsWith('/new')) { throw new Error('injected rename'); } await store.rename(from, to); } };
	await assert.rejects(commitTree(fail, 'Algorithms', byteFingerprint(tree), changed), /injected rename/); assert.equal(byteFingerprint(await readTree(store, 'Algorithms')), byteFingerprint(tree)); assert.deepEqual(await pendingRecovery(store), []);
	await assert.rejects(commitTree(store, 'Algorithms', 'wrong', changed), /destination changed/); assert.equal(byteFingerprint(await readTree(store, 'Algorithms')), byteFingerprint(tree)); await assert.rejects(store.remove('Algorithms'));
}));
test('interrupted transaction retains a relative-path journal and can restore a missing target without overwriting others', async () => sandbox(async root => {
	await seed(root); const store = nativeStore(root), tree = await readTree(store, 'Algorithms');
	const fail = { ...store, rename: async (from: string, to: string) => { if (from.endsWith('/new') || from.endsWith('/old')) { throw new Error('injected failure'); } await store.rename(from, to); } };
	await assert.rejects(commitTree(fail, 'Algorithms', byteFingerprint(tree), new Map([...tree, ['note.txt', Buffer.from('new')]])));
	const records = await pendingRecovery(store); assert.equal(records.length, 1); assert.equal(JSON.stringify(records).includes(root.path), false);
	await recover(store, records[0], 'restore'); assert.equal(byteFingerprint(await readTree(store, 'Algorithms')), byteFingerprint(tree)); assert.deepEqual(await pendingRecovery(store), []);
}));
test('external watcher does not reload, Later notifies once, own byte-matched writes are suppressed', async () => sandbox(async root => {
	await seed(root); const library = new Library(() => [root]); await library.reload(); let notices = 0, badge = false;
	const tracker = new ChangeTracker(() => library.catalog.snapshot, () => loadCatalog([root]), async () => { notices++; }, pending => { badge = pending; });
	try { await tracker.check(); assert.equal(notices, 0); await library.createSnippet(root, { fields: { name: 'Own', version: 'v1.0.0' }, sourceName: 'code.txt', bytes: Buffer.alloc(0) }); await tracker.check(); assert.equal(notices, 0);
		const before = library.catalog.snapshot!.snippets[0].semanticHash; await fs.appendFile(path.join(root.path, library.catalog.snapshot!.snippets[0].relativePath, 'code.cs'), '// external'); await tracker.check(); await tracker.check(); assert.equal(notices, 1); assert.equal(badge, true); assert.equal(library.catalog.snapshot!.snippets[0].semanticHash, before); await library.reload(); tracker.reloaded(); assert.equal(badge, false);
	} finally { tracker.dispose(); }
}));
test('favorites/recent/usage live in user storage and revision increment respects missing-patch semantics', async () => {
	const storage = new Map<string, unknown>(); const state = new UserState({ get: <T>(key: string, fallback: T) => storage.get(key) as T ?? fallback, update: async (key, value) => { storage.set(key, value); } });
	await state.toggle('snippet:item:v1.0.0'); await state.touch('snippet:item:v1.0.0'); assert.equal(state.get('snippet:item:v1.0.0').favorite, true); assert.equal(state.get('snippet:item:v1.0.0').usage, 0); await state.inserted('snippet:item:v1.0.0'); assert.equal(state.get('snippet:item:v1.0.0').usage, 1);
	assert.equal(nextVersion(parseVersion('v1.2.3')), 'v1.2.3-0'); assert.equal(nextVersion(parseVersion('v1.2.3-0')), 'v1.2.3-1');
});

test('author name edits preserve object extension fields; explicit removal/append works without numeric rounding', () => {
	const doc = new MetadataDocument('{"formatVersion":1,"authors":[{"name":"A","custom":{"n":9007199254740993123456789}},"B"]}');
	const changed = doc.patchAuthors(['Renamed', 'B', 'C']); assert.equal(changed.raw(['authors', 0, 'custom']), doc.raw(['authors', 0, 'custom'])); assert.equal(changed.string(['authors', 2]), 'C');
	assert.equal(changed.patchAuthors(['Renamed']).node(['authors'])!.children!.length, 1); assert.equal(changed.patchAuthors([]).raw(['authors']), '[]');
	assert.throws(() => new MetadataDocument('{"formatVersion":1,"authors":[{"unrecognized":true}]}').patchAuthors(['A']));
});
test('malformed unrelated optional metadata remains lossless during an allowed edit', async () => sandbox(async root => {
	await seed(root); const file = path.join(root.path, 'Algorithms/Minimum/snippet.json'), document = new MetadataDocument(await fs.readFile(file, 'utf8')); await fs.writeFile(file, document.text.replace('"features": ["comparison"]', '"features": {"custom":1234567890123456789012345678901234567890}'));
	const library = new Library(() => [root]); await library.reload(); const before = library.catalog.snapshot!.snippets[0]; await library.editSnippet(before, { description: 'Changed', version: 'v1.0.0-1' }); assert.equal(library.catalog.snapshot!.snippets[0].metadata.document.raw(['features']), before.metadata.document.raw(['features']));
}));
test('opaque future Pack copy is byte-identical and stays read-only', async () => sandbox(async (root, workspace) => {
	await seed(root); const file = path.join(root.path, 'Algorithms/pack.json'); await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('"formatVersion": 1', '"formatVersion": 2'));
	const library = new Library(() => [root, workspace]); await library.reload(); const asset = library.catalog.snapshot!.packs[0]; assert.equal(asset.metadata.document.format, 'future'); await library.copyPack(asset, workspace); const copied = library.catalog.snapshot!.packs.find(item => item.root.scope === 'workspace')!; assert.equal(byteFingerprint(await readTree(nativeStore(root), asset.relativePath)), byteFingerprint(await readTree(nativeStore(workspace), copied.relativePath))); await assert.rejects(library.createOrEditPack(workspace, { fields: { version: 'v1.0.0-0' }, members: library.members(copied) }, copied), /future-format/);
}));
test('write failure leaves original files and cleanup failure retains an installed transaction for explicit Keep recovery', async () => sandbox(async root => {
	await seed(root); const store = nativeStore(root), tree = await readTree(store, 'Algorithms'), next = new Map([...tree, ['note.txt', Buffer.from('new')]]);
	const failWrite = { ...store, writeNew: async () => { throw new Error('injected write'); } }; await assert.rejects(commitTree(failWrite, 'Algorithms', byteFingerprint(tree), next), /injected write/); assert.equal(byteFingerprint(await readTree(store, 'Algorithms')), byteFingerprint(tree));
	const failCleanup = { ...store, remove: async () => { throw new Error('injected cleanup'); } }; await assert.rejects(commitTree(failCleanup, 'Algorithms', byteFingerprint(tree), next), /cleanup failed/); const records = await pendingRecovery(store); assert.equal(records.length, 1); await recover(store, records[0], 'keep'); assert.equal(byteFingerprint(await readTree(store, 'Algorithms')), byteFingerprint(next)); assert.deepEqual(await pendingRecovery(store), []);
}));
test('recovery refuses externally changed targets/backups and never overwrites their contents', async () => sandbox(async root => {
	await seed(root); const store = nativeStore(root), tree = await readTree(store, 'Algorithms'); const failed = { ...store, rename: async (from: string, to: string) => { if (from.endsWith('/new') || from.endsWith('/old')) { throw new Error('injected'); } await store.rename(from, to); } }; await assert.rejects(commitTree(failed, 'Algorithms', byteFingerprint(tree), tree));
	const record = (await pendingRecovery(store))[0]; await write(path.join(root.path, 'Algorithms/external.txt'), 'external'); await assert.rejects(recover(store, record, 'restore'), /target exists/); assert.equal(await fs.readFile(path.join(root.path, 'Algorithms/external.txt'), 'utf8'), 'external'); assert.equal((await pendingRecovery(store)).length, 1);
}));
test('root reconfiguration marks changes even when both libraries are empty and waits for explicit reload', async () => {
	let notices = 0, badge = false; const empty = await loadCatalog([]); const tracker = new ChangeTracker(() => empty, async () => empty, async () => { notices++; }, value => { badge = value; });
	try { await tracker.changed(); await tracker.changed(); assert.equal(notices, 1); assert.equal(badge, true); tracker.reloaded(); assert.equal(badge, false); await tracker.changed(); assert.equal(notices, 2); } finally { tracker.dispose(); }
});

test('whole Pack and Snippet copy plus metadata edits preserve nested empty directories', async () => sandbox(async (root, workspace) => {
	await seed(root); await fs.mkdir(path.join(root.path, 'Algorithms/empty-parent/deep'), { recursive: true }); await fs.mkdir(path.join(root.path, 'Algorithms/Minimum/empty-member/deep'), { recursive: true });
	const library = new Library(() => [root, workspace]); await library.reload(); const pack = library.catalog.snapshot!.packs[0], member = library.catalog.snapshot!.snippets[0];
	await library.copyPack(pack, workspace); const copy = library.catalog.snapshot!.packs.find(item => item.root.scope === 'workspace')!; assert.equal(byteFingerprint(await readTree(nativeStore(root), pack.relativePath)), byteFingerprint(await readTree(nativeStore(workspace), copy.relativePath))); assert.equal((await fs.stat(path.join(workspace.path, copy.relativePath, 'empty-parent/deep'))).isDirectory(), true);
	await library.copySnippets([member], workspace); const copiedMember = library.catalog.snapshot!.snippets.find(item => item.root.scope === 'workspace' && item.packName === 'Default')!; assert.equal((await fs.stat(path.join(workspace.path, copiedMember.relativePath, 'empty-member/deep'))).isDirectory(), true); assert.equal(library.catalog.snapshot!.snippetGroups.length, 1);
	await library.editSnippet(member, { description: 'Preserve empty folders', version: 'v1.0.0-1' }); assert.equal((await fs.stat(path.join(root.path, 'Algorithms/Minimum/empty-member/deep'))).isDirectory(), true); assert.equal((await fs.stat(path.join(root.path, 'Algorithms/empty-parent/deep'))).isDirectory(), true);
	await fs.mkdir(path.join(root.path, 'Algorithms/Minimum/new-external-empty')); const stale = library.catalog.snapshot!.snippets.find(item => item.root.scope === 'global')!; await assert.rejects(library.copySnippets([stale], workspace, 'Stale copy'), /Source changed/);
}));

test('library and staging prefixes do not consume the asset-relative path budget', async () => sandbox(async (root, workspace) => {
	const source = 'd'.repeat(110) + '/' + 'f'.repeat(110) + '.cs';
	await write(path.join(root.path, 'P/pack.json'), JSON.stringify({ formatVersion: 1, id: id(10), name: 'Long paths', version: 'v1.0.0' }));
	await write(path.join(root.path, 'P/S/snippet.json'), JSON.stringify({ formatVersion: 1, id: id(1), name: 'Long source', version: 'v1.0.0', sources: [source] })); await write(path.join(root.path, 'P/S', source), 'code');
	const library = new Library(() => [root, workspace]); await library.reload(); assert.equal(library.catalog.snapshot!.snippets.length, 1); await library.copyPack(library.catalog.snapshot!.packs[0], workspace); assert.equal(library.catalog.snapshot!.packs.filter(item => item.root.scope === 'workspace').length, 1); await library.copySnippets([library.catalog.snapshot!.snippets.find(item => item.root.scope === 'global')!], workspace);
	const copy = library.catalog.snapshot!.snippets.find(item => item.packName === 'Default')!; assert.equal((await library.source(copy, source)).toString(), 'code');
	assert.throws(() => validateStoragePath('../escape')); assert.throws(() => validateStoragePath('x'.repeat(241))); assert.throws(() => validateStoragePath('a/'.repeat(129) + 'x')); assert.throws(() => validateStoragePath('a/'.repeat(256) + 'x'));
}));
