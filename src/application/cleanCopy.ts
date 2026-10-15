import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Library, locationKey, packOf, sameRoot } from './library';
import type { InsertRequest } from './insertionAdapter';
import { ComparisonDocuments } from '../ui/comparison';
import { CleanProviders } from '../language/cleanProvider';
import { relevantMarkerIdentities } from '../language/cleanMarkers';
import { sourceLanguage } from '../language/sourceMarker';
import { collectNotices, availableTransforms, textCleanPlan } from '../core/clean/pipeline';
import type { CleanFragment, CleanPlan, CleanPreset, CleanScope, CleanTransform } from '../core/clean/types';
import { bundleCandidates, bundleClosure, bundleReviewPlan, type ReferenceCandidate } from './cleanBundle';
import { loadCatalog, type AssetLocation } from '../storage/discovery';
import { publishCleanOutput, type CleanOutputProtection } from '../storage/cleanOutput';
import { pathCollisionKey } from '../storage/safePaths';
import { ConflictError } from '../core/conflict';

export type CleanOutput = 'clipboard' | 'preview' | 'save' | 'untitled';
export interface CleanInteractions {
	preset(): Promise<CleanPreset | undefined>;
	custom(available: readonly CleanTransform[]): Promise<readonly string[] | undefined>;
	bundle(candidates: readonly ReferenceCandidate[], all: readonly AssetLocation[]): Promise<readonly AssetLocation[] | undefined>;
	warnings(plan: CleanPlan): Promise<boolean>;
	output(plan: CleanPlan): Promise<CleanOutput | undefined>;
	preview(plan: CleanPlan): Promise<Exclude<CleanOutput, 'preview'> | undefined>;
	destination(plan: CleanPlan): Promise<vscode.Uri | undefined>;
	clipboard(text: string): Promise<void>;
	untitled(plan: CleanPlan): Promise<void>;
}

