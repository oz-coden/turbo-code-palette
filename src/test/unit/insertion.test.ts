import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { planDemoInsertion } from '../../core/insertion/plan';
import { DragSessions } from '../../core/insertion/dragSessions';
import { demoSnippets } from '../../phase0/fixtures';

test('cursor respects the actual UTF-16 editor offset', () => {
	assert.equal(planDemoInsertion(demoSnippets[0], 'a😀b', 3, '\n').offset, 3);
});

test('EOF ignores the drop location and plans exactly the document end', () => {
	assert.equal(planDemoInsertion(demoSnippets[1], 'before\nafter\n', 0, '\n').offset, 13);
});

test('source EOL adapts to the target without doubling CR', () => {
	const result = planDemoInsertion({ ...demoSnippets[0], text: 'a\r\nb\rc\n' }, '', 0, '\r\n');
	assert.equal(result.text, 'a\r\nb\r\nc\r\n');
});

test('invalid offsets fail before any editing is possible', () => {
	for (const offset of [-1, 10, 0.5, NaN]) {
		assert.throws(() => planDemoInsertion(demoSnippets[0], 'abc', offset, '\n'), RangeError);
	}
});

test('only locally issued drag URIs resolve', () => {
	const registry = new DragSessions(() => 'demo-1');
	const uri = registry.issue(demoSnippets[0]);
	assert.deepEqual(registry.resolveTransfer(uri), demoSnippets[0]);
	for (const unrelated of ['file:///arbitrary.txt', 'tcp-snippet://drag/forged', `${uri}?extra=1`, `${uri}#fragment`]) {
		assert.equal(registry.resolveTransfer(unrelated), undefined);
	}
});

test('URI lists reject multi-item and mixed payloads', () => {
	let sequence = 0;
	const registry = new DragSessions(() => `demo-${++sequence}`);
	const uri = registry.issue(demoSnippets[0]);
	const second = registry.issue(demoSnippets[1]);
	assert.deepEqual(registry.resolveTransfer(`# comment\r\n${uri}\r\n`), demoSnippets[0]);
	assert.equal(registry.resolveTransfer(`${uri}\r\n${second}`), undefined);
	assert.equal(registry.resolveTransfer(`${uri}\nfile:///other.txt`), undefined);
	assert.equal(registry.resolveTransfer('x'.repeat(4097)), undefined);
});

test('sessions expire at the boundary and are bounded in memory', () => {
	let time = 0;
	let sequence = 0;
	const registry = new DragSessions(() => `demo-${++sequence}`, () => time, 100, 2);
	const first = registry.issue(demoSnippets[0]);
	const second = registry.issue(demoSnippets[0]);
	registry.issue(demoSnippets[1]);
	assert.equal(registry.resolve(first), undefined);
	assert.ok(registry.resolve(second));
	time = 100;
	assert.equal(registry.resolve(second), undefined);
});

test('a registry cannot use another extension instance’s session', () => {
	const first = new DragSessions(() => 'first');
	const second = new DragSessions(() => 'second');
	assert.equal(second.resolve(first.issue(demoSnippets[0])), undefined);
});

test('issued source is an immutable snapshot, and disposal clears it', () => {
	const source = { ...demoSnippets[0] };
	const registry = new DragSessions(() => 'snapshot');
	const uri = registry.issue(source);
	source.text = 'changed';
	assert.equal(registry.resolve(uri)?.text, demoSnippets[0].text);
	registry.clear();
	assert.equal(registry.resolve(uri), undefined);
});
