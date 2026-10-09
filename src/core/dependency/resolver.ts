import { compareVersions } from '../version/parser';
import { satisfies } from '../version/constraint';
import type { AssetLocation } from '../../storage/discovery';

export interface Closure { readonly members: readonly AssetLocation[]; readonly added: readonly AssetLocation[]; readonly warnings: readonly string[] }
const supported = (asset: AssetLocation) => asset.metadata.valid && ['legacy', 'current'].includes(asset.metadata.document.format)
	&& !asset.metadata.blockedFeatures.has('dependencies') && !!asset.semanticHash;

/** Pack construction resolver: one revision per UUID, with backtracking for intersecting ranges. */
export function resolveClosure(roots: readonly AssetLocation[], candidates: readonly AssetLocation[],
	options: { workspaceId?: string; forbidden?: ReadonlySet<string>; signal?: AbortSignal; maxNodes?: number; strictConflicts?: boolean } = {}): Closure {
	if (roots.length > 256 || candidates.length > 20000) { throw new Error('Dependency candidate limit exceeded.'); }
	const fixed = new Map<string, AssetLocation>();
	for (const asset of roots) {
		if (!supported(asset)) { throw new Error('Unsupported or invalid Snippet dependency metadata.'); }
		const previous = fixed.get(asset.metadata.id!);
		if (previous && (previous.metadata.version!.text !== asset.metadata.version!.text || previous.semanticHash !== asset.semanticHash)) {
			throw new Error('One Pack cannot contain multiple versions or implementations of the same Snippet UUID.');
		}
		fixed.set(asset.metadata.id!, asset);
	}
	if ([...fixed.values()].some(asset => asset.metadata.dependencies.some(dependency => options.forbidden?.has(dependency.id)))) { throw new Error('Cannot remove a Snippet still required by a remaining member.'); }
	const byId = new Map<string, AssetLocation[]>();
	for (const asset of candidates.filter(supported)) {
		const list = byId.get(asset.metadata.id!) ?? []; list.push(asset); byId.set(asset.metadata.id!, list);
	}
	const scope = (asset: AssetLocation) => asset.root.workspaceId === options.workspaceId && options.workspaceId ? 0 : asset.root.scope === 'workspace' ? 1 : 2;
	for (const list of byId.values()) { list.sort((a, b) => scope(a) - scope(b) || -compareVersions(a.metadata.version!, b.metadata.version!) || a.relativePath.localeCompare(b.relativePath, 'en')); }
	let nodes = 0;
	const deadline = Date.now() + 2000;
	const solve = (selected: Map<string, AssetLocation>): Map<string, AssetLocation> | undefined => {
		if (options.signal?.aborted) { throw new Error('Cancelled.'); }
		if (++nodes > (options.maxNodes ?? 10000) || selected.size > 256 || Date.now() > deadline) { throw new Error('Dependency search limit exceeded.'); }
		const constraints = new Map<string, AssetLocation['metadata']['dependencies'][number][]>();
		for (const asset of selected.values()) {
			for (const dependency of asset.metadata.dependencies) {
				if (options.forbidden?.has(dependency.id)) { return undefined; }
				const list = constraints.get(dependency.id) ?? []; list.push(dependency); constraints.set(dependency.id, list);
			}
		}
		for (const [id, required] of constraints) {
			const existing = selected.get(id);
			if (existing && !required.every(dependency => satisfies(existing.metadata.version!, dependency.constraint))) { return undefined; }
		}
		const unresolved = [...constraints.keys()].filter(id => !selected.has(id)).sort();
		if (!unresolved.length) { return selected; }
		const id = unresolved[0], required = constraints.get(id)!;
		const suitable = (byId.get(id) ?? []).filter(asset => required.every(dependency => satisfies(asset.metadata.version!, dependency.constraint)));
		// Never select one implementation silently when a revision has conflicting copies.
		const implementations = new Map<string, Set<string>>();
		for (const asset of suitable) { const revision = asset.metadata.version!.text, hashes = implementations.get(revision) ?? new Set<string>(); hashes.add(asset.semanticHash!); implementations.set(revision, hashes); }
		const conflicts = new Set([...implementations].filter(([, hashes]) => hashes.size > 1).map(([version]) => version));
		if (options.strictConflicts && conflicts.size) { throw new Error('Conflicting dependency implementations. Compare/select before insertion; automatic substitution is disabled.'); }
		const seen = new Set<string>();
		for (const asset of suitable) {
			if (conflicts.has(asset.metadata.version!.text) || seen.has(asset.metadata.version!.text)) { continue; }
			seen.add(asset.metadata.version!.text);
			const next = new Map(selected); next.set(id, asset);
			const result = solve(next); if (result) { return result; }
		}
		return undefined;
	};
	const resolved = solve(fixed);
	if (!resolved) { throw new Error('No unambiguous dependency closure satisfies all version constraints. Select a revision/location or repair the dependency.'); }
	const members = [...resolved.values()].sort((a, b) => a.metadata.id!.localeCompare(b.metadata.id!, 'en'));
	const warnings = members.flatMap(asset => asset.metadata.dependencies.filter(dependency => resolved.get(dependency.id)?.metadata.name !== dependency.name)
		.map(dependency => `Dependency name differs: ${dependency.name}`));
	return { members, added: members.filter(asset => !fixed.has(asset.metadata.id!)), warnings };
}

export function validatePackDependencies(members: readonly AssetLocation[]): void { resolveClosure(members, members); }
