import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const commands = new Set(manifest.contributes.commands.map(item => item.title));
const settings = new Set(Object.keys(manifest.contributes.configuration.properties));
const files = ['README.md', 'docs/user-guide.md', 'qa/fixtures/README.md',
  ...(await fs.readdir(path.join(root, 'docs/ja'))).filter(name => name.endsWith('.md')).map(name => 'docs/ja/' + name)];
const problems = []; let links = 0, titles = 0, identifiers = 0;
for (const file of files) {
  const text = await fs.readFile(path.join(root, file), 'utf8');
  let fence;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (/[\t ]+$/.test(line)) { problems.push(`${file}:${index + 1}: trailing whitespace`); }
    const start = line.match(/^(`{3,}|~{3,})(.*)$/);
    if (start && !fence) { fence = start[1]; } else if (start && start[1] === fence && !start[2].trim()) { fence = undefined; }
  }
  if (fence) { problems.push(`${file}: unclosed code fence`); }
  for (const match of text.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)) {
    const target = match[1]; if (/^(?:https?:|#)/.test(target)) { continue; }
    links++;
    try { await fs.access(path.resolve(root, path.dirname(file), decodeURIComponent(target.split('#')[0]))); }
    catch { problems.push(`${file}: broken local link: ${target}`); }
  }
  if (file.startsWith('docs/ja/')) {
    for (const match of text.matchAll(/\*\*(Turbo Code Palette: [^*\n]+)\*\*/g)) {
      titles++; if (!commands.has(match[1])) { problems.push(`${file}: unknown command title: ${match[1]}`); }
    }
    for (const match of text.matchAll(/\bturboCodePalette\.[A-Za-z]+\b/g)) {
      identifiers++; if (!settings.has(match[0])) { problems.push(`${file}: unknown setting: ${match[0]}`); }
    }
  }
}
if (problems.length) { throw new Error(problems.join('\n')); }
console.log(`Docs checks passed: ${files.length} files, ${links} local links, ${titles} command title references, ${identifiers} setting references; fences and whitespace valid.`);
console.log('This is a lightweight Markdown/reference check, not a GUI test or full Markdownlint run.');
