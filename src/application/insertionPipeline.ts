import * as vscode from 'vscode';
import * as path from 'node:path';
import type { InsertRequest } from './insertionAdapter';
import { Library, locationKey, packOf, sameRoot } from './library';
import { loadCatalog, type AssetLocation } from '../storage/discovery';
import { resolveClosure } from '../core/dependency/resolver';
import { dependencyOrder } from '../core/dependency/order';
import { satisfies } from '../core/version/constraint';
import type { AssetVersion } from '../core/version/parser';
import { templateInputs, substitute, validateValue, type Variable } from '../core/template/substitution';
import { modePolicy, type InsertMode } from '../core/insertion/modes';
import { applyText, planText, type OffsetEdit } from '../core/insertion/textPlan';
import { exportNames, supportsStructure, validateCollisions } from '../language/genericProvider';
import { assertNoLinks, containedPath, pathCollisionKey } from '../storage/safePaths';
import { applyFiles, validateDestination, type FileOutput } from './fileInsertion';
import type { UserState } from './userState';

export interface InsertionInteractions {
	input(asset: AssetLocation, variable: Variable): Promise<string | undefined>;
	mode(asset: AssetLocation, available: readonly InsertMode[]): Promise<InsertMode | undefined>;
	output(): Promise<{ parent: string; folder: string } | undefined>;
	preview(plan: InsertionPlan): Promise<boolean>;
	warnings?(warnings: readonly string[]): Promise<boolean>;
}
export interface InsertionPlan {
	readonly assets: readonly AssetLocation[]; readonly skipped: readonly AssetLocation[]; readonly warnings: readonly string[];
	readonly edits: readonly OffsetEdit[]; readonly output?: FileOutput; readonly before: string; readonly after: string;
}
interface Implementation { readonly signature: string; readonly version: AssetVersion; readonly body: string }
interface Receipt { readonly text: string; readonly implementations: Map<string, Implementation>; readonly ambiguous: ReadonlySet<string> }
const signature = (asset: AssetLocation) => `${asset.metadata.version!.text}:${asset.semanticHash}`;
const decoder = new TextDecoder('utf-8', { fatal: true });
const rootStamp = (library: Library) => JSON.stringify(library.roots());

