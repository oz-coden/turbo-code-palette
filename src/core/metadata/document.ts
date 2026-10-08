import { applyEdits, createScanner, findNodeAtLocation, modify, parseTree, SyntaxKind, type Node, type ParseError } from 'jsonc-parser';

export type FormatState = 'legacy' | 'current' | 'future' | 'invalid';
export interface MetadataDiagnostic { readonly code: string; readonly path?: readonly (string | number)[] }
const scalarFields = new Set(['id', 'name', 'version', 'description', 'category', 'notes', 'status']);
const arrays = new Set(['languages', 'tags', 'features', 'sources']);

function numericFormat(raw: string): FormatState {
	const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
	if (!match) { return 'invalid'; }
	let digits = (match[2] + (match[3] ?? '')).replace(/^0+/, '');
	if (!digits) { return 'legacy'; }
	if (match[1]) { return 'invalid'; }
	// Only classify 0, 1 or greater; never round/expand a huge JSON number.
	const exponent = Math.max(-raw.length - 1, Math.min(raw.length + 1, Number(match[4] ?? 0)));
	const scale = exponent - (match[3]?.length ?? 0);
	if (scale < 0) {
		const split = digits.length + scale;
		if (split <= 0 || !/^0+$/.test(digits.slice(split))) { return 'invalid'; }
		digits = digits.slice(0, split);
	}
	return digits === '1' && scale <= 0 ? 'current' : 'future';
}

function editablePath(path: readonly (string | number)[]): boolean {
	if (path.length === 1) { return scalarFields.has(String(path[0])) || arrays.has(String(path[0])); }
	if (path[0] === 'insert' && path.length === 2) { return ['defaultMode', 'allowedModes', 'deniedModes', 'targets'].includes(String(path[1])); }
	if (typeof path[1] === 'number' && path.length === 3) {
		const keys: Record<string, readonly string[]> = {
			dependencies: ['id', 'name', 'version'], exports: ['kind', 'name', 'container', 'namespace', 'signature'],
			templateVariables: ['name', 'required', 'default', 'options'],
		};
		return Object.hasOwn(keys, String(path[0])) && keys[String(path[0])].includes(String(path[2]));
	}
	return false;
}

export class MetadataDocument {
	readonly root?: Node;
	readonly diagnostics: readonly MetadataDiagnostic[];
	readonly format: FormatState;

