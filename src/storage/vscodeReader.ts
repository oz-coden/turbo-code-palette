import * as vscode from 'vscode';
import type { LibraryReader } from './reader';
import { validateRelativePath } from './safePaths';

/** Public workspace.fs only. URI storage is inspectable but not approved for physical writes/insertion. */
export function vscodeReader(root: vscode.Uri): LibraryReader {
	const uri = (relative: string) => relative ? vscode.Uri.joinPath(root, ...validateRelativePath(relative).split('/')) : root;
	const stat = async (target: vscode.Uri, type: vscode.FileType) => {
		const value = await vscode.workspace.fs.stat(target);
		if (value.type !== type) { throw new Error('Unverified entry type or symbolic link.'); }
		return value;
	};
	return {
		verifiedFileIdentity: false, // FileStat has no physical hardlink count / inode identity.
		async list(relative) {
			const target = uri(relative); await stat(target, vscode.FileType.Directory);
			return (await vscode.workspace.fs.readDirectory(target)).map(([name, type]) => ({ name, directory: (type & vscode.FileType.Directory) !== 0 }));
		},
		async read(relative, limit) {
			const target = uri(relative), before = await stat(target, vscode.FileType.File);
			if (before.size > limit) { throw new Error('File size limit.'); }
			const data = await vscode.workspace.fs.readFile(target), after = await stat(target, vscode.FileType.File);
			if (data.byteLength > limit || data.byteLength !== before.size || before.size !== after.size || before.mtime !== after.mtime || before.ctime !== after.ctime) {
				throw new Error('Changed file or size mismatch.');
			}
			return Buffer.from(data);
		},
	};
}
