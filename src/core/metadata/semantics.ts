import { parseVersion, type AssetVersion } from '../version/parser';
import { parseConstraint, type VersionConstraint } from '../version/constraint';
import { MetadataDocument } from './document';

export type AssetKind = 'snippet' | 'pack';
export const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export interface Dependency { readonly id: string; readonly name: string; readonly constraint: VersionConstraint }
export interface SemanticIssue { readonly code: string; readonly field: string; readonly severity: 'error' | 'warning' }
export interface MetadataView {
	readonly kind: AssetKind;
	readonly document: MetadataDocument;
	readonly id?: string;
	readonly name?: string;
	readonly version?: AssetVersion;
	readonly sources: readonly string[];
	readonly dependencies: readonly Dependency[];
	readonly languages: readonly string[];
	readonly tags: readonly string[];
	readonly features: readonly string[];
	readonly authors: readonly string[];
	readonly category?: string;
	readonly description?: string;
	readonly issues: readonly SemanticIssue[];
	readonly blockedFeatures: ReadonlySet<string>;
	readonly valid: boolean;
	readonly canEdit: boolean;
	readonly canInsert: boolean;
}

export function readMetadata(document: MetadataDocument, kind: AssetKind): MetadataView {
	const issues: SemanticIssue[] = document.diagnostics.map(item => ({ code: item.code, field: '', severity: 'error' }));
	const blocked = new Set<string>();
	const issue = (field: string, code: string, required = false) => {
		issues.push({ field, code, severity: required ? 'error' : 'warning' }); blocked.add(field);
	};
	const strings = (field: string, required = false): string[] => {
		const node = document.node([field]);
		if (!node && !required) { return []; }
		if (node?.type !== 'array' || node.children?.some(child => child.type !== 'string' || !child.value.trim())
			|| (required && !node.children?.length)) { issue(field, 'expected-string-array', required); return []; }
		return (node.children ?? []).map(child => child.value as string);
	};
	const id = document.string(['id']);
	const name = document.string(['name']);
	if (!id || !UUID.test(id)) { issue('id', 'invalid-uuid', true); }
	if (!name?.trim()) { issue('name', 'required-name', true); }
	let version: AssetVersion | undefined;
	try { version = parseVersion(document.string(['version']) ?? ''); }
	catch { issue('version', 'invalid-asset-version', true); }
	if (document.format === 'invalid') { issue('formatVersion', 'invalid-format', true); }
	const sources = kind === 'snippet' ? strings('sources', true) : [];
	const languages = strings('languages');
	const tags = strings('tags');
	const features = strings('features');
	for (const field of ['description', 'category', 'notes', 'status']) {
		if (document.node([field]) && document.node([field])?.type !== 'string') { issue(field, 'expected-string'); }
	}
	const authors: string[] = [];
	const authorNode = document.node(['authors']);
	if (authorNode && authorNode.type !== 'array') { issue('authors', 'expected-array'); }
	else {
		(authorNode?.children ?? []).forEach((node, index) => {
			const value = node.type === 'string' ? node.value : document.string(['authors', index, 'name']);
			if (typeof value === 'string') { authors.push(value); }
		});
	}
	const dependencies: Dependency[] = [];
	const dependencyNode = kind === 'snippet' ? document.node(['dependencies']) : undefined;
	if (dependencyNode && dependencyNode.type !== 'array') { issue('dependencies', 'expected-array'); }
	else {
		(dependencyNode?.children ?? []).forEach((node, index) => {
			const depId = document.string(['dependencies', index, 'id']);
			const depName = document.string(['dependencies', index, 'name']);
			const constraintNode = document.node(['dependencies', index, 'version']);
			try {
				if (node.type !== 'object' || !depId || !UUID.test(depId) || !depName?.trim()
					|| (constraintNode && constraintNode.type !== 'string')) { throw new Error('Invalid dependency.'); }
				const constraint = parseConstraint(document.string(['dependencies', index, 'version']));
				if (constraint.empty) { issue('dependencies', 'empty-version-range'); }
				dependencies.push({ id: depId.toLowerCase(), name: depName, constraint });
			} catch { issue('dependencies', 'invalid-dependency'); }
		});
	}
	if (kind === 'snippet') {
		const insert = document.node(['insert']);
		if (insert && insert.type !== 'object') { issue('insert', 'expected-object'); }
		for (const key of ['allowedModes', 'deniedModes', 'targets']) {
			const node = document.node(['insert', key]);
			if (node && (node.type !== 'array' || node.children?.some(child => child.type !== 'string'))) { issue('insert', 'invalid-mode-array'); }
		}
		if (document.node(['insert', 'defaultMode']) && !document.string(['insert', 'defaultMode'])) { issue('insert', 'invalid-default-mode'); }
		for (const field of ['exports', 'templateVariables', 'licenses', 'licenseNotices', 'usage', 'examples', 'compatibility',
			'source', 'repository', 'homepage', 'distribution', 'refer']) {
			if (document.node([field]) && document.node([field])?.type !== 'array') { issue(field, 'expected-array'); }
		}
		(document.node(['templateVariables'])?.type === 'array' ? document.node(['templateVariables'])?.children ?? [] : []).forEach((node, index) => {
			const name = document.string(['templateVariables', index, 'name']);
			const required = document.node(['templateVariables', index, 'required']);
			const defaultValue = document.node(['templateVariables', index, 'default']);
			const options = document.node(['templateVariables', index, 'options']);
			if (node.type !== 'object' || !name?.trim() || (required && required.type !== 'boolean')
				|| (defaultValue && defaultValue.type !== 'string') || (options && (options.type !== 'array' || options.children?.some(child => child.type !== 'string')))) {
				issue('templateVariables', 'invalid-template-variable');
			}
		});
		(document.node(['exports'])?.type === 'array' ? document.node(['exports'])?.children ?? [] : []).forEach((node, index) => {
			if (node.type !== 'object' || !document.string(['exports', index, 'kind'])?.trim() || !document.string(['exports', index, 'name'])?.trim()
				|| ['container', 'namespace', 'signature'].some(key => document.node(['exports', index, key]) && document.node(['exports', index, key])?.type !== 'string')) {
				issue('exports', 'invalid-export');
			}
		});
	}
	const valid = !issues.some(item => item.severity === 'error');
	return Object.freeze({ kind, document, id: id && UUID.test(id) ? id.toLowerCase() : undefined, name,
		version, sources, dependencies, languages, tags, features, authors,
		category: document.string(['category']), description: document.string(['description']), issues,
		blockedFeatures: blocked, valid, canEdit: valid && document.format === 'current',
		canInsert: valid && ['legacy', 'current'].includes(document.format)
			&& !['dependencies', 'insert', 'templateVariables'].some(field => blocked.has(field)) });
}
