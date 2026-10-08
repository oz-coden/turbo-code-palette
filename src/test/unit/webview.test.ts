import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const script = readFileSync('media/palette-panel.js', 'utf8');
interface Input { name: string; value: string; dataset: { base: string } }
function renderer(fresh: boolean, inputs: Input[], dependency = false): { save: () => Record<string, unknown> } {
	const messages: Record<string, unknown>[] = [], events = new Map<string, (event: unknown) => void>();
	const form = { dataset: { new: String(fresh) }, querySelectorAll: () => inputs,
		querySelector: () => ({ value: 'code.cs' }), addEventListener: (name: string, listener: (event: unknown) => void) => events.set(name, listener) };
	runInNewContext(script, {
		acquireVsCodeApi: () => ({ postMessage: (message: Record<string, unknown>) => messages.push(message) }),
		document: { body: { dataset: { token: 'test-session' } }, querySelector: (selector: string) => selector === '#metadata' ? form : {}, addEventListener: () => {},
			querySelectorAll: (selector: string) => selector === '[data-member]' ? [] : dependency ? [{ dataset: { index: '0', id: 'dependency-id', name: 'Dependency' }, querySelector: () => ({ value: '>=v1.0.0' }) }] : [] },
		window: { addEventListener: () => {} },
	});
	return { save: () => { events.get('submit')!({ preventDefault() {} }); return JSON.parse(JSON.stringify(messages.at(-1))); } };
}
test('production webview script sends prefilled language on creation and typed array fields without editing source code', () => {
	const result = renderer(true, [{ name: 'name', value: 'Selection', dataset: { base: 'Selection' } }, { name: 'version', value: 'v1.0.0', dataset: { base: 'v1.0.0' } }, { name: 'languages', value: 'csharp', dataset: { base: 'csharp' } }, { name: 'sourceName', value: 'code.cs', dataset: { base: 'code.cs' } }]).save();
	assert.equal(result.action, 'save'); assert.equal(result.token, 'test-session'); assert.deepEqual(result.fields, { name: 'Selection', version: 'v1.0.0', languages: ['csharp'] }); assert.equal(result.sourceName, 'code.cs'); assert.equal('sourceCode' in result, false);
});
test('production script omits unchanged optional fields and preserves dependency indexes for lossless structured edits', () => {
	const result = renderer(false, [{ name: 'name', value: 'A', dataset: { base: 'A' } }, { name: 'version', value: 'v1.0.0-0', dataset: { base: 'v1.0.0-0' } }, { name: 'features', value: 'unchanged', dataset: { base: 'unchanged' } }, { name: 'tags', value: 'graph\n tree ', dataset: { base: 'graph' } }], true).save();
	assert.deepEqual(result.fields, { name: 'A', version: 'v1.0.0-0', tags: ['graph', 'tree'] }); assert.deepEqual(result.dependencies, [{ originalIndex: 0, id: 'dependency-id', name: 'Dependency', version: '>=v1.0.0' }]);
});
