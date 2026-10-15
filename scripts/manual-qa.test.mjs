import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { prepareManualQa } from './prepare-manual-qa.mjs';
const require = createRequire(import.meta.url);
const { Library } = require('../out/application/library.js');
const { resolveClosure } = require('../out/core/dependency/resolver.js');
const { dependencyOrder } = require('../out/core/dependency/order.js');
const { templateInputs, substitute } = require('../out/core/template/substitution.js');
const { nativeStore } = require('../out/storage/store.js');
const { readTree, byteFingerprint } = require('../out/storage/transaction.js');
const { encodeArchive, decodeArchive } = require('../out/storage/archive.js');
const { inspectPackTree } = require('../out/storage/packValidation.js');

test('preparation creates fresh isolated runs without overwriting existing QA data or profiles', async () => {
  const first = await prepareManualQa();
  const sentinel = path.join(first, 'tutorial/keep.txt'); await fs.writeFile(sentinel, 'Retain previous manual QA data.');
  const settingsFile = path.join(first, 'tutorial-profile/User/settings.json');
  const before = await fs.readFile(settingsFile, 'utf8'), second = await prepareManualQa();
  assert.notEqual(first, second); assert.equal(await fs.readFile(sentinel, 'utf8'), 'Retain previous manual QA data.');
  assert.equal(await fs.readFile(settingsFile, 'utf8'), before);
  await assert.rejects(fs.access(path.join(first, 'tutorial/.snippets')));
  assert.equal((await fs.readdir(path.join(first, 'global-tutorial'))).length, 0);
  const config = JSON.parse(before); assert.equal(config['turboCodePalette.csharpProvider'], 'disabled');
  assert.equal(config['turboCodePalette.globalRoot'], path.join(first, 'global-tutorial'));
  assert.equal(config['turboCodePalette.compliancePolicy'], 'none');
  await fs.access(path.join(first, 'reports/checklist.md')); await fs.access(path.join(first, 'variants/QA-Conflict/pack.json'));
});

test('synthetic baseline loads, resolves dependencies/templates and round-trips both Packs through validated ZIP', async () => {
  const run = await prepareManualQa(), root = { scope: 'workspace', path: path.join(run, 'lab/.snippets'), workspaceId: 'manual-qa' };
  const library = new Library(() => [root]); const snapshot = await library.reload();
  assert.equal(snapshot.packs.length, 2); assert.equal(snapshot.snippets.length, 9); assert.deepEqual(snapshot.diagnostics, []);
  assert.ok(snapshot.snippets.every(asset => asset.usable)); assert.ok(snapshot.snippetGroups.every(group => group.status === 'identical'));
  const answer = snapshot.snippets.find(asset => asset.metadata.name === 'QA Answer');
  const closure = resolveClosure([answer], snapshot.snippets);
  assert.deepEqual(dependencyOrder(closure.members).map(asset => asset.metadata.name), ['QA Double', 'QA Answer']);
  const template = snapshot.snippets.find(asset => asset.metadata.name === 'QA Named Template');
  const source = (await library.source(template, 'template.js')).toString('utf8');
  const variables = templateInputs(template.metadata.document, [source]);
  const expanded = substitute(source, variables, new Map([['NAME', 'qaMessage'], ['VALUE', '$&']]));
  assert.match(expanded, /const qaMessage = "\$&"/); assert.ok(!expanded.includes('{{'));
  for (const pack of snapshot.packs) {
    const tree = await readTree(nativeStore(root), pack.relativePath), decoded = await decodeArchive(await encodeArchive(tree));
    assert.equal(byteFingerprint(decoded), byteFingerprint(tree));
    await inspectPackTree(decoded, { scope: 'global', path: 'synthetic-staging' }, true, true);
  }
  await assert.rejects(decodeArchive(await fs.readFile(path.join(run, 'invalid-pack.tcp-sp'))));
  await fs.cp(path.join(run, 'variants/QA-Conflict'), path.join(root.path, 'QA-Conflict'), { recursive: true, errorOnExist: true, force: false });
  const conflicted = await library.reload();
  assert.equal(conflicted.snippetGroups.filter(group => group.status === 'conflict').length, 1);
});

test('optional Roslyn fixture remains valid for semantic discovery, placement and compiled Bundle', { skip: !existsSync('csharp/Tcp.CSharp/bin/Release/net10.0/Tcp.CSharp.dll') }, async () => {
  const { CSharpClient } = require('../out/language/csharpClient.js');
  const { csharpBundleRoots, csharpBundleText } = require('../out/application/csharpBundle.js');
  const run = await prepareManualQa(), root = { scope: 'workspace', path: path.join(run, 'lab/.snippets'), workspaceId: 'manual-qa' };
  const library = new Library(() => [root]); await library.reload();
  const client = new CSharpClient({ dll: path.resolve('csharp/Tcp.CSharp/bin/Release/net10.0/Tcp.CSharp.dll'), timeoutMs: 15000 });
  try {
    const current = await fs.readFile(path.join(run, 'lab/csharp/bundle.cs'), 'utf8');
    const roots = await csharpBundleRoots(library, current, { client }); assert.deepEqual(roots.map(asset => asset.metadata.name), ['QA CSharp Dep']);
    const result = await csharpBundleText(library, current, roots, { client }); assert.match(result.text, /class Dep/);
    assert.equal((await client.request('validate', [{ id: 'bundle.cs', source: result.text }])).result.valid, true);
    const target = await fs.readFile(path.join(run, 'lab/csharp/namespace.cs'), 'utf8');
    const dep = await fs.readFile(path.join(root.path, 'QA-CSharp/Dep/Dep.cs'), 'utf8');
    assert.equal((await client.request('place', [{ id: 'target.cs', source: target }], { source: dep, offset: target.length, targets: ['namespace'] })).result.context, 'file-scoped namespace');
    const member = await fs.readFile(path.join(root.path, 'QA-CSharp/Member/member.cs'), 'utf8');
    assert.equal((await client.request('place', [{ id: 'target.cs', source: target }], { source: member, offset: target.indexOf('{') + 1, targets: ['member'] })).result.context, 'type/member');
    const clean = await fs.readFile(path.join(run, 'lab/csharp/clean.cs'), 'utf8');
    await client.request('validate', [{ id: 'clean.cs', source: clean }]);
  } finally { client.dispose(); }
});
