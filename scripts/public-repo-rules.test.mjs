import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanPublicText, forbiddenPublicFile } from './public-repo-rules.mjs';

test('URLs and portable workspace variables are not personal paths', () => {
  assert.deepEqual(scanPublicText('https://example.com ${workspaceFolder}/dist'), []);
});

test('machine paths and credentials are flagged without returning their values', () => {
  const privatePath = ['C', ':', '/', 'Users', '/', 'synthetic', '/', 'file'].join('');
  const credential = ['api', '_key', ' = "', 'synthetic-value', '"'].join('');
  assert.ok(scanPublicText(privatePath).some(x => x.category === 'absolute-or-home-path'));
  assert.ok(scanPublicText(credential).some(x => x.category === 'credential-assignment'));
  assert.ok(!JSON.stringify(scanPublicText(credential)).includes('synthetic-value'));
});

test('required source, lockfile, fixtures and portable IDE files stay publishable', () => {
  for (const file of ['src/extension.ts', 'package-lock.json', 'docs/product-spec.md', '.vscode/launch.json', 'src/test/fixtures/example.cs', 'src/test/fixtures/pack.tcp-sp', 'src/test/fixtures/.snippets/Default/pack.json', '.env.example']) {
    assert.equal(forbiddenPublicFile(file), false, file);
  }
});

test('tracked generated files are forbidden even when gitignore would hide them', () => {
  for (const file of ['node_modules/package/index.js', 'csharp/Tcp.CSharp/bin/a.dll', 'csharp/Tcp.CSharp/obj/a.json', '.vscode-test/logs/log.txt', '.env.production', '.snippets/Default/snippet.json', 'nested-workspace/.snippets/Default/pack.json', 'dist/extension.js']) {
    assert.equal(forbiddenPublicFile(file), true, file);
  }
});
