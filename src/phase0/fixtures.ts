import type { DemoSnippet } from '../core/insertion/plan';

/** Synthetic source-only demos: never write personal Global/Workspace snippet data. */
export const demoSnippets: readonly DemoSnippet[] = Object.freeze([
	Object.freeze({ id: 'phase0-cursor', name: 'Cursor demo', mode: 'cursor' as const,
		text: '// TCP Phase 0 cursor demo\nConsole.WriteLine("TCP cursor");\n' }),
	Object.freeze({ id: 'phase0-eof', name: 'End-of-file demo', mode: 'end-of-file' as const,
		text: '\n// TCP Phase 0 EOF demo\nConsole.WriteLine("TCP EOF");\n' }),
]);

export const dropTargetText = '// TCP Phase 0 drop target\n// Drop on the blank line below.\n\n// End of target\n';
