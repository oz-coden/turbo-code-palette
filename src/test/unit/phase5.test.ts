import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CleanProviders } from '../../language/cleanProvider';
import { removeCleanMarkers, relevantMarkerIdentities, renderLicenseHeader } from '../../language/cleanMarkers';
import { markSource } from '../../language/sourceMarker';
import { collectNotices, textCleanPlan, cleanFragment, availableTransforms } from '../../core/clean/pipeline';
import { MetadataDocument } from '../../core/metadata/document';
import type { CleanFragment, CleanLanguageProvider } from '../../core/clean/types';
import { Library } from '../../application/library';
import { bundleCandidates, bundleClosure, bundleReviewPlan } from '../../application/cleanBundle';
import { publishCleanOutput, validateCleanDestination } from '../../storage/cleanOutput';

const uuid = (n: number) => '50000000-0000-0000-0000-' + String(n).padStart(12, '0');
const fragment = (text: string, language = 'csharp'): CleanFragment => ({ fullText: text, start: 0, end: text.length, language });
const markers = (body = 'int VALUE = 1;\n', language = 'csharp', eol = '\n') => markSource({ id: uuid(1), version: 'v1.0.0' }, body, language, '', 0, 0, eol)!;
const providers = new CleanProviders();
async function sandbox(run: (base: string) => Promise<void>): Promise<void> {
	const parent = path.resolve('.vscode-test/phase5-unit'); await fs.mkdir(parent, { recursive: true }); const base = await fs.mkdtemp(path.join(parent, 'case-'));
	try { await run(base); } finally { assert.equal(path.dirname(base), parent); await fs.rm(base, { recursive: true, force: true }); }
}
async function seed(base: string, name = 'Pack', definitions = [{ n: 1, dependencies: [2] }, { n: 2, dependencies: [] }], version = 'v1.0.0'): Promise<void> {
	const pack = path.join(base, name); await fs.mkdir(pack, { recursive: true }); await fs.writeFile(path.join(pack, 'pack.json'), JSON.stringify({ formatVersion: 1, id: uuid(name === 'Pack' ? 0 : 10), name, version }));
	for (const definition of definitions) { const directory = path.join(pack, String(definition.n)); await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'snippet.json'), JSON.stringify({ formatVersion: 1, id: uuid(definition.n), name: 'Snippet-' + definition.n, version, sources: ['code.cs'], exports: [{ kind: 'type', name: 'Export' + definition.n }], dependencies: definition.dependencies.map(n => ({ id: uuid(n), name: 'Snippet-' + n, version: '=' + version })), licenseNotices: [{ text: 'Notice' }, { text: 'Notice' }] })); await fs.writeFile(path.join(directory, 'code.cs'), 'class Export' + definition.n + ' {}\n'); }
}

