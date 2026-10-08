export interface AssetVersion {
	readonly text: string;
	readonly parts: readonly [bigint, bigint, bigint, bigint];
}

export function parseVersion(text: string): AssetVersion {
	const match = /^v(0|[1-9]\d{0,31})\.(0|[1-9]\d{0,31})\.(0|[1-9]\d{0,31})(?:-(0|[1-9]\d{0,31}))?$/.exec(text);
	if (!match) { throw new Error('Expected canonical asset version vMAJOR.MIDDLE.MINOR[-PATCH].'); }
	return Object.freeze({ text, parts: Object.freeze([BigInt(match[1]), BigInt(match[2]), BigInt(match[3]),
		match[4] === undefined ? -1n : BigInt(match[4])]) as AssetVersion['parts'] });
}

export function compareVersions(left: AssetVersion, right: AssetVersion): number {
	for (let i = 0; i < 4; i++) {
		if (left.parts[i] !== right.parts[i]) { return left.parts[i] < right.parts[i] ? -1 : 1; }
	}
	return 0;
}
