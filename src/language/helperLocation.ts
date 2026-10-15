import * as path from 'node:path';

export function helperLocation(extensionDirectory: string, mode: string, customPath: string, trusted: boolean): string {
	if (!trusted || mode === 'disabled') { return ''; }
	if (mode === 'auto') { return path.join(extensionDirectory, 'resources', 'csharp', 'Tcp.CSharp.dll'); }
	if (mode === 'custom' && path.isAbsolute(customPath)) { return customPath; }
	return '';
}
