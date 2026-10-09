import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MetadataDocument } from '../../core/metadata/document';
import { readMetadata } from '../../core/metadata/semantics';
import { templateInputs, substitute } from '../../core/template/substitution';
import { modePolicy } from '../../core/insertion/modes';
import { planText, applyText } from '../../core/insertion/textPlan';
import { dependencyOrder } from '../../core/dependency/order';
import { resolveClosure } from '../../core/dependency/resolver';
import { supportsStructure, exportNames, validateCollisions } from '../../language/genericProvider';
import { applyFiles, validateDestination, validateOutput } from '../../application/fileInsertion';
import type { AssetLocation } from '../../storage/discovery';

const document = (fields: Record<string, unknown>) => new MetadataDocument(JSON.stringify(fields));
const id = (n: number) => '10000000-0000-0000-0000-' + String(n).padStart(12, '0');
function asset(n: number, dependencies: number[] = [], version = 'v1.0.0', hash = version): AssetLocation {
	return { root: { scope: 'global', path: 'library' }, relativePath: 'Pack/' + n, packName: 'Pack', files: [], usable: true, semanticHash: hash,
		metadata: readMetadata(document({ formatVersion: 1, id: id(n), name: String(n), version, sources: ['code.txt'], dependencies: dependencies.map(n => ({ id: id(n), name: String(n) })) }), 'snippet') };
}
test('templates deduplicate across sources, use per-Snippet definitions, unknown inputs are required and replacement is literal one pass', () => {
	const doc = document({ templateVariables: [{ name: 'TYPE', required: false, default: 'long', description: 'Type', options: ['int', 'long'] }] });
	const inputs = templateInputs(doc, ['{{TYPE}} {{TYPE}}', '{{EXTRA}} {{TYPE}}']); assert.deepEqual(inputs.map(v => v.name), ['EXTRA', 'TYPE']); assert.equal(inputs[0].required, true); assert.equal(inputs[1].defaultValue, 'long'); assert.equal(inputs[1].description, 'Type');
	assert.equal(substitute('{{TYPE}} {{EXTRA}}', inputs, new Map([['TYPE', 'long'], ['EXTRA', '$& $1 \\ hi']])), 'long $& $1 \\ hi');
	assert.throws(() => substitute('{{EXTRA}}', [inputs[0]], new Map([['EXTRA', '{{TYPE}}']])), /unresolved/);
	assert.equal(substitute('a{{EMPTY}}b', [{ name: 'EMPTY', required: false }], new Map([['EMPTY', '']])), 'ab');
});
test('templates reject duplicates, malformed definitions/default/options, missing/empty required values and invalid placeholders', () => {
	for (const definitions of [[{ name: 'A' }, { name: 'A' }], [{ name: 'bad-name' }], [{ name: 'A', options: [] }], [{ name: 'A', options: ['x', 'x'] }], [{ name: 'A', options: ['x'], default: 'y' }], [{ name: 'A', required: true, default: '' }], [{ name: 'A', description: 1 }]]) { assert.throws(() => templateInputs(document({ templateVariables: definitions }), ['{{A}}'])); }
	const inputs = templateInputs(document({}), ['{{A}}']); assert.throws(() => substitute('{{A}}', inputs, new Map())); assert.throws(() => substitute('{{A}}', inputs, new Map([['A', '  ']])));
	assert.throws(() => templateInputs(document({}), ['{{bad-name}}'])); assert.throws(() => substitute('{{A}}'.repeat(300), inputs, new Map([['A', 'x'.repeat(65536)]])), /limit/);
});
test('mode precedence denied > allowed > capability, unavailable defaults require explicit choice', () => {
	assert.deepEqual(modePolicy(document({ insert: { allowedModes: ['cursor', 'end-of-file'], deniedModes: ['cursor'], defaultMode: 'cursor' } }), { structure: false, files: true }), { available: ['end-of-file'], preferred: undefined });
	assert.equal(modePolicy(document({}), { structure: false, files: false }).preferred, 'cursor');
	assert.deepEqual(modePolicy(document({ insert: { allowedModes: [] } }), { structure: true, files: true }).available, []);
	assert.equal(modePolicy(document({ insert: { defaultMode: 'future-mode' } }), { structure: false, files: true }).preferred, undefined);
	assert.throws(() => modePolicy(document({ insert: { deniedModes: 'cursor' } }), { structure: false, files: false }));
});
test('generic structure provider supports explicit plaintext file only; exports drive conservative fail-closed collisions', () => {
	assert.equal(supportsStructure('plaintext', document({ insert: { targets: ['file'] } })), true); assert.equal(supportsStructure('csharp', document({ insert: { targets: ['type'] } })), false); assert.equal(supportsStructure('plaintext', document({})), false);
	assert.deepEqual(exportNames(document({ exports: [{ name: 'Foo', kind: 'class', custom: {} }] })), ['Foo']);
	assert.throws(() => validateCollisions('// Foo may be mentioned in a comment', [{ name: 'A', exports: ['Foo'], sources: ['class Foo {}'] }]), /collision/);
	assert.throws(() => validateCollisions('', [{ name: 'A', exports: ['Foo'], sources: [] }, { name: 'B', exports: ['Foo'], sources: [] }]));
	assert.throws(() => validateCollisions('prefix\nknown body\nsuffix', [{ name: 'A', exports: [], sources: ['known body'] }]), /Ambiguous/);
});
test('dependency-first order handles diamond and SCCs stably regardless of input ordering', () => {
	const a = asset(1, [2, 3]), b = asset(2, [4]), c = asset(3, [4]), d = asset(4);
	assert.deepEqual(dependencyOrder([a, b, c, d]).map(a => a.metadata.id), [id(4), id(2), id(3), id(1)]);
	assert.deepEqual(dependencyOrder([c, d, a, b]).map(a => a.metadata.id), [id(4), id(2), id(3), id(1)]);
	assert.deepEqual(dependencyOrder([asset(2, [1]), asset(1, [2, 3]), asset(3)]).map(a => a.metadata.id), [id(3), id(1), id(2)]);
});
test('insertion resolver stops content conflict rather than choosing an older revision; Workspace wins and name mismatch warns', () => {
	const root = asset(1, [2]), global = asset(2), workspace = { ...global, root: { scope: 'workspace' as const, workspaceId: 'active', path: 'workspace' } };
	assert.equal(resolveClosure([root], [global, workspace], { workspaceId: 'active', strictConflicts: true }).added[0], workspace);
	assert.throws(() => resolveClosure([root], [asset(2, [], 'v2.0.0', 'a'), asset(2, [], 'v2.0.0', 'b'), global], { strictConflicts: true }), /Conflicting/);
	const renamed = { ...global, metadata: readMetadata(document({ id: id(2), name: 'renamed', version: 'v1.0.0', sources: ['code.txt'] }), 'snippet') }; assert.match(resolveClosure([root], [renamed]).warnings[0], /name differs/);
	assert.throws(() => resolveClosure([root], []), /No unambiguous/);
});
test('text modes preserve literal content/EOL, compose dependency order at same offset, and refuse overlap or mixed operations', () => {
	const selection = { start: 1, end: 3, active: 3 };
	assert.equal(applyText('abcd', planText('abcd', selection, [{ mode: 'replace-selection', sources: ['X'] }], '\n')), 'aXd');
	assert.equal(applyText('abcd', planText('abcd', selection, [{ mode: 'cursor', sources: ['DEP'] }, { mode: 'merge-sources', sources: ['A\nB', 'C'] }], '\r\n')), 'abcDEP\r\nA\r\nB\r\nCd');
	assert.equal(applyText('abcd', planText('abcd', selection, [{ mode: 'end-of-file', sources: ['END'] }], '\n')), 'abcdEND');
	assert.throws(() => planText('abcd', selection, [{ mode: 'replace-selection', sources: ['A'] }, { mode: 'replace-selection', sources: ['B'] }], '\n'), /Overlapping/);
	assert.throws(() => planText('abcd', selection, [{ mode: 'separate-files', sources: ['B'] }], '\n'));
});
test('separate-files atomic publish, injected partial write failure and stale pre-publish validation leave target absent and staging cleaned', async () => {
	const base = path.resolve('.vscode-test/phase3-unit'); await fs.mkdir(base, { recursive: true }); const parent = await fs.mkdtemp(path.join(base, 'case-'));
	try {
		const output = { parent, folder: 'New', files: new Map([['one.txt', 'one'], ['nested/two.txt', 'two']]) };
		await assert.rejects(applyFiles(output, async () => {}, async index => { if (index === 1) { throw new Error('injected disk failure'); } }), /disk failure/); assert.deepEqual(await fs.readdir(parent), []);
		await assert.rejects(applyFiles(output, async () => { throw new Error('stale'); }), /stale/); assert.deepEqual(await fs.readdir(parent), []);
		await assert.rejects(applyFiles({ ...output, folder: 'Competing' }, async () => { await fs.mkdir(path.join(parent, 'Competing')); await fs.writeFile(path.join(parent, 'Competing/foreign.txt'), 'user data'); }), /already exists/); assert.equal(await fs.readFile(path.join(parent, 'Competing/foreign.txt'), 'utf8'), 'user data'); assert.equal((await fs.readdir(parent)).some(name => name.startsWith('.tcp-insert-')), false);
		await applyFiles(output, async () => {}); assert.equal(await fs.readFile(path.join(parent, 'New/nested/two.txt'), 'utf8'), 'two');
		await assert.rejects(applyFiles(output, async () => {}), /already exists/); assert.equal(await fs.readFile(path.join(parent, 'New/one.txt'), 'utf8'), 'one');
		await assert.rejects(validateDestination({ ...output, folder: 'new' }), /already exists/);
	} finally { assert.equal(path.dirname(parent), base); await fs.rm(parent, { recursive: true, force: true }); }
});
test('separate-files refuses unsafe traversal, ADS, case/Unicode and file-directory collisions', () => {
	for (const files of [new Map([['../bad', 'x']]), new Map([['bad:stream', 'x']]), new Map([['A.txt', 'a'], ['a.txt', 'b']]), new Map([['Dir/a', 'a'], ['dir/b', 'b']]), new Map([['x', 'a'], ['x/y', 'b']]), new Map([['é', 'a'], ['e\u0301', 'b']])]) { assert.throws(() => validateOutput({ parent: 'workspace', folder: 'New', files })); }
});
