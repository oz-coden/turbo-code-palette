import * as vscode from 'vscode';
import type { AssetGroup } from '../core/assets/identity';
import type { AssetLocation } from '../storage/discovery';
import { searchAssets } from '../core/search/index';
import type { Catalog } from '../storage/catalog';
import type { UserState } from '../application/userState';
export type AssetRow = AssetGroup<AssetLocation>;
export class AssetTree implements vscode.TreeDataProvider<AssetRow>, vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.emitter.event;
	query = '';
	filter: 'all' | 'favorites' | 'recent' = 'all';
	constructor(private readonly catalog: Catalog, readonly kind: 'snippet' | 'pack', private readonly state: UserState) {}
	refresh(): void { this.emitter.fire(); }
	getChildren(element?: AssetRow): AssetRow[] {
		if (element) { return []; }
		const groups = this.kind === 'snippet' ? this.catalog.snapshot?.snippetGroups : this.catalog.snapshot?.packGroups;
		let rows = searchAssets(groups ?? [], this.query).hits.map(hit => ({ ...hit.group, locations: hit.locations }));
		if (this.filter === 'favorites') { rows = rows.filter(row => this.state.get(row.key).favorite); }
		if (this.filter === 'recent') { rows = rows.filter(row => this.state.get(row.key).recent > 0).sort((a, b) => this.state.get(b.key).recent - this.state.get(a.key).recent); }
		return rows;
	}
	getTreeItem(row: AssetRow): vscode.TreeItem {
		const asset = row.locations[0], m = asset.metadata;
		const item = new vscode.TreeItem(m.name!.replace(/\s+/g, ' ').slice(0, 200)); item.id = row.key;
		const places = [...new Set(row.locations.map(location => location.root.scope + (this.kind === 'snippet' ? '/' + location.packName.replace(/\s+/g, ' ').slice(0, 40) : '')))];
		item.description = [m.description?.replace(/\s+/g, ' ').slice(0, 50), m.languages.join('/').slice(0, 40), m.version!.text,
			places.slice(0, 2).join(', ') + (places.length > 2 ? ` +${places.length - 2}` : '')].filter(Boolean).join(' · ');
		item.tooltip = `${m.name!.slice(0, 1000)} ${m.version!.text}\n${m.description?.slice(0, 1000) ?? ''}\n${row.locations.length} location(s)${row.status === 'identical' ? '' : ' · ' + row.status}`;
		item.iconPath = new vscode.ThemeIcon(this.state.get(row.key).favorite ? 'star-full' : row.status !== 'identical' ? 'warning' : this.kind === 'snippet' ? 'symbol-snippet' : 'package');
		item.contextValue = 'tcp.' + this.kind;
		item.command = { command: 'turbo-code-palette.details', title: 'Details', arguments: [row.key] };
		return item;
	}
	dispose(): void { this.emitter.dispose(); }
}
