import { compareVersions, parseVersion, type AssetVersion } from './parser';

type Operator = '=' | '>' | '>=' | '<' | '<=';
interface Bound { readonly operator: Operator; readonly version: AssetVersion }
export interface VersionConstraint { readonly bounds: readonly Bound[]; readonly empty: boolean }

export function satisfies(version: AssetVersion, constraint: VersionConstraint): boolean {
	return !constraint.empty && constraint.bounds.every(bound => {
		const order = compareVersions(version, bound.version);
		switch (bound.operator) {
			case '=': return order === 0;
			case '>': return order > 0;
			case '>=': return order >= 0;
			case '<': return order < 0;
			case '<=': return order <= 0;
		}
	});
}

/** Only omitted constraints mean any; malformed or empty filters never broaden a search. */
export function parseConstraint(text?: string): VersionConstraint {
	if (text === undefined) { return { bounds: [], empty: false }; }
	if (!text.trim() || text.length > 8192) { throw new Error('Empty or oversized version constraint.'); }
	const tokens = text.trim().split(/\s+/);
	if (tokens.length > 32) { throw new Error('Too many version bounds.'); }
	const bounds = tokens.map(token => {
		const match = /^(>=|<=|=|>|<)(v.+)$/.exec(token);
		if (!match) { throw new Error('Use comparison operators and canonical versions, separated by whitespace.'); }
		return { operator: match[1] as Operator, version: parseVersion(match[2]) };
	});
	let lower = parseVersion('v0.0.0');
	let upper: AssetVersion | undefined;
	let lowerInclusive = true;
	let upperInclusive = true;
	for (const { operator, version } of bounds) {
		if (operator === '=' || operator === '>' || operator === '>=') {
			const order = compareVersions(version, lower);
			if (order > 0) { lower = version; lowerInclusive = operator !== '>'; }
			else if (order === 0) { lowerInclusive &&= operator !== '>'; }
		}
		if (operator === '=' || operator === '<' || operator === '<=') {
			const order = upper ? compareVersions(version, upper) : -1;
			if (order < 0) { upper = version; upperInclusive = operator !== '<'; }
			else if (order === 0) { upperInclusive &&= operator !== '<'; }
		}
	}
	// The version domain is discrete, including the separate missing-patch sentinel.
	const next = [...lower.parts] as [bigint, bigint, bigint, bigint];
	const max = 10n ** 32n - 1n;
	let exhausted = false;
	if (!lowerInclusive) {
		let index = 3;
		while (index >= 0 && next[index] === max) { next[index] = index === 3 ? -1n : 0n; index--; }
		if (index < 0) { exhausted = true; } else { next[index]++; }
	}
	const minimum: AssetVersion = { text: '', parts: next };
	const empty = exhausted || (upper !== undefined && (compareVersions(minimum, upper) > 0
		|| (compareVersions(minimum, upper) === 0 && !upperInclusive)));
	return { bounds, empty };
}
