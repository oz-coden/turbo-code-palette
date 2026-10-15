import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { CSharpClient } from '../../language/csharpClient';
import { CSharpProvider } from '../../language/csharpProvider';
import { MetadataDocument } from '../../core/metadata/document';
import { patchExports } from '../../application/library';
import { attribution, assertPolicyTransforms } from '../../core/compliance';
import { textCleanPlanAsync } from '../../core/clean/pipeline';

const dll = path.resolve('csharp/Tcp.CSharp/bin/Release/net10.0/Tcp.CSharp.dll'), fixture = path.resolve('csharp/Tcp.ProtocolFixture/bin/Release/net10.0/Tcp.ProtocolFixture.dll');
const docs = (source = 'class A {}') => [{ id: 'a.cs', source }];
const optional = { skip: !existsSync(dll) || !existsSync(fixture) };
test('exports edit preserves unknown child lexemes, open kinds, provenance and existing source/repository fields', () => {
	const original = new MetadataDocument('{"formatVersion":1,"exports":[{"kind":"future-kind","name":"A","future":{"n":9007199254740993}}],"provenance":{"aiUsage":"unknown","custom":1e999},"source":[{"url":"https://example.com/code","extension":-0}],"repository":[{"url":"https://example.com/repo"}]}');
	const edited = patchExports(original, [{ originalIndex: 0, kind: 'class', name: 'B' }, { kind: 'custom-kind', name: 'Open' }]);
	assert.equal(edited.raw(['exports', 0, 'future']), original.raw(['exports', 0, 'future'])); for (const field of ['provenance', 'source', 'repository']) { assert.equal(edited.raw([field]), original.raw([field])); }
	assert.equal(edited.string(['exports', 1, 'kind']), 'custom-kind'); assert.equal(patchExports(edited, [{ originalIndex: 1, kind: 'custom-kind', name: 'Open' }]).node(['exports'])!.children!.length, 1);
	assert.throws(() => patchExports(original, [{ originalIndex: 8, kind: 'class', name: 'Bad' }]));
});
test('AtCoder policy is independent, treats unknown AI origin safely, never treats repository as citation or publication as verified', () => {
	const policy = 'atcoder-20261014', start = '2026-10-15T12:00:00+09:00';
	assert.throws(() => attribution([new MetadataDocument('{"repository":[{"url":"https://example.com/repo"}]}')], policy, start), /AI\/unknown/);
	for (const aiUsage of ['used', 'unknown']) {
		const metadata = new MetadataDocument(JSON.stringify({ provenance: { aiUsage }, source: [{ url: 'https://example.com/code', publication: 'public', publishedAt: '2026-10-14T00:00:00Z' }] }));
		const result = attribution([metadata, metadata], policy, start); assert.deepEqual(result.urls, ['https://example.com/code']); assert.ok(result.warnings.some(w => w.includes('NOT verified')));
		assert.throws(() => attribution([metadata], policy), /requires/); assert.throws(() => attribution([metadata], policy, '2026-10-13T00:00:00Z'), /requires/);
		assert.throws(() => attribution([metadata], policy, '2026-10-15T12:00:00'), /requires/);
	}
	assert.throws(() => attribution([new MetadataDocument(JSON.stringify({ source: [{ url: 'https://example.com/old', publication: 'public', publishedAt: '2026-10-14T00:00:00Z' }, { url: 'https://example.com/unknown' }] }))], policy, start), /every citation/);
	assert.ok(attribution([new MetadataDocument('{"provenance":{"aiUsage":"not-used"}}')], policy, start).warnings.some(w => w.includes('recommended')));
	assert.deepEqual(attribution([new MetadataDocument('{}')], 'none').urls, []);
});
test('AtCoder policy denies future/obfuscating transforms, unsafe attribution URL and malformed source', () => {
	assertPolicyTransforms('none', ['future-transform']); for (const id of ['rename', 'minify', 'future-transform']) { assert.throws(() => assertPolicyTransforms('atcoder-20261014', [id]), /not reviewed/); }
	assertPolicyTransforms('atcoder-20261014', ['remove-tcp-markers', 'remove-comments']);
	for (const source of [[{ url: 'javascript:bad' }], [{ url: 'https://user:pass@example.com' }], [{ url: 'https://example.com/\ncode' }], {}]) { assert.throws(() => attribution([new MetadataDocument(JSON.stringify({ source }))], 'none')); }
});
test('helper absence/request bound does not require a .NET process', async () => {
	const client = new CSharpClient({ dll: '' }); await assert.rejects(client.request('analyze', docs()), /Configure/); assert.equal(client.running, false);
	await assert.rejects(client.request('analyze', docs('x'.repeat(9 * 1024 * 1024))), /size limit/); client.dispose();
});
test('real helper protocol, structured results, reuse, idle shutdown, restart and disposal', optional, async () => {
	const client = new CSharpClient({ dll, idleMs: 100, options: { languageVersion: '12.0' } });
	try {
		assert.equal((await client.request('analyze', docs())).result.exports[0].kind, 'class'); assert.equal(client.running, true);
		assert.equal((await client.request('validate', docs())).result.valid, true);
		await new Promise(resolve => setTimeout(resolve, 200)); assert.equal(client.running, false); assert.match(client.status, /idle/);
		assert.equal((await client.request('analyze', docs())).result.syntaxValid, true);
	} finally { client.dispose(); } assert.equal(client.running, false); await assert.rejects(client.request('analyze', docs()), /disposed/);
});
test('a completed response admits the next sequential request without a helper task-completion race', optional, async () => {
	const client = new CSharpClient({ dll });
	try { for (let index = 0; index < 200; index++) { const result = await client.request('analyze', docs('class Sequential' + index + ' {}')); assert.equal(result.result.exports[0].name, 'Sequential' + index); } }
	finally { client.dispose(); }
});
test('timeout/cancel/concurrency/crash/malformed/size/mismatch failures are bounded and terminate helper', optional, async () => {
	for (const scenario of ['crash', 'hang', 'malformed', 'version', 'id', 'shape', 'oversize', 'stderr']) {
		const client = new CSharpClient({ dll: fixture, timeoutMs: scenario === 'hang' ? 400 : 4000 });
		try { await assert.rejects(client.request('analyze', docs(scenario)), /unavailable/); assert.equal(client.running, false, scenario); } finally { client.dispose(); }
	}
	const client = new CSharpClient({ dll: fixture, timeoutMs: 4000 }), abort = new AbortController();
	try { const pending = client.request('analyze', docs('hang'), {}, abort.signal); await assert.rejects(client.request('analyze', docs()), /busy/); setTimeout(() => abort.abort(), 200); await assert.rejects(pending, /cancelled/); assert.equal(client.running, false); } finally { client.dispose(); }
});
test('Roslyn registry uses the shared async clean plan, one-pass syntax transforms, attribution and literal preservation', optional, async () => {
	const provider = new CSharpProvider(new CSharpClient({ dll, options: { languageVersion: '14.0' } }));
	try {
		const source = '// Source URL: https://example.com/code\nclass A { string S="/*literal*/"; /*ordinary*/ int X; }';
		const plan = await textCleanPlanAsync({ fullText: source, start: 0, end: source.length, language: 'csharp' }, provider.cleanProvider(), { scope: 'file', preset: 'Custom', custom: ['remove-comments', 'normalize-whitespace'], notices: ['Preserve me', 'Preserve me'], extension: '.cs' });
		assert.match(plan.text, /Source URL: https:\/\/example.com\/code/); assert.match(plan.text, /TCP License: Preserve me/); assert.match(plan.text, /\/\*literal\*\//); assert.ok(!plan.text.includes('/*ordinary*/')); assert.ok(Object.isFrozen(plan)); assert.equal(plan.notices.length, 1);
	} finally { provider.dispose(); }
});
