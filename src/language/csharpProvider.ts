import type { CleanLanguageProvider } from '../core/clean/types';
import { CSharpClient } from './csharpClient';

export class CSharpProvider {
	constructor(readonly client: CSharpClient, readonly policy: () => 'none' | 'atcoder-20261014' = () => 'none') {}
	get configured(): boolean { return this.client.configured; }
	async analyze(sources: readonly string[]) { return this.client.request('analyze', sources.map((source, i) => ({ id: 'source-' + i + '.cs', source }))); }
	async validate(source: string): Promise<string[]> { const response = await this.client.request('validate', [{ id: 'target.cs', source }]); return response.diagnostics; }
	async place(source: string, incoming: string, offset: number, targets: readonly string[]) { return this.client.request('place', [{ id: 'target.cs', source }], { source: incoming, offset, targets }); }
	async header(source: string, notices: readonly string[], urls: readonly string[]): Promise<string> { return (await this.client.request('header', [{ id: 'output.cs', source }], { notices, urls })).result.text; }
	async markers(source: string) { return (await this.client.request('markers', [{ id: 'target.cs', source }])).result.markers; }
	cleanProvider(): CleanLanguageProvider {
		const transforms = [
			['remove-tcp-markers', 'Remove syntax-proven TCP marker pairs'], ['remove-comments', 'Remove ordinary comments (retain attribution/header/notices)'],
			['remove-xml-docs', 'Remove XML documentation (retain attribution/header/notices)'], ['remove-unused-usings', 'Remove semantically proven unused usings (standalone complete file)'], ['normalize-whitespace', 'Roslyn whitespace normalization (complete directive-free file)'],
		].map(([id, label]) => ({ id, label, capability: id, apply: () => { throw new Error('Roslyn transforms require the async pipeline.'); }, applyAsync: async (text: string, original: { fullText: string; start: number; end: number }) => {
			const fullText = original.fullText.slice(0, original.start) + text + original.fullText.slice(original.end);
			const response = await this.client.request('clean', [{ id: 'clean.cs', source: fullText }], { start: original.start, end: original.start + text.length, transforms: [id], protectAllComments: this.policy() === 'atcoder-20261014' });
			return { text: response.result.text, warnings: [...response.diagnostics, ...response.result.warnings] };
		} }));
		return { id: 'csharp-roslyn-v1', capabilities: new Set([...transforms.map(t => t.id), 'license-comment-header']), transforms,
			presets: { Readable: ['remove-tcp-markers'], Competitive: ['remove-tcp-markers', 'remove-unused-usings', 'normalize-whitespace'] },
			attachNotices: async (text, notices, fragment) => { if (fragment.start !== 0 || fragment.end !== fragment.fullText.length) { throw new Error('C# notice attachment requires a complete file; selection context cannot prove a safe header.'); } return this.header(text, notices, []); },
		};
	}
	dispose(): void { this.client.dispose(); }
}
