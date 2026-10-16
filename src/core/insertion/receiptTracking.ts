import { applyText, type OffsetEdit } from './textPlan';

export interface TextTransition { readonly before: string; readonly after: string; readonly edits: readonly OffsetEdit[] }
/** A conservative contiguous change, not a semantic diff. Wide changes invalidate evidence. */
export function changedRange(before: string, after: string): OffsetEdit[] {
	if (before === after) { return []; }
	let start = 0, oldEnd = before.length, newEnd = after.length;
	while (start < oldEnd && start < newEnd && before[start] === after[start]) { start++; }
	if (start && /[\uDC00-\uDFFF]/.test(before[start] ?? '') && /[\uD800-\uDBFF]/.test(before[start - 1])) { start--; }
	while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
	if (oldEnd < before.length && /[\uDC00-\uDFFF]/.test(before[oldEnd]) && /[\uD800-\uDBFF]/.test(before[oldEnd - 1] ?? '')) { oldEnd++; newEnd++; }
	return [{ start, end: oldEnd, text: after.slice(start, newEnd) }];
}

/** Requires an already verified full-document receipt. A body match alone grants no identity. */
export function receiptSurvives(before: string, after: string, body: string, transitions: readonly TextTransition[]): boolean {
	let start = before.indexOf(body), end = start + body.length, current = before;
	if (!body || start < 0 || before.indexOf(body, start + 1) >= 0) { return false; }
	for (const transition of transitions) {
		if (transition.before !== current || applyText(current, transition.edits) !== transition.after) { return false; }
		if (transition.edits.some(edit => edit.start < end && edit.end > start || edit.start === edit.end && edit.start > start && edit.start < end)) { return false; }
		const shift = transition.edits.filter(edit => edit.end <= start).reduce((sum, edit) => sum + edit.text.length - (edit.end - edit.start), 0);
		start += shift; end += shift; current = transition.after;
		if (current.slice(start, end) !== body) { return false; }
	}
	return current === after && after.indexOf(body) === start && after.indexOf(body, start + 1) < 0;
}