	constructor(readonly text: string) {
		const diagnostics: MetadataDiagnostic[] = [];
		if (new TextEncoder().encode(text).length > 1024 * 1024) { diagnostics.push({ code: 'metadata-size-limit' }); }
		else {
			const scanner = createScanner(text, true);
			let depth = 0;
			for (let kind = scanner.scan(); kind !== SyntaxKind.EOF; kind = scanner.scan()) {
				if (kind === SyntaxKind.OpenBraceToken || kind === SyntaxKind.OpenBracketToken) { depth++; }
				if (kind === SyntaxKind.CloseBraceToken || kind === SyntaxKind.CloseBracketToken) { depth--; }
				if (depth > 64) { diagnostics.push({ code: 'metadata-depth-limit' }); break; }
			}
			if (!diagnostics.length) {
				const errors: ParseError[] = [];
				this.root = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
				if (errors.length || this.root?.type !== 'object') { diagnostics.push({ code: 'invalid-json-object' }); }
				else {
					const walk = (node: Node, path: (string | number)[]) => {
						if (node.type === 'object') {
							const keys = new Set<string>();
							for (const property of node.children ?? []) {
								const key = property.children![0].value as string;
								if (keys.has(key)) { diagnostics.push({ code: 'duplicate-key', path: [...path, key] }); }
								keys.add(key);
								walk(property.children![1], [...path, key]);
							}
						} else if (node.type === 'array') { node.children?.forEach((child, index) => walk(child, [...path, index])); }
					};
					walk(this.root, []);
				}
			}
		}
		this.diagnostics = diagnostics;
		const node = this.node(['formatVersion']);
		const raw = this.raw(['formatVersion']);
		this.format = diagnostics.length ? 'invalid' : !node ? 'legacy'
			: node.type !== 'number' ? 'invalid' : numericFormat(raw!);
	}
	node(path: readonly (string | number)[]): Node | undefined { return this.root && findNodeAtLocation(this.root, [...path]); }
	raw(path: readonly (string | number)[]): string | undefined {
		const node = this.node(path);
		return node && this.text.slice(node.offset, node.offset + node.length);
	}
	string(path: readonly (string | number)[]): string | undefined {
		const node = this.node(path);
		return node?.type === 'string' ? node.value as string : undefined;
	}
	patchKnown(path: readonly (string | number)[], value: unknown): MetadataDocument {
		if (this.format !== 'current' || !editablePath(path)) { throw new Error('Structured edit is not allowed for this format or metadata path.'); }
		if (path.length === 3 && (!Number.isSafeInteger(path[1]) || Number(path[1]) < 0 || this.node(path.slice(0, 2))?.type !== 'object')) {
			throw new Error('Edit an existing metadata entry by its valid array index.');
		}
		if (path.length === 2 && this.node([path[0]]) && this.node([path[0]])?.type !== 'object') {
			throw new Error('Cannot replace an incompatible parent container.');
		}
		if (this.node(path)?.type === 'array' && this.node(path)?.children?.some(child => child.type !== 'string')) {
			throw new Error('Do not replace an array containing unknown structured values.');
		}
		if (this.node(path)?.type === 'object' || (this.node(path)?.type === 'array' && path.length !== 1 && path[0] !== 'insert' && path[2] !== 'options')) {
			throw new Error('Edit known child fields without replacing an open metadata container.');
		}
		// Limit edits to primitive values and arrays of strings, preserving unknown siblings.
		const key = String(path[path.length - 1]);
		const expectsArray = (path.length === 1 && arrays.has(key)) || ['allowedModes', 'deniedModes', 'targets', 'options'].includes(key);
		const validValue = expectsArray ? Array.isArray(value) && value.every(item => typeof item === 'string')
			: path[0] === 'templateVariables' && key === 'required' ? typeof value === 'boolean' : typeof value === 'string';
		if (!validValue) {
			throw new Error('Unsupported structured field value.');
		}
		return this.applyPath(path, value);
	}
	upgradeFormat(): MetadataDocument {
		if (this.format !== 'legacy') { throw new Error('Only supported legacy metadata can be upgraded.'); }
		return this.applyPath(['formatVersion'], 1);
	}
	appendDependency(value: { id: string; name: string; version?: string }): MetadataDocument {
		if (this.format !== 'current' || Object.keys(value).some(key => !['id', 'name', 'version'].includes(key)) || Object.values(value).some(item => typeof item !== 'string')) { throw new Error('Invalid dependency entry.'); }
		const node = this.node(['dependencies']);
		if (node && node.type !== 'array') { throw new Error('Invalid dependency container.'); }
		if (!node) { return this.applyPath(['dependencies'], [value]); }
		return this.applyPath(['dependencies', node.children?.length ?? 0], value);
	}
	removeDependency(index: number): MetadataDocument {
		if (this.format !== 'current' || !Number.isSafeInteger(index) || index < 0 || !this.node(['dependencies', index])) { throw new Error('Invalid dependency index.'); }
		return this.removeArrayEntry('dependencies', index);
	}
	patchAuthors(names: readonly string[]): MetadataDocument {
		if (this.format !== 'current' || names.some(name => typeof name !== 'string' || !name.trim())) { throw new Error('Invalid authors.'); }
		const node = this.node(['authors']);
		if (node && (node.type !== 'array' || node.children?.some((child, index) => child.type !== 'string' && (child.type !== 'object' || !this.string(['authors', index, 'name']))))) { throw new Error('Unrecognized author entries must be preserved. Use the raw metadata editor to modify them explicitly.'); }
		let result: MetadataDocument = node ? this : this.applyPath(['authors'], []);
		const length = node?.children?.length ?? 0;
		for (let index = 0; index < Math.min(length, names.length); index++) {
			const path = node!.children![index].type === 'string' ? ['authors', index] : ['authors', index, 'name'];
			if (result.string(path) !== names[index]) { result = result.applyPath(path, names[index]); }
		}
		for (let index = length - 1; index >= names.length; index--) { result = result.removeArrayEntry('authors', index); }
		for (let index = length; index < names.length; index++) { result = result.applyPath(['authors', index], names[index]); }
		return result;
	}
	private removeArrayEntry(field: string, index: number): MetadataDocument {
		const children = this.node([field])!.children!, child = children[index];
		const start = index === children.length - 1 && index > 0 ? children[index - 1].offset + children[index - 1].length : child.offset;
		const end = index < children.length - 1 ? children[index + 1].offset : child.offset + child.length;
		// Remove the element and its comma by token offsets; jsonc-parser's last-element
		// removal assumes whitespace before the closing bracket and can leave a token.
		const result = new MetadataDocument(applyEdits(this.text, [{ offset: start, length: end - start, content: '' }]));
		if (result.diagnostics.length) { throw new Error('Dependency removal produced invalid metadata.'); } return result;
	}
	removeDependencyVersion(index: number): MetadataDocument {
		if (this.format !== 'current' || !Number.isSafeInteger(index) || index < 0 || this.node(['dependencies', index])?.type !== 'object') { throw new Error('Invalid dependency index.'); }
		return this.applyPath(['dependencies', index, 'version'], undefined);
	}
	private applyPath(path: readonly (string | number)[], value: unknown): MetadataDocument {
		// Formatting the insertion's enclosing range would rewrite untouched subtrees.
		// Offset edits without formatting retain their exact original tokens and spacing.
		const edits = modify(this.text, [...path], value, {});
		const result = new MetadataDocument(applyEdits(this.text, edits));
		if (result.diagnostics.length) { throw new Error('Edit would produce invalid metadata.'); }
		return result;
	}
	/** Never serialize a parsed JS number: unknown numeric lexemes are authoritative. */
	canonical(semantic = false): string {
		if (this.diagnostics.length || !this.root) { throw new Error('Invalid metadata has no canonical form.'); }
		const visit = (node: Node, path: (string | number)[]): unknown => {
			switch (node.type) {
				case 'object': return ['object', (node.children ?? []).map(property => {
					const key = property.children![0].value as string;
					return [key, property.children![1]] as const;
				}).filter(([key]) => !(semantic && path.length === 0 && key === 'formatVersion'))
					.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
					.map(([key, child]) => [key, visit(child, [...path, key])])];
				case 'array': return ['array', (node.children ?? []).map((child, index) => visit(child, [...path, index]))];
				case 'number': return ['number', this.text.slice(node.offset, node.offset + node.length)];
				case 'string': return ['string', semantic && path[path.length - 1] === 'id'
					&& (path.length === 1 || (path.length === 3 && path[0] === 'dependencies')) ? String(node.value).toLowerCase() : node.value];
				default: return [node.type, node.value ?? null];
			}
		};
		return JSON.stringify(visit(this.root, []));
	}
}
