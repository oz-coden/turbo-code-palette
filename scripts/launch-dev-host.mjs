import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { installedVSCode } from './vscode-installation.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const profile = resolve(root, '.vscode-test/manual-profile');
const extensions = resolve(root, '.vscode-test/manual-extensions');
mkdirSync(join(profile, 'User'), { recursive: true });
mkdirSync(extensions, { recursive: true });
writeFileSync(join(profile, 'User/settings.json'), JSON.stringify({
  'workbench.startupEditor': 'none',
  'workbench.colorTheme': 'Default Dark Modern',
  'window.title': 'TCP Phase 0 — ${dirty}${activeEditorShort}',
  'editor.dropIntoEditor.enabled': true,
  'editor.fontSize': 16,
  'editor.minimap.enabled': false,
}, null, 2));

const child = spawn(installedVSCode(), [
  '--new-window', '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--locale=en',
  `--extensionDevelopmentPath=${root}`, `--user-data-dir=${profile}`, `--extensions-dir=${extensions}`,
], { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
child.on('error', () => { console.error('Could not launch the isolated Extension Development Host.'); process.exitCode = 1; });
child.unref();
console.log('Launched an isolated Phase 0 Extension Development Host. Run “Turbo Code Palette: Open Phase 0 Drop Target”.');
