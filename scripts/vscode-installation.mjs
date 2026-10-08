import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function installedVSCode() {
  if (process.env.TCP_VSCODE_EXECUTABLE) {
    const executable = resolve(process.env.TCP_VSCODE_EXECUTABLE);
    if (!existsSync(executable)) { throw new Error('TCP_VSCODE_EXECUTABLE does not exist.'); }
    return executable;
  }
  if (process.platform === 'win32') {
    const candidates = execFileSync('where.exe', ['code'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/);
    for (const candidate of candidates) {
      const executable = resolve(dirname(candidate), '..', 'Code.exe');
      if (existsSync(executable)) { return executable; }
    }
  }
  throw new Error('Set TCP_VSCODE_EXECUTABLE to an installed VS Code executable, or use npm test to download the pinned runtime.');
}
