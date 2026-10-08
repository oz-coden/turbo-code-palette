import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { installedVSCode } from './vscode-installation.mjs';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const root = fileURLToPath(new URL('..', import.meta.url));
const uxLab = process.argv.includes('--ux-lab');
const minimum = process.argv.includes('--minimum');
const profile = resolve(root, uxLab ? `.vscode-test/ux${minimum ? '-min' : ''}-profile` : '.vscode-test/manual-profile');
const extensions = resolve(root, uxLab ? '.vscode-test/ux-extensions' : '.vscode-test/manual-extensions');
mkdirSync(join(profile, 'User'), { recursive: true });
mkdirSync(extensions, { recursive: true });
writeFileSync(join(profile, 'User/settings.json'), JSON.stringify({
  'workbench.startupEditor': 'none',
  'workbench.colorTheme': 'Default Dark Modern',
  'window.title': uxLab ? `TCP D&D UX Lab${minimum ? ' [minimum]' : ''} — \${dirty}\${activeEditorShort}` : 'TCP Phase 0 — ${dirty}${activeEditorShort}',
  'editor.dropIntoEditor.enabled': true,
  'editor.fontSize': 16,
  'editor.minimap.enabled': false,
}, null, 2));

const executable = minimum ? await downloadAndUnzipVSCode('1.134.0') : installedVSCode();
const child = spawn(executable, [
  '--new-window', '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--locale=en',
  `--extensionDevelopmentPath=${root}`, `--user-data-dir=${profile}`, `--extensions-dir=${extensions}`,
], { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined,
  ...(uxLab ? { TCP_UX_LAB: '1' } : {}) } });
child.on('error', () => { console.error('Could not launch the isolated Extension Development Host.'); process.exitCode = 1; });
child.unref();
console.log(uxLab ? 'Launched an isolated UX Lab Host. Run “Turbo Code Palette: Open D&D UX Lab (Research)”.'
  : 'Launched an isolated Phase 0 Extension Development Host. Run “Turbo Code Palette: Open Phase 0 Drop Target”.');
