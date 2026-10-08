/** Phase 0 proves only text insertion. Asset loading belongs to Phase 1+. */
export type DemoMode = 'cursor' | 'end-of-file';

export interface DemoSnippet {
	readonly id: string;
	readonly name: string;
	readonly mode: DemoMode;
	readonly text: string;
}

export interface TextInsertionPlan {
	readonly offset: number;
	readonly text: string;
}

export function planDemoInsertion(
	snippet: DemoSnippet,
	documentText: string,
	dropOffset: number,
	eol: '\n' | '\r\n',
): TextInsertionPlan {
	if (!Number.isInteger(dropOffset) || dropOffset < 0 || dropOffset > documentText.length) {
		throw new RangeError('Insertion offset is outside the document.');
	}
	return Object.freeze({
		offset: snippet.mode === 'end-of-file' ? documentText.length : dropOffset,
		text: snippet.text.replace(/\r\n|\r|\n/g, eol),
	});
}