export class InsertionPipeline implements vscode.Disposable {
	private busy = false;
	/** Session-only verification cache. No persistent provenance database or source markers. */
	private readonly receipts = new Map<string, Receipt[]>();
	readonly interactions: InsertionInteractions;
	lastPlan?: InsertionPlan;
	constructor(private readonly library: Library, private readonly state: UserState, private readonly rootGuard: () => void = () => {}, interactions?: InsertionInteractions) {
		this.interactions = interactions ?? {
			input: async (asset, variable) => {
				if (variable.options) { return (await vscode.window.showQuickPick(variable.options.map(value => ({ label: value || '(empty)', value, description: value === variable.defaultValue ? 'Default' : undefined })), { title: asset.metadata.name + ' · ' + variable.name, placeHolder: variable.description }))?.value; }
				return vscode.window.showInputBox({ title: asset.metadata.name + ' · ' + variable.name, prompt: variable.description ?? (variable.required ? 'Required value' : 'Optional value; empty is allowed'), value: variable.defaultValue, validateInput: value => { try { validateValue(variable, value); } catch (error) { return (error as Error).message; } return undefined; } });
			},
			mode: async (asset, available) => (await vscode.window.showQuickPick(available.map(mode => ({ label: mode, mode })), { title: 'Insert ' + asset.metadata.name, placeHolder: 'Choose an available insertion mode' }))?.mode,
			output: async () => {
				const parent = (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Choose output parent within workspace' }))?.[0];
				if (!parent) { return; } if (parent.scheme !== 'file') { throw new Error('separate-files requires a native workspace folder.'); }
				const folder = await vscode.window.showInputBox({ title: 'New output folder', value: 'TCP-Snippets', prompt: 'A new folder is created atomically. File creation is outside editor Undo.' }); return folder ? { parent: parent.fsPath, folder } : undefined;
			},
			preview: async plan => {
				const content = plan.output ? [...plan.output.files].map(([name, text]) => `--- ${name} ---\n${text}`).join('\n\n') : plan.after;
				const document = await vscode.workspace.openTextDocument({ content, language: 'plaintext' }); await vscode.window.showTextDocument(document, { preview: true });
				return await vscode.window.showInformationMessage('Insertion preview — target is unchanged.', { modal: true }, 'Insert') === 'Insert';
			},
		};
	}
	private target(request: InsertRequest): vscode.TextDocument {
		const doc = request.target && vscode.workspace.textDocuments.find(doc => !doc.isClosed && doc.uri.toString() === request.target!.uri.toString());
		if (!doc || doc.version !== request.target!.version || !['file', 'untitled'].includes(doc.uri.scheme)) { throw new Error('Insertion target is stale or closed. Select a position and Insert again.'); }
		for (const root of this.library.roots()) {
			if (!root.uri && doc.uri.scheme === 'file') { const relative = path.relative(root.path, doc.uri.fsPath); if (!relative || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) { throw new Error('Do not insert into library source files. Open a project editor.'); } }
		}
		return doc;
	}
	private async validateTarget(request: InsertRequest): Promise<vscode.TextDocument> {
		const doc = this.target(request); if (doc.uri.scheme === 'file') { await assertNoLinks(doc.uri.fsPath); } return this.target(request);
	}
	private async assets(assets: readonly AssetLocation[]): Promise<void> {
		if (assets.some(asset => !asset.usable || asset.root.uri || !asset.metadata.canInsert || asset.metadata.blockedFeatures.has('exports'))) { throw new Error('Asset is not eligible for insertion. Use a verified native library root and valid supported metadata.'); }
		const fresh = await loadCatalog(this.library.roots(), this.library.stores);
		for (const asset of assets) {
			if (fresh.snippets.some(other => locationKey(other) !== locationKey(asset) && other.metadata.id === asset.metadata.id && other.metadata.version!.text === asset.metadata.version!.text && other.semanticHash !== asset.semanticHash)) { throw new Error('Same UUID/version content conflict appeared. Reload and compare before insertion.'); }
			const current = fresh.snippets.find(item => locationKey(item) === locationKey(asset));
			const pack = this.library.catalog.snapshot!.packs.find(item => sameRoot(item.root, asset.root) && item.relativePath === packOf(asset));
			const newPack = fresh.packs.find(item => sameRoot(item.root, asset.root) && item.relativePath === packOf(asset));
			if (!current?.usable || current.integrityHash !== asset.integrityHash || !pack?.usable || newPack?.integrityHash !== pack.integrityHash) { throw new Error('Asset/Pack changed or became unsafe. Reload and Insert again.'); }
			await this.library.sources(asset, asset.metadata.sources);
		}
	}
	private validateOutputRoot(output: FileOutput): void {
		const uri = vscode.Uri.file(output.parent), workspace = vscode.workspace.getWorkspaceFolder(uri);
		if (!workspace || workspace.uri.scheme !== 'file') { throw new Error('Output must be within a native workspace folder.'); }
		const target = containedPath(output.parent, output.folder);
		for (const root of this.library.roots().filter(root => !root.uri)) { const relative = path.relative(root.path, target); if (!relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) { throw new Error('Output may not modify library storage.'); } }
	}
	async run(request: InsertRequest): Promise<'inserted' | 'cancelled' | 'already-present'> {
		if (this.busy) { throw new Error('Another insertion is collecting inputs or applying. Finish it first.'); } this.busy = true; this.lastPlan = undefined;
		try {
			this.rootGuard(); const snapshot = this.library.catalog.snapshot, stamp = rootStamp(this.library), document = await this.validateTarget(request);
			if (!snapshot || !snapshot.snippets.some(asset => locationKey(asset) === locationKey(request.asset) && asset.integrityHash === request.asset.integrityHash)) { throw new Error('Asset is no longer in the catalog. Reload and select again.'); }
			const root = request.asset, pack = snapshot.packs.find(asset => sameRoot(asset.root, root.root) && asset.relativePath === packOf(root));
			if (!pack?.usable) { throw new Error('Pack is not eligible for insertion.'); }
			const closure = resolveClosure([root], this.library.members(pack), { workspaceId: root.root.workspaceId, strictConflicts: true });
			const ordered = dependencyOrder(closure.members);
			for (const asset of ordered) {
				if (snapshot.snippets.some(other => other.metadata.id === asset.metadata.id && other.metadata.version!.text === asset.metadata.version!.text && other.semanticHash !== asset.semanticHash)) { throw new Error('Same UUID/version has different content. Conflict comparison is required before insertion.'); }
			}
			await this.assets(ordered);
			const before = document.getText(), uri = document.uri.toString(), history = this.receipts.get(uri) ?? [], verified = [...history].reverse().find(receipt => receipt.text === before);
			if (before.length > 16 * 1024 * 1024) { throw new Error('Target text limit exceeded.'); }
			const skipped: AssetLocation[] = [], items: { asset: AssetLocation; mode: InsertMode; sources: string[] }[] = [], warnings = [...closure.warnings];
			const canSkip = (asset: AssetLocation) => {
				const receipt = verified?.implementations.get(asset.metadata.id!); if (!receipt) { return false; }
				if (receipt.signature === signature(asset)) { return true; }
				return asset !== root && receipt.version.text !== asset.metadata.version!.text && ordered.flatMap(parent => parent.metadata.dependencies).filter(dependency => dependency.id === asset.metadata.id).every(dependency => satisfies(receipt.version, dependency.constraint));
			};
			const needed = new Set<string>(), byId = new Map(ordered.map(asset => [asset.metadata.id!, asset]));
			const requireAsset = (asset: AssetLocation) => { if (needed.has(asset.metadata.id!)) { return; } needed.add(asset.metadata.id!); if (!canSkip(asset)) { for (const dependency of asset.metadata.dependencies) { requireAsset(byId.get(dependency.id)!); } } };
			requireAsset(root);
			for (const asset of ordered.filter(asset => needed.has(asset.metadata.id!))) {
				if (verified?.ambiguous.has(asset.metadata.id!) || !verified && history.some(receipt => receipt.implementations.has(asset.metadata.id!) || receipt.ambiguous.has(asset.metadata.id!))) { throw new Error('Previously inserted implementation changed or cannot be verified. Comparison is required before reinsertion.'); }
				const receipt = verified?.implementations.get(asset.metadata.id!);
				if (canSkip(asset)) { skipped.push(asset); continue; }
				if (receipt) { throw new Error('Existing insertion uses a different version/content. Comparison is required.'); }
				const bytes = await this.library.sources(asset, asset.metadata.sources), raw = asset.metadata.sources.map(source => { const buffer = bytes.get(source)!; if (buffer.includes(0)) { throw new Error('Binary source is not insertable.'); } return decoder.decode(buffer); });
				const variables = templateInputs(asset.metadata.document, raw), values = new Map<string, string>();
				for (const variable of variables) { const value = await this.interactions.input(asset, variable); if (value === undefined) { return 'cancelled'; } validateValue(variable, value); values.set(variable.name, value); }
				const sources = raw.map(source => substitute(source, variables, values));
				const policy = modePolicy(asset.metadata.document, { structure: supportsStructure(document.languageId, asset.metadata.document), files: !!vscode.workspace.workspaceFolders?.some(folder => folder.uri.scheme === 'file') });
				if (!policy.available.length) { throw new Error('No available insertion mode for this asset/target.'); }
				let mode: InsertMode | undefined;
				if (asset === root && request.mode && request.mode !== 'choose') { if (!policy.available.includes(request.mode)) { throw new Error('Requested mode is denied or unsupported.'); } mode = request.mode; }
				else { mode = asset === root && request.mode === 'choose' ? undefined : policy.preferred; }
				if (!mode) { mode = await this.interactions.mode(asset, policy.available); if (!mode) { return 'cancelled'; } }
				if (!policy.available.includes(mode)) { throw new Error('Unsupported/denied insertion mode.'); }
				if (asset.metadata.document.node(['insert', 'sourceOverrides']) || asset.metadata.document.node(['sourceOverrides'])) { warnings.push(`${asset.metadata.name}: sourceOverrides are preserved but not applied.`); }
				items.push({ asset, mode, sources });
			}
			if (!items.length) { return 'already-present'; }
			validateCollisions(before, items.filter(item => item.mode !== 'separate-files').map(item => ({ name: item.asset.metadata.name!, exports: exportNames(item.asset.metadata.document), sources: item.sources })));
			// A single implementation cannot introduce duplicate declared exports in this batch either.
			validateCollisions('', items.map(item => ({ name: item.asset.metadata.name!, exports: exportNames(item.asset.metadata.document), sources: [] })));
			let output: FileOutput | undefined, edits: OffsetEdit[] = [];
			if (items.some(item => item.mode === 'separate-files')) {
				if (items.some(item => item.mode !== 'separate-files')) { throw new Error('Mixed editor/file modes cannot be applied atomically. Use compatible modes for the dependency closure.'); }
				const destination = await this.interactions.output(); if (!destination) { return 'cancelled'; }
				const files = new Map<string, string>(), keys = new Set<string>();
				for (const item of items) { for (const [index, source] of item.asset.metadata.sources.entries()) { const key = pathCollisionKey(source); if (keys.has(key)) { throw new Error('Output source path collision. Use distinct source paths.'); } keys.add(key); files.set(source, item.sources[index]); } }
				output = { ...destination, files }; this.validateOutputRoot(output); await validateDestination(output);
			} else {
				const selection = request.target!.selection;
				edits = planText(before, { start: document.offsetAt(selection.start), end: document.offsetAt(selection.end), active: document.offsetAt(selection.active) }, items, document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
			}
			const after = applyText(before, edits); if (after.length > 32 * 1024 * 1024) { throw new Error('Planned text limit exceeded.'); }
			const plan: InsertionPlan = { assets: items.map(item => item.asset), skipped, warnings, edits, output, before, after }; this.lastPlan = plan;
			if (warnings.length) { const confirmed = this.interactions.warnings ? await this.interactions.warnings(warnings) : await vscode.window.showWarningMessage(warnings.join('\n'), { modal: true }, 'Continue') === 'Continue'; if (!confirmed) { return 'cancelled'; } }
			if (vscode.workspace.getConfiguration('turboCodePalette').get<boolean>('previewBeforeInsert', false) && !await this.interactions.preview(plan)) { return 'cancelled'; }
			// Show/reacquire the captured editor before final validation, never use current focus as a target.
			const editor = output ? undefined : await vscode.window.showTextDocument(document, { preview: false });
			const revalidate = async () => {
				this.rootGuard(); if (rootStamp(this.library) !== stamp || this.library.catalog.snapshot !== snapshot) { throw new Error('Catalog/root changed while planning. Insert again.'); }
				await this.assets(ordered); await this.validateTarget(request);
				if (document.getText() !== before) { throw new Error('Target changed while planning. Insert again.'); }
				if (output) { this.validateOutputRoot(output); }
				this.rootGuard(); if (this.library.catalog.snapshot !== snapshot || rootStamp(this.library) !== stamp) { throw new Error('Catalog/root changed while validating.'); }
			};
			await revalidate();
			if (output) { await applyFiles(output, revalidate); }
			else {
				if (editor!.document !== document || document.version !== request.target!.version) { throw new Error('Target became stale before apply.'); }
				const ok = await editor!.edit(builder => { for (const edit of edits) { builder.replace(new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text); } }, { undoStopBefore: true, undoStopAfter: true });
				if (!ok) { throw new Error('Atomic text edit was rejected. No insertion was applied.'); }
				const implementations = new Map(verified?.implementations ?? []), ambiguous = new Set(verified ? verified.ambiguous : history.flatMap(receipt => [...receipt.implementations.keys(), ...receipt.ambiguous]));
				for (const [id, receipt] of implementations) {
					const start = before.indexOf(receipt.body), end = start + receipt.body.length;
					if (start < 0 || before.indexOf(receipt.body, start + 1) >= 0 || edits.some(edit => edit.start < end && edit.end > start || edit.start === edit.end && edit.start > start && edit.start < end)) { implementations.delete(id); ambiguous.add(id); }
				}
				const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
				for (const item of items) { const body = item.sources.map(source => source.replace(/\r\n|\r|\n/g, eol)).join(eol); if (after.indexOf(body) >= 0 && after.indexOf(body, after.indexOf(body) + 1) < 0) { implementations.set(item.asset.metadata.id!, { signature: signature(item.asset), version: item.asset.metadata.version!, body }); ambiguous.delete(item.asset.metadata.id!); } else { ambiguous.add(item.asset.metadata.id!); } }
				if (!history.some(receipt => receipt.text === before)) { history.push({ text: before, implementations: new Map(), ambiguous: new Set(ambiguous) }); }
				history.push({ text: after, implementations, ambiguous }); this.receipts.set(uri, history.slice(-8));
				while (this.receipts.size > 32 || [...this.receipts.values()].flat().reduce((bytes, receipt) => bytes + receipt.text.length * 2, 0) > 64 * 1024 * 1024) { this.receipts.delete(this.receipts.keys().next().value!); }
			}
			// State persistence failure does not turn a completed edit into a retryable insertion failure.
			try { for (const item of items) { await this.state.inserted(`snippet:${item.asset.metadata.id}:${item.asset.metadata.version!.text}`); } } catch { void vscode.window.showWarningMessage('Insertion completed, but usage/recent could not be saved.'); }
			if (output) { void vscode.window.showInformationMessage('Created Snippet files in the new output folder. File creation is outside editor Undo.'); }
			return 'inserted';
		} finally { this.busy = false; }
	}
	dispose(): void { this.receipts.clear(); }
}
