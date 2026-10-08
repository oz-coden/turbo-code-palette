import * as path from 'node:path';

export interface StorageRoot { readonly scope: 'workspace' | 'global'; readonly path: string; readonly workspaceId?: string; readonly uri?: string }
export interface WorkspaceLocation { readonly id: string; readonly path: string }

/** Pure root selection; no mkdir, Default Pack creation, or source-control policy changes. */
export function resolveRoots(globalStorage: string, workspaces: readonly WorkspaceLocation[], configuredGlobal?: string): StorageRoot[] {
	if (configuredGlobal && !path.isAbsolute(configuredGlobal)) { throw new Error('Configured Global root must be absolute on the extension host.'); }
	return [...workspaces.map(workspace => ({ scope: 'workspace' as const, workspaceId: workspace.id,
		path: path.join(workspace.path, '.snippets') })),
	{ scope: 'global', path: configuredGlobal ? path.resolve(configuredGlobal) : path.join(globalStorage, 'snippets') }];
}

export function preferredRoots(roots: readonly StorageRoot[], workspaceId?: string): StorageRoot[] {
	return [...roots].sort((a, b) => (a.scope === 'global' ? 2 : a.workspaceId === workspaceId ? 0 : 1)
		- (b.scope === 'global' ? 2 : b.workspaceId === workspaceId ? 0 : 1));
}
