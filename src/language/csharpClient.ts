import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Stats } from 'node:fs';

export interface CSharpDocument { readonly id: string; readonly source: string }
export interface CSharpOptions { readonly languageVersion?: string; readonly defines?: readonly string[] }
export interface CSharpExport { readonly kind: string; readonly name: string; readonly namespace: string; readonly container: string; readonly signature: string; readonly accessibility: string; readonly genericArity: number }
export interface CSharpResults {
	analyze: { exports: CSharpExport[]; syntaxValid: boolean; semanticErrors: string[] };
	place: { offset: number; text: string; context: string };
	validate: { valid: true };
	references: { documents: string[]; references: { document: string; name: string; namespace: string; container: string; signature: string }[] };
	bundle: { text: string; validated: string };
	clean: { text: string; warnings: string[] };
	header: { text: string };
	markers: { markers: { id: string; version: string; contentHash: string }[] };
}
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 10000 && value.every(item => typeof item === 'string');
function validResult(operation: keyof CSharpResults, value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) { return false; } const r = value as Record<string, unknown>;
	switch (operation) {
		case 'analyze': return typeof r.syntaxValid === 'boolean' && strings(r.semanticErrors) && Array.isArray(r.exports) && r.exports.length <= 10000 && r.exports.every(e => e && ['kind', 'name', 'namespace', 'container', 'signature', 'accessibility'].every(key => typeof e[key] === 'string') && Number.isSafeInteger(e.genericArity));
		case 'place': return Number.isSafeInteger(r.offset) && Number(r.offset) >= 0 && typeof r.text === 'string' && typeof r.context === 'string';
		case 'validate': return r.valid === true;
		case 'references': return strings(r.documents) && Array.isArray(r.references) && r.references.length <= 10000 && r.references.every(item => item && ['document', 'name', 'namespace', 'container', 'signature'].every(k => typeof item[k] === 'string'));
		case 'bundle': return typeof r.text === 'string' && r.validated === 'standalone-runtime-compilation';
		case 'clean': return typeof r.text === 'string' && strings(r.warnings);
		case 'header': return typeof r.text === 'string';
		case 'markers': return Array.isArray(r.markers) && r.markers.length <= 10000 && r.markers.every(m => m && typeof m.id === 'string' && typeof m.version === 'string' && typeof m.contentHash === 'string');
	}
}
export interface HelperSettings { readonly dll: string; readonly timeoutMs?: number; readonly idleMs?: number; readonly options?: CSharpOptions }
/** No shell, workspace command, MSBuild, generator, script, source paths or project loading. */
export class CSharpClient {
	private process?: ChildProcessWithoutNullStreams;
	private buffer = Buffer.alloc(0);
	private pending?: { id: string; operation: keyof CSharpResults; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; cleanup(): void };
	private idle?: ReturnType<typeof setTimeout>;
	private starting = false;
	private disposed = false;
	private generation = 0;
	status = 'C# semantic provider unavailable: helper not configured.';
	lastMetrics?: { elapsedMs: number; workingSetBytes: number; managedBytes: number };
	constructor(readonly settings: HelperSettings, private readonly inspect: (filename: string) => Promise<Stats> = filename => fs.lstat(filename)) {}
	get configured(): boolean { return !!this.settings.dll; }
	get running(): boolean { return !!this.process; }
	cancel(): void { if (this.pending || this.starting) { if (this.pending) { this.process?.stdin.write(JSON.stringify({ protocolVersion: 1, id: this.pending.id, operation: 'cancel' }) + '\n'); } this.stop('cancelled'); } }
	private stop(reason: string): void {
		++this.generation;
		this.status = 'C# semantic provider unavailable: ' + reason;
		if (this.idle) { clearTimeout(this.idle); this.idle = undefined; }
		const process = this.process; this.process = undefined; this.buffer = Buffer.alloc(0);
		const pending = this.pending; this.pending = undefined;
		if (pending) { clearTimeout(pending.timer); pending.cleanup(); pending.reject(new Error(this.status)); }
		process?.kill();
	}
	async request<K extends keyof CSharpResults>(operation: K, documents: readonly CSharpDocument[], extra: Record<string, unknown> = {}, signal?: AbortSignal): Promise<{ result: CSharpResults[K]; diagnostics: string[] }> {
		if (this.disposed || this.pending || this.starting) { throw new Error('C# helper disposed/busy; concurrency limit is one.'); }
		if (signal?.aborted) { throw new Error('C# request cancelled.'); }
		const id = randomUUID(), line = JSON.stringify({ protocolVersion: 1, id, operation, input: { ...extra, documents, options: this.settings.options ?? {} } }) + '\n';
		if (Buffer.byteLength(line) > 8 * 1024 * 1024) { throw new Error('C# helper request size limit exceeded.'); }
		this.starting = true; const generation = this.generation;
		try {
			if (!this.process) {
				if (!path.isAbsolute(this.settings.dll) || path.extname(this.settings.dll).toLowerCase() !== '.dll') { throw new Error('Configure an absolute trusted helper DLL path (machine setting).'); }
				const stat = await this.inspect(this.settings.dll); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) { throw new Error('Helper DLL must be a regular unlinked file.'); }
				if (this.disposed) { throw new Error('Helper disposed during startup.'); }
				if (signal?.aborted || generation !== this.generation) { throw new Error('Request cancelled during startup.'); }
				const env: NodeJS.ProcessEnv = {}; for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'DOTNET_ROOT', 'DOTNET_ROOT_X64']) { if (process.env[key]) { env[key] = process.env[key]; } }
				const child = spawn('dotnet', [this.settings.dll], { shell: false, windowsHide: true, cwd: path.dirname(this.settings.dll), env }); this.process = child;
				child.stdout.on('data', (chunk: Buffer) => {
					if (this.process !== child) { return; } if (this.buffer.length + chunk.length > 16 * 1024 * 1024) { this.stop('response size limit'); return; }
					this.buffer = Buffer.concat([this.buffer, chunk]); let end: number;
					while ((end = this.buffer.indexOf(10)) >= 0) {
						const message = this.buffer.subarray(0, end); this.buffer = this.buffer.subarray(end + 1);
						try {
							const r = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(message)) as Record<string, unknown>, pending = this.pending;
							if (!pending || r.protocolVersion !== 1 || r.id !== pending.id || typeof r.ok !== 'boolean' || !strings(r.diagnostics) || r.ok && !validResult(pending.operation, r.result)) { throw new Error('protocol mismatch/malformed response'); }
							if (r.metrics !== undefined) { const m = r.metrics as Record<string, unknown>; if (!m || !['elapsedMs', 'workingSetBytes', 'managedBytes'].every(k => typeof m[k] === 'number' && Number.isFinite(m[k]) && Number(m[k]) >= 0)) { throw new Error('Invalid metrics.'); } this.lastMetrics = m as unknown as typeof this.lastMetrics; }
							this.pending = undefined; clearTimeout(pending.timer); pending.cleanup();
							if (r.ok) { this.status = 'C# Roslyn provider ready (standalone context).'; pending.resolve({ result: r.result, diagnostics: r.diagnostics }); }
							else { this.status = 'C# analysis refused: ' + r.diagnostics.join('; '); pending.reject(new Error(this.status)); }
							this.idle = setTimeout(() => this.stop('idle shutdown; starts on next request'), this.settings.idleMs ?? 30000); this.idle.unref();
						} catch { this.stop('protocol mismatch/malformed response'); return; }
					}
				});
				// Drain logs, never put untrusted source/path/exception text in the extension output.
				let stderrBytes = 0; child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 64 * 1024 && this.process === child) { this.stop('stderr limit'); } });
				child.on('error', () => { if (this.process === child) { this.stop('runtime/helper launch failed'); } });
				child.on('exit', () => { if (this.process === child) { this.stop('helper exited/crashed or required runtime missing'); } });
				child.stdin.on('error', () => { if (this.process === child) { this.stop('stdin transport closed'); } });
			}
		} catch (error) { this.status = 'C# semantic provider unavailable: ' + ((error as NodeJS.ErrnoException).code ?? (error as Error).message); throw new Error(this.status); }
		finally { this.starting = false; }
		if (signal?.aborted) { this.stop('cancelled'); throw new Error(this.status); }
		if (this.idle) { clearTimeout(this.idle); this.idle = undefined; }
		return new Promise((resolve, reject) => {
			const cancel = () => this.cancel();
			const timer = setTimeout(() => this.stop('request timeout'), this.settings.timeoutMs ?? 10000);
			this.pending = { id, operation, resolve: value => resolve(value as { result: CSharpResults[K]; diagnostics: string[] }), reject, timer, cleanup: () => signal?.removeEventListener('abort', cancel) };
			signal?.addEventListener('abort', cancel, { once: true }); this.process!.stdin.write(line);
		});
	}
	dispose(): void { this.disposed = true; this.stop('disposed'); }
}
