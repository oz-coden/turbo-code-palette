import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { defaultInsertOptions, resolveInsertOptions } from '../../core/insertion/options';
import { MetadataDocument } from '../../core/metadata/document';
import { attachAttribution, collectAttribution } from '../../language/attribution';
import { helperLocation } from '../../language/helperLocation';

test('modes are independent from attribution/markers/preview and policy shows forced URL attribution', () => {
	assert.deepEqual(resolveInsertOptions(defaultInsertOptions, undefined, 'none').options, defaultInsertOptions);
	const result = resolveInsertOptions(defaultInsertOptions, { identityMarkers: true, preview: true }, 'atcoder-20261014');
	assert.equal(result.options.attribution, 'source-urls'); assert.equal(result.options.identityMarkers, true); assert.equal(result.options.preview, true); assert.equal(result.forced.length, 1);
	assert.equal(resolveInsertOptions(defaultInsertOptions, { attribution: 'full' }, 'atcoder-20261014').options.attribution, 'full');
	assert.throws(() => resolveInsertOptions(defaultInsertOptions, { attribution: 'invalid' as never }, 'none'));
});
test('shared attribution exact-deduplicates canonical citations, notices and full details without repository promotion', () => {
	const doc = new MetadataDocument(JSON.stringify({name:'Helper',version:'v1.0.0',authors:[{name:'Author',custom:42}],source:[{url:'https://example.com/code'}],repository:[{url:'https://example.com/repo'}],licenseNotices:[{text:'Keep'}]}));
	const all=collectAttribution([doc,doc],[doc,doc],'full','none'); assert.deepEqual(all.urls,['https://example.com/code']); assert.deepEqual(all.details,['Snippet: Helper v1.0.0 | Authors: Author']); assert.deepEqual(all.notices,['Keep']);
	const absent=collectAttribution([new MetadataDocument('{"source":[{"url":"invalid"}]}')],[doc],'none','none'); assert.deepEqual(absent.urls,[]); assert.deepEqual(absent.notices,['Keep']);
});
test('generic JavaScript/Python/HTML headers keep source text, notices and BOM; unsupported or unsafe comment contexts stop', async () => {
	for (const [language,source] of [['javascript','const x = 1;'],['python','x = 1'],['html','<div>hello</div>']]) {
		const result = await attachAttribution('\uFEFF'+source,language,['Keep'],['https://example.com/code'],undefined,['Snippet: A v1.0.0']); assert.ok(result.startsWith('\uFEFF')); assert.ok(result.endsWith(source)); assert.match(result,/Source URL:/); assert.match(result,/Keep/);
	}
	await assert.rejects(attachAttribution('x','unknown',['Keep'],[]),/cannot be proven/); await assert.rejects(attachAttribution('<div/>','html',['bad -- comment'],[]),/safe HTML/);
	await assert.rejects(attachAttribution('x','javascript',['Keep'],[],undefined,[],{fullText:'`\nx\n`',start:2,end:3,language:'javascript'}),/selection/);
	assert.match(await attachAttribution('x','python',['Keep'],[],undefined,[],{fullText:'a = 1\nx',start:6,end:7,language:'python'}),/^# TCP License: Keep/);
});
test('packaged helper auto discovery is trust-bound, no personal paths or runtime installation required', () => {
	const root=path.resolve('test-extension'); assert.equal(helperLocation(root,'auto','',true),path.join(root,'resources','csharp','Tcp.CSharp.dll'));
	assert.equal(helperLocation(root,'auto','',false),''); assert.equal(helperLocation(root,'disabled','',true),''); assert.equal(helperLocation(root,'custom','relative.dll',true),'');
});