export class CleanCopy implements vscode.Disposable {
	readonly providers = new CleanProviders();
	readonly interactions: CleanInteractions;
	lastPlan?: CleanPlan;
	private busy = false;
	constructor(private readonly library: Library, private readonly capture: () => InsertRequest['target'], private readonly comparison: ComparisonDocuments,
		private readonly rootGuard: () => void = () => {}, interactions?: CleanInteractions) {
		this.interactions = interactions ?? {
			preset: async () => (await vscode.window.showQuickPick([
				{ label: 'Readable', description: 'Proven TCP markers only; preserve all notices' },
				{ label: 'Competitive', description: 'Same safe v1 transforms as Readable; no minification' },
				{ label: 'Custom', description: 'Choose available provider transforms; always preserve notices' },
			], { title: 'Clean Copy preset' }))?.label as CleanPreset | undefined,
			custom: async available => {
				if (!available.length) { return []; }
				return (await vscode.window.showQuickPick(available.map(transform => ({ label: transform.label, id: transform.id, picked: true })), { title: 'Custom transforms (notices always preserved)', canPickMany: true }))?.map(item => item.id);
			},
			bundle: async (candidates, all) => {
				const hits = new Map(candidates.map(candidate => [locationKey(candidate.asset), candidate.exports]));
				const choices = all.map(asset => ({ label: asset.metadata.name!, description: `${asset.metadata.version!.text} · ${asset.root.scope} · ${asset.packName}`, detail: hits.has(locationKey(asset)) ? 'Unverified text hit: ' + hits.get(locationKey(asset))!.join(', ') : 'No proven reference. Manual selection only.', asset }));
				choices.sort((left, right) => Number(hits.has(locationKey(right.asset))) - Number(hits.has(locationKey(left.asset))));
				return (await vscode.window.showQuickPick(choices, { title: 'Dependency Bundle — explicit Snippet selection', placeHolder: 'Generic text hits may be comments/literals. No symbol binding or executable merge; output is review JSON.', canPickMany: true, matchOnDescription: true, matchOnDetail: true }))?.map(item => item.asset);
			},
			warnings: async plan => await vscode.window.showWarningMessage(plan.warnings.join('\n'), { modal: true }, 'Continue') === 'Continue',
			output: async plan => (await vscode.window.showQuickPick([
				{ label: 'Clipboard', value: 'clipboard' as const }, { label: 'Preview / Untitled document', value: 'preview' as const }, { label: 'Save As', value: 'save' as const },
			], { title: plan.reviewOnly ? 'Clean Copy output — review JSON, not executable code' : 'Clean Copy output', placeHolder: 'Original document/file is never modified.' }))?.value,
			preview: async plan => {
				return (await vscode.window.showQuickPick([{ label: 'Copy to Clipboard', value: 'clipboard' as const }, { label: 'Open Untitled document', value: 'untitled' as const }, { label: 'Save As', value: 'save' as const }], { title: 'Exact final Clean Copy preview', placeHolder: 'Escape closes this operation without changing clipboard/files.' }))?.value;
			},
			destination: async plan => vscode.window.showSaveDialog({ title: 'Clean Copy — new file only', defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri.scheme === 'file' ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'tcp-clean' + plan.extension) : undefined, saveLabel: 'Save new copy (never overwrite)' }),
			clipboard: async text => vscode.env.clipboard.writeText(text),
			untitled: async plan => { await this.openUntitled(plan); },
		};
	}
	async showPreview(plan: CleanPlan): Promise<vscode.TextDocument> {
		const document = await vscode.workspace.openTextDocument(this.comparison.snapshot(plan.text, 'clean-preview' + plan.extension));
		if (document.getText() !== plan.text) { throw new Error('VS Code normalized the preview. Exact plan preview is unavailable; no output was applied.'); }
		await vscode.window.showTextDocument(document, { preview: true }); return document;
	}
	async openUntitled(plan: CleanPlan): Promise<vscode.TextDocument> {
		const document = await vscode.workspace.openTextDocument({ content: plan.text, language: plan.language });
		if (document.getText() !== plan.text) { throw new Error('VS Code normalized the new Untitled buffer. Exact output is unavailable.'); }
		await vscode.window.showTextDocument(document, { preview: false }); return document;
	}
	async run(scope: CleanScope, target = this.capture()): Promise<'completed' | 'cancelled'> {
		if (this.busy) { throw new Error('Another Clean Copy operation is active. Finish it first.'); } this.busy = true; this.lastPlan = undefined;
		try {
			if (!['selection', 'file', 'bundle'].includes(scope)) { throw new Error('Unknown Clean Copy scope.'); }
			this.rootGuard(); const snapshot = this.library.catalog.snapshot, stamp = JSON.stringify(this.library.roots()), providerGeneration = this.providers.generation;
			const document = target && vscode.workspace.textDocuments.find(document => !document.isClosed && document.uri.toString() === target.uri.toString());
			if (!snapshot || !document || document.version !== target!.version || !['file', 'untitled'].includes(document.uri.scheme)) { throw new Error('Select an open text editor / Reload library before Clean Copy.'); }
			const fullText = document.getText(), start = scope === 'selection' ? document.offsetAt(target!.selection.start) : 0, end = scope === 'selection' ? document.offsetAt(target!.selection.end) : fullText.length;
			if (scope === 'selection' && start === end) { throw new Error('Select text before Clean Copy Selection.'); }
			if (Buffer.byteLength(fullText) > 16 * 1024 * 1024) { throw new Error('Clean Copy source limit exceeded.'); }
			const fragment: CleanFragment = { fullText, start, end, language: document.languageId }, warnings: string[] = [], associated: AssetLocation[] = [];
			const assertDocument = () => { this.rootGuard(); if (document.isClosed || document.version !== target!.version || document.getText() !== fullText || this.library.catalog.snapshot !== snapshot || JSON.stringify(this.library.roots()) !== stamp || this.providers.generation !== providerGeneration) { throw new Error('Clean Copy source/catalog/root/provider changed. Start again; no output was applied.'); } };
			let physicalSource = document.uri.scheme === 'file' ? document.uri.fsPath : undefined;
			if (physicalSource) { try { physicalSource = await fs.realpath(physicalSource); } catch { /* Unsaved file buffer has no on-disk identity yet. */ } }
			if (physicalSource) { for (const asset of snapshot.snippets.filter(asset => !asset.root.uri)) { if (asset.files.some(file => pathCollisionKey(path.resolve(asset.root.path, asset.relativePath, file.path)) === pathCollisionKey(physicalSource!))) { associated.push(asset); } } }
			for (const marker of relevantMarkerIdentities(fragment)) {
				const matches = snapshot.snippets.filter(asset => asset.metadata.id === marker.id && asset.metadata.version!.text === marker.version);
				if (!matches.length) { warnings.push('TCP marker notice metadata is unavailable in the loaded library. Existing source comments are preserved; TCP does not determine legal obligations.'); }
				associated.push(...matches);
			}
			const preset = await this.interactions.preset(); if (!preset) { return 'cancelled'; }
			let selected: readonly AssetLocation[] = [], bundleAssets: readonly AssetLocation[] = [];
			if (scope === 'bundle') {
				const candidates = bundleCandidates(fullText, snapshot), eligible = snapshot.snippets.filter(asset => asset.usable && !asset.root.uri);
				const choice = await this.interactions.bundle(candidates, eligible); if (!choice) { return 'cancelled'; } selected = choice; bundleAssets = bundleClosure(this.library, selected).assets;
			}
			assertDocument();
			const languages = [fragment.language, ...bundleAssets.flatMap(asset => asset.metadata.sources.map(source => sourceLanguage(source) || 'plaintext'))];
			const available = availableTransforms(this.providers.get(fragment.language)).filter(transform => languages.every(language => availableTransforms(this.providers.get(language)).some(other => other.id === transform.id)));
			const custom = preset === 'Custom' ? await this.interactions.custom(available) : [];
			if (custom === undefined) { return 'cancelled'; } if (custom.some(id => !available.some(transform => transform.id === id))) { throw new Error('Unavailable Custom transform. No fallback was applied.'); }
			const used = [...new Map([...associated, ...bundleAssets].map(asset => [locationKey(asset), asset])).values()];
			const packs = used.map(asset => snapshot.packs.find(pack => sameRoot(pack.root, asset.root) && pack.relativePath === packOf(asset))!);
			if (packs.some(pack => !pack)) { throw new Error('Clean Copy source Pack is not loaded.'); }
			const revalidate = async () => {
				assertDocument();
				if (used.length) {
					const fresh = await loadCatalog(this.library.roots(), this.library.stores);
					for (const asset of used) {
						if (!asset.usable || asset.root.uri) { throw new Error('Clean Copy metadata sources require verified native local assets.'); }
						const conflicts = fresh.snippets.filter(other => locationKey(other) !== locationKey(asset) && other.metadata.id === asset.metadata.id && other.metadata.version!.text === asset.metadata.version!.text && other.semanticHash !== asset.semanticHash);
						if (conflicts.length) { throw new ConflictError('Clean Copy revision conflict. Compare before copying.', { incoming: asset, existing: conflicts }); }
						const current = fresh.snippets.find(other => locationKey(other) === locationKey(asset)); if (!current?.usable || current.integrityHash !== asset.integrityHash) { throw new Error('Clean Copy asset changed. Reload and start again.'); }
						await this.library.assetTree(asset);
					}
					for (const pack of packs) { await this.library.assetTree(pack); }
				}
				assertDocument();
			};
			await revalidate(); const notices = collectNotices([...used, ...packs].map(asset => asset.metadata.document));
			const plan = scope === 'bundle' ? (await bundleReviewPlan(this.library, fragment, preset, selected, this.providers, custom, notices, warnings)).plan
				: textCleanPlan(fragment, this.providers.get(fragment.language), { scope, preset, custom, notices, warnings, extension: path.extname(document.uri.path) || '.txt' });
			this.lastPlan = plan;
			if (plan.warnings.length && !await this.interactions.warnings(plan)) { return 'cancelled'; }
			let output = await this.interactions.output(plan); if (!output) { return 'cancelled'; }
			if (output === 'preview') { await this.showPreview(plan); output = await this.interactions.preview(plan); if (!output) { return 'cancelled'; } }
			if (output === 'save') {
				const destination = await this.interactions.destination(plan); if (!destination) { return 'cancelled'; } if (destination.scheme !== 'file') { throw new Error('Clean Copy Save As requires a native local filesystem.'); }
				const protection: CleanOutputProtection = { sourceFiles: document.uri.scheme === 'file' || document.uri.scheme === 'untitled' && path.isAbsolute(document.uri.fsPath) ? [document.uri.fsPath, ...(physicalSource ? [physicalSource] : [])] : [], libraryRoots: this.library.roots().flatMap(root => !root.uri ? [root.path] : vscode.Uri.parse(root.uri).scheme === 'file' ? [vscode.Uri.parse(root.uri).fsPath] : []) };
				const result = await publishCleanOutput(destination.fsPath, plan.text, protection, revalidate, { assertCurrent: assertDocument }); if (result.cleanupWarning) { void vscode.window.showWarningMessage(result.cleanupWarning); }
			} else {
				await revalidate(); assertDocument();
				if (output === 'clipboard') { await this.interactions.clipboard(plan.text); }
				else if (output === 'untitled') { await this.interactions.untitled(plan); }
				else { throw new Error('Unknown Clean Copy output.'); }
			}
			return 'completed';
		} finally { this.busy = false; }
	}
	dispose(): void { this.lastPlan = undefined; }
}
