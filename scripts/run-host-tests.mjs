import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installedVSCode } from './vscode-installation.mjs';

const cli = fileURLToPath(new URL('../node_modules/@vscode/test-cli/out/bin.mjs', import.meta.url));
const child = spawn(process.execPath, [cli], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, TCP_VSCODE_EXECUTABLE: installedVSCode() },
});
child.on('error', () => { console.error('Could not start the Extension Host test runner.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
