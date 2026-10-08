import * as vscode from 'vscode';
import type { LibraryStore } from './store';
import { vscodeReader } from './vscodeReader';
import { validateStoragePath } from './safePaths';

/** URI-backed storage uses fresh private staging and overwrite:false rename, never in-place source writes. */
export function vscodeStore(root: vscode.Uri): LibraryStore {
	const reader = vscodeReader(root);
	const uri = (relative: string) => relative ? vscode.Uri.joinPath(root, ...validateStoragePath(relative).split('/')) : root;
	const verifyParents = async (relative: string) => {
		const parts = relative.split('/'); parts.pop();
		for (let length = 0; length <= parts.length; length++) {
			const target = uri(parts.slice(0, length).join('/'));
			try { if ((await vscode.workspace.fs.stat(target)).type !== vscode.FileType.Directory) { throw new Error('Unsafe storage parent.'); } }
			catch (error) { if ((error as vscode.FileSystemError).code !== 'FileNotFound') { throw error; } }
		}
	};
	return {
		...reader,
		async exists(relative) {
			await verifyParents(relative);
			try { const stat = await vscode.workspace.fs.stat(uri(relative)); if (![vscode.FileType.File, vscode.FileType.Directory].includes(stat.type)) { throw new Error('Unsafe storage entry.'); } return true; }
			catch (error) { if ((error as vscode.FileSystemError).code === 'FileNotFound') { return false; } throw error; }
		},
		async mkdir(relative, exclusive = false) {
			await verifyParents(relative);
			if (exclusive && await this.exists(relative)) { throw new Error('Private staging already exists.'); }
			await vscode.workspace.fs.createDirectory(uri(relative));
			if ((await vscode.workspace.fs.stat(uri(relative))).type !== vscode.FileType.Directory) { throw new Error('Unsafe storage directory.'); }
		},
		async writeNew(relative, bytes) {
			await verifyParents(relative); if (await this.exists(relative)) { throw new Error('Refusing overwrite.'); }
			await vscode.workspace.fs.writeFile(uri(relative), bytes);
		},
		async rename(from, to) {
			await verifyParents(from); await verifyParents(to);
			if (!(await this.exists(from))) { throw new Error('Missing transaction object.'); }
			await vscode.workspace.fs.rename(uri(from), uri(to), { overwrite: false });
		},
		async remove(relative) {
			if (!/^\.tcp-(staging|transactions)\/[a-f\d-]+(?:\/.*)?$/i.test(relative)) { throw new Error('Refusing removal outside owned transaction storage.'); }
			await verifyParents(relative); await this.exists(relative);
			await vscode.workspace.fs.delete(uri(relative), { recursive: true, useTrash: false });
		},
	};
}
