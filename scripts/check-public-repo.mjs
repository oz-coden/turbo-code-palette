import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { scanPublicText, forbiddenPublicFile } from './public-repo-rules.mjs';

const git = args => execFileSync('git', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
const split = text => text.split('\0').filter(Boolean);
let inspected = 0;
const findings = [];
const inspect = (file, text, scope) => {
  inspected++;
  if (forbiddenPublicFile(file)) { findings.push(`${scope}: ${file}: private-or-generated-file`); }
  for (const issue of scanPublicText(text)) {
    // Print location/category only. Never repeat potentially sensitive values.
    findings.push(`${scope}: ${file}:${issue.line}: ${issue.category}`);
  }
};

if (process.argv.includes('--staged')) {
  for (const file of split(git(['ls-files', '-z']))) {
    inspect(file, git(['show', `:${file}`]), 'index');
  }
} else {
  for (const file of new Set(split(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])))) {
    inspect(file, existsSync(file) ? readFileSync(file, 'utf8') : git(['show', `:${file}`]), 'working-tree');
  }
}

if (process.argv.includes('--history')) {
  const seen = new Set();
  for (const revision of git(['rev-list', '--all']).trim().split('\n').filter(Boolean)) {
    for (const record of split(git(['ls-tree', '-rz', revision]))) {
      const tab = record.indexOf('\t');
      const [mode, kind, object] = record.slice(0, tab).split(' ');
      const file = record.slice(tab + 1);
      if (kind !== 'blob') { continue; }
      const key = `${object}:${file}`;
      if (seen.has(key)) { continue; }
      seen.add(key);
      if (mode === '120000') { findings.push(`history: ${file}: tracked-symlink`); }
      inspect(file, git(['cat-file', 'blob', object]), `history ${revision.slice(0, 7)}`);
    }
  }
}

if (findings.length) {
  for (const finding of [...new Set(findings)]) { console.error(finding); }
  console.error('Review findings before commit/push. Do not rewrite public history automatically.');
  process.exitCode = 1;
} else {
  console.log(`Public repository scan passed (${inspected} file versions). Pattern checks supplement manual tracked-file/diff review.`);
}
