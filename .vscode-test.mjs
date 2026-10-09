import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const workspace = fileURLToPath(new URL(process.env.TCP_VSCODE_EXECUTABLE ? './.vscode-test/installed-workspace' : './.vscode-test/minimum-workspace', import.meta.url));
mkdirSync(workspace, { recursive: true });

export default defineConfig({
	files: 'out/test/integration/**/*.test.js',
	version: '1.134.0',
	useInstallation: process.env.TCP_VSCODE_EXECUTABLE ? { fromPath: process.env.TCP_VSCODE_EXECUTABLE } : undefined,
	launchArgs: [workspace, '--disable-extensions', '--skip-welcome', '--skip-release-notes',
		...(process.env.TCP_VSCODE_EXECUTABLE ? [
			`--user-data-dir=${fileURLToPath(new URL('./.vscode-test/installed-user-data', import.meta.url))}`,
			`--extensions-dir=${fileURLToPath(new URL('./.vscode-test/installed-extensions', import.meta.url))}`,
		] : []),
	],
	mocha: { ui: 'tdd', timeout: 15000 },
});
