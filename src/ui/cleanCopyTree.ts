import * as vscode from 'vscode';
import type { CleanScope } from '../core/clean/types';

export class CleanCopyTree implements vscode.TreeDataProvider<CleanScope> {
	getChildren(): CleanScope[] { return ['selection', 'file', 'bundle']; }
	getTreeItem(scope: CleanScope): vscode.TreeItem {
		const item = new vscode.TreeItem({ selection: 'Selection', file: 'Current File', bundle: 'Dependency Bundle' }[scope]);
		item.iconPath = new vscode.ThemeIcon(scope === 'bundle' ? 'package' : 'copy');
		item.description = scope === 'bundle' ? 'Review / provider plan' : 'Original unchanged';
		item.tooltip = scope === 'bundle' ? 'Text hits are unverified. Choose Snippets explicitly; metadata dependencies are resolved within each Pack. Code merging requires a semantic LanguageProvider.' : 'Readable / Competitive / Custom → Clipboard / Preview / Save As. Notices are always preserved.';
		item.command = { command: 'turbo-code-palette.cleanCopy', title: 'Clean Copy', arguments: [scope] }; return item;
	}
}
