import type { AssetLocation } from '../../storage/discovery';

/** Tarjan SCCs followed by dependency-first traversal. UUID order is independent of discovery order. */
export function dependencyOrder(members: readonly AssetLocation[]): AssetLocation[] {
	const byId = new Map(members.map(asset => [asset.metadata.id!, asset]));
	const numbers = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], onStack = new Set<string>(), components: string[][] = [];
	const edges = (id: string) => [...new Set(byId.get(id)!.metadata.dependencies.map(dep => dep.id))].sort();
	const visit = (id: string) => {
		numbers.set(id, numbers.size); low.set(id, numbers.get(id)!); stack.push(id); onStack.add(id);
		for (const dependency of edges(id)) {
			if (!byId.has(dependency)) { throw new Error('Missing dependency in insertion plan.'); }
			if (!numbers.has(dependency)) { visit(dependency); low.set(id, Math.min(low.get(id)!, low.get(dependency)!)); }
			else if (onStack.has(dependency)) { low.set(id, Math.min(low.get(id)!, numbers.get(dependency)!)); }
		}
		if (low.get(id) === numbers.get(id)) { const component: string[] = []; let current: string; do { current = stack.pop()!; onStack.delete(current); component.push(current); } while (current !== id); components.push(component.sort()); }
	};
	for (const id of [...byId.keys()].sort()) { if (!numbers.has(id)) { visit(id); } }
	return components.flatMap(component => component.map(id => byId.get(id)!));
}
