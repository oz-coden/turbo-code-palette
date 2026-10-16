import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { searchPickerItems } from '../../ui/searchPicker';
import { loadCatalog } from '../../storage/discovery';
import { Library, patchExports } from '../../application/library';
import { MetadataDocument } from '../../core/metadata/document';
import { readMetadata } from '../../core/metadata/semantics';
import { ChangeTracker } from '../../application/changes';
import { CSharpClient } from '../../language/csharpClient';
import { changedRange, receiptSurvives } from '../../core/insertion/receiptTracking';
import { applyText } from '../../core/insertion/textPlan';
import { markSource } from '../../language/sourceMarker';
import { removeCleanMarkers } from '../../language/cleanMarkers';
import { attachAttribution } from '../../language/attribution';

const fixture = { scope: 'global' as const, path: path.resolve('qa/fixtures/library') };
test('search free text keeps Apply visible and conditions remain composable/changeable/clearable', async () => {
	const { snippetGroups: groups } = await loadCatalog([fixture]);
	const first = searchPickerItems(groups, 'Greeting');
	assert.equal(first[0].action, 'apply'); assert.equal(first[0].query, 'Greeting'); assert.ok(first.every(item => item.alwaysShow));
	const language = searchPickerItems(groups, 'lang:py').find(item => item.label === 'lang:"python"')!;
	assert.equal(language.query, 'lang:"python" ');
	const tags = searchPickerItems(groups, language.query!).find(item => item.label === 'tag:"qa"')!;
	assert.equal(tags.query, 'lang:"python" tag:"qa" ');
	assert.match(searchPickerItems(groups, tags.query!)[0].label, /1 items/);
	assert.equal(searchPickerItems(groups, tags.query!).find(item => item.action === 'clear')!.query, '');
	const replacement = searchPickerItems(groups, 'Greeting lang:ja').find(item => item.label === 'lang:"javascript"');
	assert.equal(replacement?.query, 'Greeting lang:"javascript" ');
	assert.equal(searchPickerItems(groups, 'author:"Synthetic QA A').find(item => item.label === 'author:"Synthetic QA Author"')?.query, 'author:"Synthetic QA Author" ');
	assert.ok(searchPickerItems(groups, 'tag:qa ').some(item => item.label.startsWith('lang:')));
	assert.equal(searchPickerItems(groups, 'unknown:value')[0].action, 'error');
});
test('exports optional qualifier omission removes known keys while keeping unknown fields and required names', () => {
	const doc = new MetadataDocument('{"formatVersion":1,"exports":[{"kind":"class","name":"Foo","namespace":"Demo","container":"Outer","signature":"Demo.Foo","future":1e999}],"test":"test"}');
	const changed = patchExports(doc, [{ originalIndex: 0, kind: 'class', name: 'Foo' }]);
	for (const key of ['namespace', 'container', 'signature']) { assert.equal(changed.node(['exports', 0, key]), undefined); }
	assert.equal(changed.raw(['exports', 0, 'future']), '1e999'); assert.equal(changed.string(['test']), 'test');
	assert.throws(() => patchExports(doc, [{ originalIndex: 0, kind: 'class', symbol: 'Foo' } as never]), /Invalid/);
});
test('external byte restoration clears pending and rearms notification, without clearing a changed root', async () => {
	const snapshot = await loadCatalog([fixture]), empty = await loadCatalog([]); let current = empty, notices = 0, badge = false;
	const tracker = new ChangeTracker(() => snapshot, async () => current, async () => { notices++; }, value => { badge = value; });
	try {
		await tracker.check(); assert.equal(tracker.pending, true); assert.equal(notices, 1);
		current = snapshot; await tracker.check(); assert.equal(tracker.pending, false); assert.equal(badge, false);
		current = empty; await tracker.check(); assert.equal(notices, 2);
		await tracker.changed(); current = snapshot; await tracker.check(); assert.equal(tracker.pending, true); assert.equal(badge, true);
	} finally { tracker.dispose(); }
});
for (const action of ['dispose', 'cancel', 'abort'] as const) {
	test('helper startup ' + action + ' before lstat resolves never starts a child', async () => {
		let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; }), abort = new AbortController();
		const inspect = async () => { await gate; return fs.lstat('package.json'); };
		const client = new CSharpClient({ dll: path.resolve('not-executed.dll') }, inspect);
		const promise = client.request('analyze', [{ id: 'a.cs', source: 'class A {}' }], {}, abort.signal);
		if (action === 'dispose') { client.dispose(); } else if (action === 'cancel') { client.cancel(); } else { abort.abort(); }
		release(); await assert.rejects(promise, /disposed|cancelled/i); assert.equal(client.running, false); client.dispose();
	});
}
test('owned header/placement transitions preserve full-snapshot receipt lineage, not arbitrary text matches', () => {
	const body = 'class Dep {}', before = 'namespace N;\n' + body + '\n', insertion = { start: before.length, end: before.length, text: 'class Other {}\n' };
	const placed = applyText(before, [insertion]), after = '// Source URL: https://example.com/other\n' + placed;
	assert.equal(receiptSurvives(before, after, body, [{ before, after: placed, edits: [insertion] }, { before: placed, after, edits: changedRange(placed, after) }]), true);
	const replaced = [{ start: before.indexOf(body), end: before.indexOf(body) + body.length, text: body }];
	assert.equal(receiptSurvives(before, before, body, [{ before, after: before, edits: replaced }]), false);
	assert.equal(receiptSurvives(before, after, body, []), false);
	const duplicate = before + body;
	assert.equal(receiptSurvives(before, duplicate, body, [{ before, after: duplicate, edits: [{ start: before.length, end: before.length, text: body }] }]), false);
	for (const [a, b] of [['x😀y', 'x😃y'], ['😀', '// header\n😀'], ['a', 'b']]) { assert.equal(applyText(a, changedRange(a, b)), b); }
});
test('generic marker restrictions are intentional; ordinary full-file attribution is not blocked by operators/quotes', async () => {
	for (const [language, prefix, body] of [['javascript', '// normal\n', 'const text = "hello";'], ['python', '# normal\n', 'value = "hello"'], ['csharp', '// normal\n', 'class A { string S="hello"; }']]) {
		assert.equal(markSource({ id: '71000000-0000-4000-8000-000000000011', version: 'v1.0.0' }, body, language, prefix, prefix.length, prefix.length, '\n'), undefined);
		assert.match(await attachAttribution(prefix + body, language, ['Keep'], ['https://example.com/code']), /Source URL:/);
	}
	const marked = markSource({ id: '71000000-0000-4000-8000-000000000011', version: 'v1.0.0' }, 'value = 1\n', 'python', '', 0, 0, '\n')!;
	const fullText = '# ordinary comment\n' + marked;
	const result = removeCleanMarkers(fullText, { fullText, start: 0, end: fullText.length, language: 'python' });
	assert.ok(!result.text.includes('TCP BEGIN')); assert.equal(result.warnings.length, 0); assert.ok(result.text.startsWith('# ordinary comment\n'));
});
test('proven JS/Python line comments do not taint later plain markers, but uncertain literals never recover', () => {
	for (const [language, prefix, body] of [['javascript', '// ordinary "quoted" comment\n', 'let value = 1;\n'], ['python', '# ordinary "quoted" comment\n', 'value = 1\n']]) {
		const identity = { id: '71000000-0000-4000-8000-000000000011', version: 'v1.0.0' };
		const marked = markSource(identity, body, language, prefix, prefix.length, prefix.length, '\n')!; assert.ok(marked);
		const fullText = prefix + marked; assert.ok(!removeCleanMarkers(fullText, { fullText, start: 0, end: fullText.length, language }).text.includes('TCP BEGIN'));
		for (const unsafe of [language === 'python' ? 'x = """\n' : 'const x = `\n', prefix + '/* uncertain\n', prefix + 'value = "text"\n']) {
			const text = unsafe + marked; assert.equal(removeCleanMarkers(text, { fullText: text, start: 0, end: text.length, language }).text, text);
		}
	}
});
test('unknown test metadata survives raw load/reload and structured edits; self dependency stays invalid', async () => {
	const base = path.resolve('.vscode-test/qa-feedback-unit'); await fs.mkdir(base, { recursive: true }); const directory = await fs.mkdtemp(path.join(base, 'case-'));
	try {
		const root = { scope: 'global' as const, path: directory }; await fs.cp(fixture.path, directory, { recursive: true });
		const filename = path.join(directory, 'QA-Web/Html/snippet.json'), raw = JSON.parse(await fs.readFile(filename, 'utf8')); raw.test = 'test'; await fs.writeFile(filename, JSON.stringify(raw));
		const library = new Library(() => [root]); await library.reload(); let asset = library.catalog.snapshot!.snippets.find(asset => asset.metadata.id === raw.id)!;
		await library.editSnippet(asset, { version: 'v1.0.1', description: 'Known field edit' }); await library.reload(); asset = library.catalog.snapshot!.snippets.find(asset => asset.metadata.id === raw.id)!;
		assert.equal(asset.metadata.document.string(['test']), 'test'); const before = await fs.readFile(filename, 'utf8');
		await assert.rejects(library.editSnippet(asset, { version: 'v1.0.2' }, [{ id: raw.id, name: raw.name }]), /Invalid|metadata|dependency/i);
		assert.equal(await fs.readFile(filename, 'utf8'), before);
		const invalid = readMetadata(new MetadataDocument(JSON.stringify({ ...raw, dependencies: [{ id: raw.id, name: raw.name }] })), 'snippet');
		assert.equal(invalid.canInsert, false); assert.ok(invalid.blockedFeatures.has('dependencies'));
	} finally { assert.equal(path.dirname(directory), base); await fs.rm(directory, { recursive: true, force: true }); }
});
