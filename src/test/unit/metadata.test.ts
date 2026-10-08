import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { MetadataDocument } from '../../core/metadata/document';
import { readMetadata } from '../../core/metadata/semantics';
import { validateMetadataChange } from '../../core/metadata/changes';
import { parseVersion, compareVersions } from '../../core/version/parser';
import { parseConstraint, satisfies } from '../../core/version/constraint';
import { sha256, treeFingerprint } from '../../core/assets/fingerprint';
import { groupAssets } from '../../core/assets/identity';

const id = '00000000-0000-0000-0000-000000000001';
const base = `"id":"${id}","name":"Demo","version":"v1.0.0","sources":["code.cs"]`;
const doc = (extra = '', format = '"formatVersion":1,') => new MetadataDocument(`{${format}${base}${extra}}`);

test('structured edits preserve nested unknown numbers, numeric spellings, escaped strings and proto data', () => {
	const original = doc(',"custom":{"huge":1234567890123456789012345678901234567890,"fraction":1.00000000000000000001,"exponent":1e999,"items":[{"literal":"\\u0041"}]},"__proto__":{"polluted":true},"insert":{"defaultMode":"cursor","unknown":{"wide":9007199254740993}}');
	const edited = original.patchKnown(['name'], 'Renamed').patchKnown(['insert', 'defaultMode'], 'end-of-file');
	for (const path of [['custom'], ['__proto__'], ['insert', 'unknown']]) { assert.equal(edited.raw(path), original.raw(path)); }
	assert.equal(edited.string(['name']), 'Renamed');
	assert.equal(Object.hasOwn({}, 'polluted'), false);
	assert.throws(() => edited.patchKnown(['custom'], {}));
	assert.throws(() => edited.patchKnown(['insert'], {}));
});

test('known edits inside dependency/export/template objects leave unknown sibling subtrees exact', () => {
	const original = doc(`,"dependencies":[{"id":"${id}","name":"Old","custom":{"n":1e999}}],"exports":[{"kind":"function","name":"Old","custom":{"n":1.00}}],"templateVariables":[{"name":"OLD","required":true,"custom":[9007199254740993]}]`);
	const edited = original.patchKnown(['dependencies', 0, 'name'], 'New').patchKnown(['exports', 0, 'name'], 'New')
		.patchKnown(['templateVariables', 0, 'required'], false);
	for (const field of ['dependencies', 'exports', 'templateVariables']) { assert.equal(edited.raw([field, 0, 'custom']), original.raw([field, 0, 'custom'])); }
	assert.throws(() => doc(',"tags":[{"unknown":true}]').patchKnown(['tags'], ['tag']));
});

test('strict JSON rejects comments, trailing commas, duplicate nested keys, depth and size bombs', () => {
	for (const text of ['{"x":1,}', '{/*comment*/"x":1}', '{"x":{"a":1,"a":2}}', '[]', '', '{"x":' + '['.repeat(65) + '0' + ']'.repeat(65) + '}', '{"x":"' + 'x'.repeat(1024 * 1024) + '"}']) {
		const invalid = new MetadataDocument(text);
		assert.equal(invalid.format, 'invalid');
		assert.throws(() => invalid.patchKnown(['name'], 'Name'));
	}
});

test('format states are independent of asset version; future/invalid metadata cannot be edited or inserted', () => {
	for (const [prefix, state] of [['', 'legacy'], ['"formatVersion":0,', 'legacy'], ['"formatVersion":1,', 'current'], ['"formatVersion":1.0,', 'current'], ['"formatVersion":10e-1,', 'current'], ['"formatVersion":2,', 'future'], ['"formatVersion":1e999,', 'future'], ['"formatVersion":99999999999999999999,', 'future'], ['"formatVersion":-1,', 'invalid'], ['"formatVersion":"1",', 'invalid'], ['"formatVersion":1.1,', 'invalid'], ['"formatVersion":1e-999,', 'invalid']] as const) {
		const document = doc('', prefix), view = readMetadata(document, 'snippet');
		assert.equal(document.format, state);
		assert.equal(view.version?.text, 'v1.0.0');
		assert.equal(view.canEdit, state === 'current');
		assert.equal(view.canInsert, ['legacy', 'current'].includes(state));
		if (state !== 'current') { assert.throws(() => document.patchKnown(['name'], 'Other')); }
	}
});

test('semantic-preserving format migration keeps revision and unknown fields; semantic edits require newer revision', () => {
	const legacy = doc(',"custom":{"wide":123456789012345678901234567890}', '');
	const current = legacy.upgradeFormat();
	validateMetadataChange(legacy, current, 'snippet');
	assert.equal(current.string(['version']), 'v1.0.0');
	assert.equal(current.raw(['custom']), legacy.raw(['custom']));
	assert.equal(current.canonical(true), legacy.canonical(true));
	assert.throws(() => validateMetadataChange(current, current.patchKnown(['name'], 'New name'), 'snippet'));
	validateMetadataChange(current, current.patchKnown(['name'], 'New name').patchKnown(['version'], 'v1.0.0-0'), 'snippet');
	assert.throws(() => validateMetadataChange(current, current.patchKnown(['version'], 'v0.0.0'), 'snippet'));
	assert.throws(() => validateMetadataChange(doc('', '"formatVersion":2,'), current, 'snippet'));
});

