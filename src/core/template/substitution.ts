import type { MetadataDocument } from '../metadata/document';

export interface Variable { readonly name: string; readonly required: boolean; readonly defaultValue?: string; readonly description?: string; readonly options?: readonly string[] }
const namePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const placeholders = () => /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
export function templateInputs(document: MetadataDocument, sources: readonly string[]): Variable[] {
	if (sources.some(source => [...source.matchAll(/\{\{([^{}]*)\}\}/g)].some(match => !namePattern.test(match[1])))) { throw new Error('Invalid placeholder name.'); }
	const definitions = new Map<string, Variable>();
	const list = document.node(['templateVariables']);
	if (list && list.type !== 'array') { throw new Error('Invalid templateVariables.'); }
	(list?.children ?? []).forEach((node, index) => {
		const base = ['templateVariables', index], name = document.string([...base, 'name']);
		const required = document.node([...base, 'required']), description = document.node([...base, 'description']);
		const defaultNode = document.node([...base, 'default']), optionsNode = document.node([...base, 'options']);
		if (node.type !== 'object' || !name || !namePattern.test(name) || definitions.has(name)
			|| required && required.type !== 'boolean' || description && description.type !== 'string'
			|| defaultNode && defaultNode.type !== 'string' || optionsNode && (optionsNode.type !== 'array' || !optionsNode.children?.length || optionsNode.children.some(child => child.type !== 'string'))) { throw new Error('Invalid or duplicate template variable definition.'); }
		const options = optionsNode?.children?.map(child => child.value as string), defaultValue = document.string([...base, 'default']);
		const variable: Variable = { name, required: required?.value !== false, description: document.string([...base, 'description']), defaultValue, options };
		if (options && new Set(options).size !== options.length || defaultValue !== undefined && (options && !options.includes(defaultValue) || variable.required && !defaultValue.trim())) { throw new Error('Invalid template default/options.'); }
		definitions.set(name, variable);
	});
	const used = new Set(sources.flatMap(source => [...source.matchAll(placeholders())].map(match => match[1])));
	return [...used].sort().map(name => definitions.get(name) ?? { name, required: true });
}
export function validateValue(variable: Variable, value: string): void {
	if (value.length > 65536 || variable.required && !value.trim() || variable.options && !variable.options.includes(value)) { throw new Error(`Invalid value for ${variable.name}.`); }
}
/** Callback replacement is literal; substituted values are never scanned for another replacement. */
export function substitute(source: string, variables: readonly Variable[], values: ReadonlyMap<string, string>): string {
	for (const variable of variables) { const value = values.get(variable.name); if (value === undefined) { throw new Error(`Unresolved template: ${variable.name}`); } validateValue(variable, value); }
	let size = source.length;
	for (const match of source.matchAll(placeholders())) { const value = values.get(match[1]); if (value === undefined) { throw new Error(`Unresolved template: ${match[1]}`); } size += value.length - match[0].length; if (size > 16 * 1024 * 1024) { throw new Error('Expanded template limit exceeded.'); } }
	const result = source.replace(placeholders(), (_, name: string) => { const value = values.get(name); if (value === undefined) { throw new Error(`Unresolved template: ${name}`); } return value; });
	if (/\{\{[^{}]*\}\}/.test(result)) { throw new Error('Replacement leaves an unresolved placeholder.'); } return result;
}
