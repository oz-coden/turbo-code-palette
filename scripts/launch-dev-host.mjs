import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { installedVSCode } from './vscode-installation.mjs';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const root = fileURLToPath(new URL('..', import.meta.url));
const minimum = process.argv.includes('--minimum');
const profile = resolve(root, `.vscode-test/manual${minimum ? '-min' : ''}-profile`);
const extensions = resolve(root, '.vscode-test/manual-extensions');
mkdirSync(join(profile, 'User'), { recursive: true });
mkdirSync(extensions, { recursive: true });
writeFileSync(join(profile, 'User/settings.json'), JSON.stringify({
  'workbench.startupEditor': 'none',
  'workbench.colorTheme': 'Default Dark Modern',
  'window.title': 'TCP Phase 1 — ${dirty}${activeEditorShort}',
  'editor.dropIntoEditor.enabled': true,
  'editor.fontSize': 16,
  'editor.minimap.enabled': false,
}, null, 2));

const executable = minimum ? await downloadAndUnzipVSCode('1.134.0') : installedVSCode();
const child = spawn(executable, [
  '--new-window', '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--locale=en',
  `--extensionDevelopmentPath=${root}`, `--user-data-dir=${profile}`, `--extensions-dir=${extensions}`,
], { detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
child.on('error', () => { console.error('Could not launch the isolated Extension Development Host.'); process.exitCode = 1; });
child.unref();
console.log('Launched an isolated Phase 1 Host. Run “Turbo Code Palette: Reload Phase 1 Catalog”.');
