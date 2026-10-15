import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { scanPublicText } from './public-repo-rules.mjs';
import { scanJavaScript } from './scan-bundled.mjs';
const require = createRequire(import.meta.url), yauzl = require('yauzl');
const file = process.argv[2]; if (!file) { throw new Error('Provide the generated VSIX path.'); }
const allowed = /^(?:\[Content_Types\]\.xml|extension\.vsixmanifest|extension\/(?:package\.json|README\.md|CHANGELOG\.md|LICENSE(?:\.txt)?|THIRD_PARTY_NOTICES\.md|dist\/extension\.js|media\/(?:palette\.svg|palette-panel\.(?:js|css))|schemas\/(?:snippet|pack|common)\.schema\.json|docs\/(?:user-guide|known-issues)\.md|resources\/csharp\/(?:Tcp\.CSharp\.(?:dll|deps\.json|runtimeconfig\.json)|Microsoft\.CodeAnalysis(?:\.CSharp)?\.dll)))$/i;
const seen = new Set(); let total = 0;
await new Promise((resolve,reject) => yauzl.open(file, { lazyEntries: true }, (error, zip) => {
  if (error) { reject(error); return; }
  zip.on('error',reject); zip.on('end',resolve);
  zip.on('entry',entry => {
    const name = entry.fileName, key = name.normalize('NFC').toLowerCase();
    if (!allowed.test(name) || seen.has(key) || (entry.externalFileAttributes >>> 16 & 0xf000) === 0xa000 || entry.uncompressedSize > 32*1024*1024 || seen.size >= 64) { zip.close(); reject(new Error('Unexpected/unsafe VSIX entry: ' + name)); return; }
    seen.add(key); total += entry.uncompressedSize; if (total > 64*1024*1024) { zip.close(); reject(new Error('VSIX size limit.')); return; }
    zip.openReadStream(entry,(err,stream) => {
      if (err) { reject(err); return; } const chunks=[];
      stream.on('data',chunk => chunks.push(chunk)); stream.on('error',reject);
      stream.on('end',() => {
        const bytes = Buffer.concat(chunks);
        const findings = name.endsWith('.dll') ? [bytes.toString('utf8'), bytes.toString('utf16le')].flatMap(text => /[a-z]:[\\/]Users[\\/]|\/(?:Users|home)\/[^/\s]+/i.test(text) ? [{category:'binary-home-path'}] : []) : name.endsWith('.js') ? scanJavaScript(bytes.toString('utf8')) : scanPublicText(bytes.toString('utf8'));
        if (findings.length) { zip.close(); reject(new Error('VSIX public-data scan failed: ' + name + ' (' + findings.map(f=>f.category).join(',') + ')')); return; }
        if (name === 'extension/package.json') { const data = JSON.parse(bytes); if (data.version !== '0.0.1' || data.license !== 'UNLICENSED') { reject(new Error('Unexpected release version/license grant.')); return; } }
        zip.readEntry();
      });
    });
  }); zip.readEntry();
}));
for (const name of ['extension/package.json','extension/dist/extension.js','extension/license.txt','extension/third_party_notices.md','extension/resources/csharp/tcp.csharp.dll']) { if (!seen.has(name)) { throw new Error('Required VSIX component missing: ' + name); } }
const bytes = await fs.readFile(file);
console.log(JSON.stringify({entries:seen.size,uncompressedBytes:total,vsixBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),audit:'allowlist + text secrets/paths + binary home paths passed'}));
