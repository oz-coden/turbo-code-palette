import type { InsertMode } from './modes';
export interface OffsetEdit { readonly start: number; readonly end: number; readonly text: string }
export function planText(text: string, selection: { start: number; end: number; active: number }, items: readonly { mode: InsertMode; sources: readonly string[] }[], eol: string): OffsetEdit[] {
	const edits: OffsetEdit[] = [];
	for (const item of items) {
		if (item.mode === 'separate-files') { throw new Error('File and editor operations cannot be mixed in an atomic v1 plan.'); }
		const start = item.mode === 'end-of-file' || item.mode === 'structure-aware' ? text.length : item.mode === 'replace-selection' ? selection.start : selection.active;
		const end = item.mode === 'replace-selection' ? selection.end : start;
		if (start < 0 || end < start || end > text.length) { throw new Error('Invalid captured target offset.'); }
		const content = item.sources.map(source => source.replace(/\r\n|\r|\n/g, eol)).join(eol);
		if (!content) { throw new Error('Empty source cannot be inserted.'); }
		const previous = edits.find(edit => edit.start === start && edit.end === start);
		if (previous && end === start) { edits[edits.indexOf(previous)] = { ...previous, text: previous.text + eol + content }; }
		else { edits.push({ start, end, text: content }); }
	}
	const sorted = edits.sort((a, b) => a.start - b.start || a.end - b.end);
	for (let index = 1; index < sorted.length; index++) { const before = sorted[index - 1], current = sorted[index]; if (current.start < before.end || current.start === before.start) { throw new Error('Overlapping insertion ranges. Select non-overlapping modes.'); } }
	return sorted;
}
export function applyText(text: string, edits: readonly OffsetEdit[]): string { let result = text; for (const edit of [...edits].reverse()) { result = result.slice(0, edit.start) + edit.text + result.slice(edit.end); } return result; }