test('invalid mandatory fields isolate an asset; optional malformed fields block only the affected feature', () => {
	assert.equal(readMetadata(new MetadataDocument('{"id":"bad","name":"","version":"v1.0.0","sources":[]}'), 'snippet').valid, false);
	const optional = readMetadata(doc(',"tags":false,"dependencies":[{"id":"bad","name":"Broken"}]'), 'snippet');
	assert.equal(optional.valid, true);
	assert.equal(optional.canEdit, true);
	assert.equal(optional.canInsert, false);
	assert.equal(optional.blockedFeatures.has('tags'), true);
	assert.equal(readMetadata(doc(',"dependencies":[]'), 'snippet').canInsert, true);
	assert.equal(readMetadata(doc(`,"dependencies":[{"id":"${id}","name":"Dep","version":">v1.0.0 <v1.0.0-0"}]`), 'snippet').canInsert, false);
});

test('TCP version ordering uses BigInt and the missing-patch sentinel, rather than semver prerelease rules', () => {
	const ordered = ['v0.0.0', 'v1.0.0', 'v1.0.0-0', 'v1.0.0-1', 'v1.0.1', 'v1.1.0', 'v2.0.0', 'v9007199254740992.0.0', 'v9007199254740993.0.0'];
	for (let index = 1; index < ordered.length; index++) { assert.equal(compareVersions(parseVersion(ordered[index - 1]), parseVersion(ordered[index])), -1); }
	assert.equal(compareVersions(parseVersion('v1.0.0-0'), parseVersion('v1.0.0-0')), 0);
	for (const text of ['1.0.0', 'v01.0.0', 'v1.00.0', 'v1.0.0-00', 'v1.0.0-beta', 'v1.0.0+build', 'v1.0', ' v1.0.0', `v${'9'.repeat(33)}.0.0`]) { assert.throws(() => parseVersion(text)); }
});

test('AND constraints match exact boundaries and never widen malformed or unsatisfiable ranges', () => {
	const range = parseConstraint('>=v1.0.0-0 <v2.0.0');
	assert.equal(satisfies(parseVersion('v1.0.0'), range), false);
	assert.equal(satisfies(parseVersion('v1.0.0-0'), range), true);
	assert.equal(satisfies(parseVersion('v2.0.0'), range), false);
	assert.equal(satisfies(parseVersion('v0.0.0'), parseConstraint()), true);
	for (const text of ['<v0.0.0', '>v1.0.0 <v1.0.0-0', '=v1.0.0 =v2.0.0', '>v2.0.0 <=v1.0.0']) { assert.equal(parseConstraint(text).empty, true); }
	for (const text of ['', ' ', '^v1.0.0', '~v1.0.0', 'v1.0.0', '>= v1.0.0', '=v1.0.0 || =v2.0.0']) { assert.throws(() => parseConstraint(text)); }
	const max = '9'.repeat(32);
	assert.equal(parseConstraint(`>v0.0.0-${max} <v0.0.1`).empty, true);
	assert.equal(parseConstraint(`>v${max}.${max}.${max}-${max}`).empty, true);
	assert.equal(parseConstraint(`>v0.0.0-${max} <=v0.0.1`).empty, false);
});

test('fingerprints ignore object order, whitespace and format-only migration but preserve arrays, unknown numeric lexemes and file bytes', () => {
	const legacy = doc(',"custom":{"a":1,"b":["first","second"]}', '');
	const current = legacy.upgradeFormat();
	const hash = (document: MetadataDocument, source = 'code\n', semantic = true) => treeFingerprint([
		{ path: 'snippet.json', hash: sha256(document.text), metadata: document }, { path: 'code.cs', hash: sha256(source) },
	], semantic);
	assert.equal(hash(legacy), hash(current));
	assert.notEqual(hash(legacy, 'code\n', false), hash(current, 'code\n', false));
	const reordered = new MetadataDocument(`{"custom":{"b":["first","second"],"a":1},${base},"formatVersion":1}`);
	assert.equal(hash(reordered), hash(current));
	assert.notEqual(hash(new MetadataDocument(current.text.replace('"a":1', '"a":1.0'))), hash(current));
	assert.notEqual(hash(new MetadataDocument(current.text.replace('["first","second"]', '["second","first"]'))), hash(current));
	assert.notEqual(hash(current, 'code\r\n'), hash(current));
	assert.equal(hash(doc('', '"formatVersion":2,')), undefined);
});

test('same UUID/version equal content is grouped; unequal content conflicts and future semantics remain unverified', () => {
	const metadata = readMetadata(doc(), 'snippet');
	assert.equal(groupAssets([{ metadata, semanticHash: 'a' }, { metadata, semanticHash: 'a' }])[0].status, 'identical');
	assert.equal(groupAssets([{ metadata, semanticHash: 'a' }, { metadata, semanticHash: 'b' }])[0].status, 'conflict');
	assert.equal(groupAssets([{ metadata, semanticHash: 'a' }, { metadata }])[0].status, 'unverified');
	assert.equal(groupAssets([{ metadata, semanticHash: 'a' }, { metadata: readMetadata(doc().patchKnown(['version'], 'v1.0.0-0'), 'snippet'), semanticHash: 'a' }]).length, 2);
});

test('UUID comparison normalizes only known ID paths and leaves unknown ID data significant', () => {
	const upper = new MetadataDocument(`{"formatVersion":1,"id":"ABCDEF00-0000-0000-0000-000000000001","name":"Demo","version":"v1.0.0","sources":["code.cs"],"dependencies":[{"id":"ABCDEF00-0000-0000-0000-000000000002","name":"Dep"}],"custom":{"id":"KEEP"}}`);
	const lower = new MetadataDocument(upper.text.replaceAll('ABCDEF', 'abcdef'));
	assert.equal(upper.canonical(true), lower.canonical(true));
	assert.equal(readMetadata(upper, 'snippet').id, 'abcdef00-0000-0000-0000-000000000001');
	assert.notEqual(upper.canonical(true), new MetadataDocument(upper.text.replace('KEEP', 'keep')).canonical(true));
});
