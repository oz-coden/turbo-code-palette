import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Never follow an existing QA storage link into a personal directory.
async function realDirectory(directory) {
  try { await fs.mkdir(directory); } catch (error) { if (error.code !== 'EEXIST') { throw error; } }
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) { throw new Error('QA storage must be a normal directory.'); }
}

export async function prepareManualQa() {
  const repositoryReal = await fs.realpath(repository);
  const parent = path.join(repositoryReal, '.vscode-test'); await realDirectory(parent);
  const base = path.join(parent, 'manual-qa'); await realDirectory(base);
  const run = await fs.mkdtemp(path.join(base, 'run-'));
  const fixture = path.join(repositoryReal, 'qa', 'fixtures');
  // This only copies tracked synthetic input. It never reads VS Code's real profile/library.
  for (const name of ['tutorial', 'lab']) {
    await fs.cp(path.join(fixture, 'workspace'), path.join(run, name), { recursive: true, errorOnExist: true, force: false, dereference: false });
    if (name === 'lab') { await fs.cp(path.join(fixture, 'library'), path.join(run, name, '.snippets'), { recursive: true, errorOnExist: true, force: false, dereference: false }); }
    const profile = path.join(run, name + '-profile', 'User'); await fs.mkdir(profile, { recursive: true });
    const globalRoot = path.join(run, 'global-' + name); await fs.mkdir(globalRoot);
    await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({
      'window.title': 'TCP Manual QA — ' + name + ' — ${activeEditorShort}',
      'workbench.startupEditor': 'none', 'extensions.autoUpdate': false,
      'turboCodePalette.globalRoot': globalRoot,
      'turboCodePalette.csharpProvider': name === 'tutorial' ? 'disabled' : 'auto',
      'turboCodePalette.compliancePolicy': 'none', 'turboCodePalette.sourceAttribution': 'none',
      'turboCodePalette.sourceMarkers': false, 'turboCodePalette.previewBeforeInsert': false,
    }, null, 2) + '\n', { flag: 'wx' });
  }
  await fs.cp(path.join(fixture, 'variants'), path.join(run, 'variants'), { recursive: true, errorOnExist: true, force: false });
  await fs.mkdir(path.join(run, 'extensions')); await fs.mkdir(path.join(run, 'exports')); await fs.mkdir(path.join(run, 'reports'));
  await fs.writeFile(path.join(run, 'invalid-pack.tcp-sp'), 'Synthetic QA invalid archive: deliberately not a ZIP.\n', { flag: 'wx' });
  for (const [source, target] of [['manual-qa.md', 'checklist.md'], ['bug-report.md', 'bug-report.md']]) {
    await fs.copyFile(path.join(repositoryReal, 'docs', 'ja', source), path.join(run, 'reports', target), constants.COPYFILE_EXCL);
  }
  await fs.writeFile(path.join(run, 'run.json'), JSON.stringify({ createdAt: new Date().toISOString(), fixture: 'qa/fixtures', tcpVersion: '0.0.1', executedManualTests: [] }, null, 2) + '\n', { flag: 'wx' });
  return run;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const run = await prepareManualQa();
  console.log('Prepared synthetic data only. No VS Code launch, installation, download or existing-data changes.');
  console.log('QA run: ' + path.relative(repository, run).split(path.sep).join('/'));
  console.log('Next: docs/ja/README.md (use this run path as $qa).');
}
