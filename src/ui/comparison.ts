import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { ConflictError } from '../core/conflict';
import type { Library } from '../application/library';
import type { AssetLocation } from '../storage/discovery';
import { treeDirectories, type FileTree } from '../storage/transaction';
import { sha256 } from '../core/assets/fingerprint';
import type { InsertionPlan } from '../application/insertionPipeline';

/** Ephemeral readonly documents; they cannot become an InsertionAdapter target. */
export class ComparisonDocuments implements vscode.TextDocumentContentProvider, vscode.Disposable {
	private readonly content = new Map<string, string>();
	private readonly registration = vscode.workspace.registerTextDocumentContentProvider('tcp-review', this);
	provideTextDocumentContent(uri: vscode.Uri): string { return this.content.get(uri.toString()) ?? 'Comparison expired. Reopen Compare to refresh the snapshots.'; }
	snapshot(text: string, name = 'snapshot.txt'): vscode.Uri {
		if (Buffer.byteLength(text) > 32 * 1024 * 1024) { throw new Error('Comparison text size limit exceeded.'); }
		const uri = vscode.Uri.from({ scheme: 'tcp-review', authority: randomUUID(), path: '/' + name }); this.content.set(uri.toString(), text);
		while (this.content.size > 24 || [...this.content.values()].reduce((size, value) => size + Buffer.byteLength(value), 0) > 64 * 1024 * 1024) { this.content.delete(this.content.keys().next().value!); } return uri;
	}
	async diff(current: string, incoming: string, title: string, filename = 'snapshot.txt'): Promise<void> {
		await vscode.commands.executeCommand('vscode.diff', this.snapshot(current, filename), this.snapshot(incoming, filename), title, { preview: true });
	}
	async trees(current: FileTree, incoming: FileTree): Promise<void> {
		const names = [...new Set([...current.keys(), ...incoming.keys()])].sort();
		const directories = JSON.stringify(treeDirectories(current)) !== JSON.stringify(treeDirectories(incoming));
		const chosen = await vscode.window.showQuickPick([...names.map(name => ({ label: name, description: !current.has(name) ? 'Addition' : !incoming.has(name) ? 'Removal' : current.get(name)!.equals(incoming.get(name)!) ? 'Identical bytes' : 'Changed bytes', directory: false })), ...(directories ? [{ label: 'Directories (including empty folders)', description: 'Changed directory manifest', directory: true }] : [])], { title: 'Compare Pack / Snippet files', placeHolder: 'Current on the left, requested on the right. No changes are applied.' });
		if (chosen?.directory) { await this.diff(treeDirectories(current).join('\n'), treeDirectories(incoming).join('\n'), 'TCP Compare · directories'); }
		else if (chosen) { await this.diff(displayBytes(current.get(chosen.label)), displayBytes(incoming.get(chosen.label)), 'TCP Compare · ' + chosen.label, chosen.label); }
	}
	async preview(plan: InsertionPlan, choose?: (compared: boolean) => Promise<'Compare' | 'Insert' | undefined>): Promise<boolean> {
		const content = plan.output ? [...plan.output.files].map(([name, text]) => `--- ${name} ---\n${text}`).join('\n\n') : plan.after;
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(this.snapshot(content, 'insertion-preview.txt')), { preview: true });
		let compared = false;
		for (;;) {
			const choice = choose ? await choose(compared) : await vscode.window.showInformationMessage('Insertion preview — target is unchanged.', { modal: !compared }, 'Compare', 'Insert');
			if (choice === 'Insert') { return true; } if (choice !== 'Compare') { return false; }
			if (plan.output) { const name = await vscode.window.showQuickPick([...plan.output.files.keys()], { title: 'Compare new output file', placeHolder: 'File creation is outside editor Undo.' }); if (name) { await this.diff('', plan.output.files.get(name)!, 'TCP Preview · ' + name, name); } }
			else { await this.diff(plan.before, plan.after, 'TCP Insertion Preview'); } compared = true;
		}
	}
	async assets(library: Library, incoming: AssetLocation, existing: readonly AssetLocation[]): Promise<void> {
		const other = existing.length === 1 ? existing[0] : (await vscode.window.showQuickPick(existing.map(asset => ({ label: asset.metadata.name!, description: `${asset.metadata.version!.text} · ${asset.root.scope} · ${asset.packName}`, asset })), { title: 'Choose existing revision to compare' }))?.asset;
		if (other) { await this.trees(await library.assetTree(other), await library.assetTree(incoming)); }
	}
	async conflict(library: Library, error: ConflictError): Promise<void> {
		const incoming = error.evidence.incoming, editable = incoming?.metadata.canEdit && library.catalog.snapshot && [...library.catalog.snapshot.packs, ...library.catalog.snapshot.snippets].includes(incoming);
		const choice = await vscode.window.showWarningMessage(error.message + '\nInsertion/copy/import stopped. Compare is evidence only; no replacement is applied. Use Edit Metadata to create a newer revision, or Import Pack to explicitly Fork.', { modal: true }, 'Compare', ...(editable ? ['New Version (metadata form)'] : []));
		if (choice === 'New Version (metadata form)' && incoming) { await vscode.commands.executeCommand('turbo-code-palette.edit', JSON.stringify([incoming.root.uri ?? incoming.root.path, incoming.relativePath])); return; }
		if (choice !== 'Compare') { return; }
		if (error.evidence.currentText !== undefined) { await this.diff(error.evidence.currentText, error.evidence.requestedText ?? '', 'TCP Conflict · current target / requested sources'); }
		else if (error.evidence.incoming && error.evidence.existing?.length) { await this.assets(library, error.evidence.incoming, error.evidence.existing); }
	}
	dispose(): void { this.registration.dispose(); this.content.clear(); }
}
export function displayBytes(bytes?: Buffer): string {
	if (!bytes) { return ''; }
	try { if (bytes.includes(0)) { throw new Error('Binary'); } return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
	catch { return `[Binary/non-UTF-8 file: ${bytes.length} bytes, SHA-256 ${sha256(bytes)}. Text comparison unavailable.]`; }
}