test('Readable and Competitive remove only proven TCP comment contents, retaining CRLF and all code whitespace', () => {
	const original = markers('int VALUE = 1;\r\n', 'csharp', '\r\n'); assert.ok(original);
	for (const preset of ['Readable', 'Competitive'] as const) { const plan = textCleanPlan(fragment(original), providers.get('csharp'), { scope: 'file', preset, notices: [], extension: '.cs' }); assert.equal(plan.text, '\r\nint VALUE = 1;\r\n\r\n'); assert.deepEqual(plan.transforms, ['remove-tcp-markers', 'preserve-license-notices']); assert.equal(plan.warnings.length, 0); assert.ok(Object.isFrozen(plan)); assert.ok(Object.isFrozen(plan.notices)); }
	assert.equal(original, markers('int VALUE = 1;\r\n', 'csharp', '\r\n'));
});
test('safe Python marker lines are removed, preserving ordinary source text', () => { const text = markers('value = 1\n', 'python'); assert.equal(removeCleanMarkers(text, fragment(text, 'python')).text, '\nvalue = 1\n\n'); });
for (const [language, prefix] of [['csharp', 'var s = """\n'], ['csharp', 'var s = @"\n'], ['javascript', 'const x = `\n'], ['javascriptreact', '<section>\n'], ['python', 'value = """\n'], ['cpp', 'auto x = R"tag(\n'], ['java', 'String s = """\n']]) {
	test('literal/markup context retains marker-looking text in ' + language + ' ' + prefix.trim(), () => { const text = prefix + markers(); const result = removeCleanMarkers(text, fragment(text, language)); assert.equal(result.text, text); assert.ok(result.warnings.length); });
}
test('Java Unicode preprocessing, C continuation, Unicode separators, directives and ordinary comment pragmas prevent unsafe recovery', () => {
	for (const prefix of ['// ' + String.fromCharCode(92) + 'u000a String s = """\n', '// continued' + String.fromCharCode(92) + '\n', '// separator\u2028 "open\n', '#if DIRECTIVE\n', '//go:noinline\n', '/* open block\n']) { const text = prefix + markers(); assert.equal(removeCleanMarkers(text, fragment(text, 'java')).text, text); }
});
test('partial Selection uses full document context; orphan/malformed/nested marker candidates are retained with warning', () => {
	const text = markers(), start = text.indexOf('int VALUE'), end = start + 'int VALUE = 1;'.length;
	assert.equal(relevantMarkerIdentities({ ...fragment(text), start, end })[0].id, uuid(1));
	const literal = 'var text = """\n' + text; const selected = { ...fragment(literal), start: literal.indexOf('// TCP'), end: literal.length }; assert.equal(removeCleanMarkers(literal.slice(selected.start), selected).text, literal.slice(selected.start));
	for (const input of [text.split('\n')[0], text.replace('"contentHash"', '"unknown"'), text.split('\n')[0] + '\n' + text]) { const result = removeCleanMarkers(input, fragment(input)); assert.equal(result.text, input); assert.ok(result.warnings.length); }
	const partial = { ...fragment(text), end: text.indexOf('int VALUE') }; assert.equal(removeCleanMarkers(text.slice(0, partial.end), partial).text, text.slice(0, partial.end));
});
test('unsupported languages and Custom no-transforms preserve source bytes without ordinary comment/whitespace/minification fallback', () => {
	const text = '\uFEFF  // comment\r\n\t string = " a  b "\r\n\r\n';
	for (const language of ['plaintext', 'html', 'unknown']) { const result = textCleanPlan(fragment(text, language), providers.get(language), { scope: 'file', preset: 'Competitive', notices: [], extension: '.txt' }); assert.equal(result.text, text); assert.equal(availableTransforms(providers.get(language)).length, 0); }
	assert.equal(textCleanPlan(fragment(text), providers.get('csharp'), { scope: 'file', preset: 'Custom', custom: [], notices: [], extension: '.cs' }).text, text);
	for (const id of ['remove-comments', 'unused-imports', 'unused-types', 'rename-identifiers', 'shorten-modifiers', 'minify', 'code-golf']) { assert.throws(() => cleanFragment(fragment(text), providers.get('csharp'), 'Custom', [id]), /Unsupported/); }
});
test('provider capabilities are explicit, transforms run in order and registration disposes without changing fallback', () => {
	const provider: CleanLanguageProvider = { id: 'test-provider', capabilities: new Set(['test']), presets: { Readable: ['one', 'two'], Competitive: [] }, transforms: [{ id: 'one', label: '1', capability: 'test', apply: text => ({ text: text + '1', warnings: [] }) }, { id: 'two', label: '2', capability: 'test', apply: text => ({ text: text + '2', warnings: [] }) }, { id: 'denied', label: 'Denied', capability: 'absent', apply: () => { throw new Error('must not run'); } }] };
	const registry = new CleanProviders(), registration = registry.register('test', provider); assert.equal(cleanFragment(fragment('A', 'test'), registry.get('test'), 'Readable').text, 'A12'); assert.equal(availableTransforms(provider).length, 2); assert.throws(() => cleanFragment(fragment('A'), provider, 'Custom', ['denied']), /Unsupported/); assert.throws(() => registry.register('test', provider), /already/); registration.dispose(); assert.equal(registry.get('test').transforms.length, 0);
});
test('text output refuses binary/NUL and split surrogate selections instead of silently changing bytes', () => {
	for (const text of ['\0binary', '\ud83d']) { assert.throws(() => textCleanPlan(fragment(text), providers.get('csharp'), { scope: 'selection', preset: 'Readable', notices: [], extension: '.cs' }), /NUL|surrogate/); }
});
test('license text dedup is exact and lossless; malformed metadata stops rather than dropping notices', () => {
	const document = new MetadataDocument('{"licenseNotices":[{"text":"One\nTwo"},{"text":"One\nTwo","unknown":1e999},{"text":"One\r\nTwo"}]}'.replaceAll('\n', '\\n').replaceAll('\r', '\\r'));
	assert.deepEqual(collectNotices([document, document]), ['One\nTwo', 'One\r\nTwo']);
	for (const text of ['{"licenseNotices":false}', '{"licenseNotices":[{}]}', '{"licenseNotices":[{"text":42}]}']) { assert.throws(() => collectNotices([new MetadataDocument(text)]), /licenseNotices/); }
	const plan = textCleanPlan(fragment('int VALUE = 1;\n'), providers.get('csharp'), { scope: 'file', preset: 'Competitive', notices: ['One\nTwo', 'One\nTwo'], extension: '.cs' }); assert.equal(plan.text, '// One\n// Two\nint VALUE = 1;\n'); assert.deepEqual(plan.notices, ['One\nTwo']);
});
test('license header rejects unsafe Java escapes, C trigraphs, Python encoding/shebang and Go build directives', () => {
	for (const [language, text, notice] of [['java', 'class X {}', 'Escape ' + String.fromCharCode(92) + 'u000a'], ['cpp', 'int x;', '??/'], ['python', '#!/usr/bin/python\nx=1', 'Notice'], ['python', '# coding: utf-8\nx=1', 'Notice'], ['python', 'x=1', 'coding: latin-1'], ['go', 'package main', '+build windows'], ['csharp', 'int x;', 'separator\u2028text']]) { assert.equal(renderLicenseHeader([notice], fragment(text, language)), undefined); }
	assert.throws(() => textCleanPlan(fragment('data', 'json'), providers.get('json'), { scope: 'file', preset: 'Readable', notices: ['Notice'], extension: '.json' }), /cannot be safely/);
});
test('Bundle text hits remain unverified even inside strings/comments; only explicit selection builds Pack-internal dependency-first review JSON', async () => sandbox(async base => {
	await seed(base); const root = { scope: 'global' as const, path: base }, library = new Library(() => [root]); await library.reload(); const asset = library.catalog.snapshot!.snippets.find(asset => asset.metadata.id === uuid(1))!;
	const candidates = bundleCandidates('"Export1" // Export2', library.catalog.snapshot!); assert.equal(candidates.length, 2); assert.ok(candidates.every(candidate => candidate.confirmed === false)); assert.throws(() => bundleClosure(library, []), /explicitly/);
	const result = await bundleReviewPlan(library, fragment('Export1 user code'), 'Readable', [asset], providers); const review = JSON.parse(result.plan.text); assert.equal(review.executable, false); assert.deepEqual(review.licenseNotices, ['Notice']); assert.deepEqual(review.files.filter((file: { asset?: unknown }) => file.asset).map((file: { asset: { id: string } }) => file.asset.id), [uuid(2), uuid(1)]); assert.equal(review.files[0].text, 'Export1 user code'); assert.ok(!result.plan.text.includes(base)); assert.ok(result.plan.reviewOnly);
}));
test('Bundle reuses shared resolver for SCC, missing closure, constraints and global content conflicts', async () => sandbox(async base => {
	await seed(base, 'Pack', [{ n: 1, dependencies: [2] }, { n: 2, dependencies: [1] }]); const library = new Library(() => [{ scope: 'global', path: base }]); await library.reload(); assert.deepEqual(bundleClosure(library, [library.catalog.snapshot!.snippets[0]]).assets.map(asset => asset.metadata.id), [uuid(1), uuid(2)]);
	await seed(base, 'Other', [{ n: 2, dependencies: [] }], 'v2.0.0'); await library.reload(); const newer = library.catalog.snapshot!.snippets.find(asset => asset.metadata.version!.text === 'v2.0.0')!; assert.throws(() => bundleClosure(library, [library.catalog.snapshot!.snippets.find(asset => asset.metadata.id === uuid(1))!, newer]), /One Pack|constraints/);
	await fs.writeFile(path.join(base, 'Other/2/snippet.json'), (await fs.readFile(path.join(base, 'Other/2/snippet.json'), 'utf8')).replace('v2.0.0', 'v1.0.0')); await fs.writeFile(path.join(base, 'Other/2/code.cs'), 'DIFFERENT'); await library.reload(); assert.throws(() => bundleClosure(library, [library.catalog.snapshot!.snippets.find(asset => asset.relativePath === 'Pack/1')!]), /content conflict/);
	await fs.rm(path.join(base, 'Pack/2'), { recursive: true }); await library.reload(); assert.throws(() => bundleClosure(library, [library.catalog.snapshot!.snippets.find(asset => asset.relativePath === 'Pack/1')!]), /closure/);
}));
test('Bundle bounds JSON escaping expansion before accumulating source output', async () => sandbox(async base => {
	await seed(base); const library = new Library(() => [{ scope: 'global', path: base }]); await library.reload();
	await assert.rejects(bundleReviewPlan(library, fragment('\u0001'.repeat(6 * 1024 * 1024), 'plaintext'), 'Readable', [library.catalog.snapshot!.snippets[0]], providers), /serialized byte limit/);
}));
test('Save As publishes exact final text once, refuses originals/library/existing case-Unicode aliases and preserves external files', async () => sandbox(async base => {
	const source = path.join(base, 'source.cs'), library = path.join(base, 'library'); await fs.writeFile(source, 'ORIGINAL'); await fs.mkdir(library); const protection = { sourceFiles: [source], libraryRoots: [library] }, destination = path.join(base, 'copy.cs');
	await publishCleanOutput(destination, 'FINAL\r\n', protection, async () => {}); assert.equal(await fs.readFile(destination, 'utf8'), 'FINAL\r\n');
	for (const candidate of [source, path.join(library, 'new.cs'), destination, path.join(base, 'SOURCE.CS')]) { await assert.rejects(publishCleanOutput(candidate, 'WRONG', protection, async () => {})); }
	await fs.writeFile(path.join(base, 'é.cs'), 'UNICODE'); await assert.rejects(validateCleanDestination(path.join(base, 'e\u0301.cs'), protection), /Existing/); assert.equal(await fs.readFile(source, 'utf8'), 'ORIGINAL');
}));
test('Save As rejects symlink/junction parents and hardlink aliases without touching source', async () => sandbox(async base => {
	const original = path.join(base, 'source.cs'), alias = path.join(base, 'alias.cs'), real = path.join(base, 'real'), link = path.join(base, 'linked'); await fs.writeFile(original, 'ORIGINAL'); await fs.link(original, alias); await fs.mkdir(real); await fs.symlink(real, link, process.platform === 'win32' ? 'junction' : 'dir');
	const protection = { sourceFiles: [original], libraryRoots: [] }; await assert.rejects(publishCleanOutput(alias, 'WRONG', protection, async () => {})); await assert.rejects(publishCleanOutput(path.join(link, 'new.cs'), 'WRONG', protection, async () => {}), /Links/); assert.equal(await fs.readFile(original, 'utf8'), 'ORIGINAL'); assert.deepEqual(await fs.readdir(real), []);
}));
test('failed write, stale validation and competing destination leave no partial copy and clean owned scratch', async () => sandbox(async base => {
	const protection = { sourceFiles: [], libraryRoots: [] }, destination = path.join(base, 'copy.cs');
	await assert.rejects(publishCleanOutput(destination, 'FINAL', protection, async () => {}, { beforeWrite: async () => { throw new Error('write failure'); } }), /write failure/); await assert.rejects(fs.stat(destination));
	let validations = 0; await assert.rejects(publishCleanOutput(destination, 'FINAL', protection, async () => { if (++validations > 1) { throw new Error('stale'); } }), /stale/); await assert.rejects(fs.stat(destination));
	await assert.rejects(publishCleanOutput(destination, 'FINAL', protection, async () => {}, { beforePublish: async () => { await fs.writeFile(destination, 'OTHER WRITER'); } }), /Existing/); assert.equal(await fs.readFile(destination, 'utf8'), 'OTHER WRITER'); assert.deepEqual((await fs.readdir(base)).filter(name => name.startsWith('.tcp-clean-')), []);
}));
