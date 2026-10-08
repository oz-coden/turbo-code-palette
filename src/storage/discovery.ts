import { MetadataDocument } from '../core/metadata/document';
import { readMetadata, type MetadataView } from '../core/metadata/semantics';
import { sha256, treeFingerprint, type FingerprintFile } from '../core/assets/fingerprint';
import { groupAssets, type AssetGroup } from '../core/assets/identity';
import { pathCollisionKey, validateRelativePath } from './safePaths';
import type { StorageRoot } from './roots';
import { nativeReader, type LibraryReader, type ReaderFactory } from './reader';

export interface LoadDiagnostic { readonly scope: StorageRoot['scope']; readonly rootKey: string; readonly asset: string; readonly code: string }
export interface AssetLocation {
	readonly root: StorageRoot;
	readonly relativePath: string;
	readonly metadata: MetadataView;
	readonly files: readonly FingerprintFile[];
	readonly directories?: readonly string[];
	readonly semanticHash?: string;
	readonly integrityHash?: string;
	readonly packName: string;
	readonly usable: boolean;
}
export interface CatalogSnapshot {
	readonly snippets: readonly AssetLocation[];
	readonly packs: readonly AssetLocation[];
	readonly snippetGroups: readonly AssetGroup<AssetLocation>[];
	readonly packGroups: readonly AssetGroup<AssetLocation>[];
	readonly diagnostics: readonly LoadDiagnostic[];
}
interface FileRecord extends FingerprintFile { readonly bytes: Buffer }
const ignored = new Set(['.git', '.tcp-staging', '.tcp-transactions', '.tmp']);
const decoder = new TextDecoder('utf-8', { fatal: true });
const missing = (error: unknown): boolean => ['ENOENT', 'FileNotFound'].includes((error as NodeJS.ErrnoException).code ?? '');

/** Same bounded, link-refusing loader for every scope; a bad asset is quarantined independently. */
export async function loadCatalog(roots: readonly StorageRoot[], readerFactory: ReaderFactory = nativeReader): Promise<CatalogSnapshot> {
	const snippets: AssetLocation[] = [], packs: AssetLocation[] = [], diagnostics: LoadDiagnostic[] = [];
	for (const root of roots) {
		const report = (asset: string, code: string) => diagnostics.push({ scope: root.scope, rootKey: root.uri ?? root.path, asset, code });
		let entries, reader: LibraryReader;
		try { reader = readerFactory(root); entries = await reader.list(''); }
		catch (error) { if (!missing(error)) { report('', 'unreadable-root'); } continue; }
		if (entries.length > 10000) { report('', 'root-entry-limit'); continue; }
		const rootNames = new Map<string, number>();
		entries.forEach(entry => { const key = pathCollisionKey(entry.name); rootNames.set(key, (rootNames.get(key) ?? 0) + 1); });
		for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
			if (ignored.has(entry.name.toLowerCase())) { continue; }
			const packPath = entry.name;
			try {
				validateRelativePath(packPath);
				const key = pathCollisionKey(packPath);
				if (rootNames.get(key)! > 1) { report(packPath, 'path-collision'); continue; }
				if (!entry.directory) { continue; }
				if (!(await reader.list(packPath)).some(child => child.name === 'pack.json' && !child.directory)) { continue; }
				const files: FileRecord[] = [], directories: string[] = [], errors: string[] = [], names = new Map<string, string>();
				let bytes = 0, count = 0;
				const walk = async (prefix: string, depth: number): Promise<void> => {
					if (depth > 64) { throw new Error('Tree depth limit.'); }
					for (const child of await reader.list(packPath + (prefix ? '/' + prefix.slice(0, -1) : ''))) {
						if (++count > 10000) { throw new Error('Entry limit.'); }
						const relative = prefix + child.name;
						try {
							validateRelativePath(relative);
							const key = pathCollisionKey(relative);
							if (names.has(key)) { errors.push(names.get(key)!); throw new Error('Path collision.'); } names.set(key, relative);
							if (child.directory) { directories.push(relative); await walk(relative + '/', depth + 1); }
							else {
								const data = await reader.read(packPath + '/' + relative, child.name === 'pack.json' || child.name === 'snippet.json' ? 1024 * 1024 : 16 * 1024 * 1024);
								bytes += data.length;
								if (bytes > 128 * 1024 * 1024) { throw new Error('Tree byte limit.'); }
								files.push({ path: relative, hash: sha256(data), bytes: data });
							}
						} catch { errors.push(relative); report(packPath + '/' + relative, 'unsafe-or-unreadable-entry'); }
						if (bytes > 128 * 1024 * 1024) { throw new Error('Tree byte limit.'); }
					}
				};
				await walk('', 0);
				const metadata = (file: FileRecord, kind: 'snippet' | 'pack'): MetadataView => {
					const document = new MetadataDocument(decoder.decode(file.bytes));
					const view = readMetadata(document, kind);
					view.issues.forEach(issue => report(packPath + '/' + file.path, issue.code));
					return view;
				};
				const packFile = files.find(file => file.path === 'pack.json');
				if (!packFile) { report(packPath, 'missing-pack-metadata'); continue; }
				const packMetadata = metadata(packFile, 'pack');
				if (!packMetadata.valid) { continue; }
				const packName = packMetadata.name!;
				const recognized = new Map<string, MetadataDocument>([['pack.json', packMetadata.document]]);
				const members: AssetLocation[] = [];
				let incomplete = errors.length > 0;
				for (const file of files.filter(file => /^[^/]+\/snippet\.json$/.test(file.path))) {
					const directory = file.path.split('/')[0], prefix = directory + '/';
					try {
						const view = metadata(file, 'snippet');
						recognized.set(file.path, view.document);
						if (!view.valid || errors.some(error => error === directory || error.startsWith(prefix))) { incomplete = true; continue; }
						const memberFiles = files.filter(item => item.path.startsWith(prefix)).map(item => ({
							path: item.path.slice(prefix.length), hash: item.hash, metadata: item === file ? view.document : undefined,
						}));
						for (const source of view.sources) {
							validateRelativePath(source);
							if (!memberFiles.some(item => item.path === source)) { throw new Error('Missing source.'); }
						}
						// Local references are data; neither external URLs nor scripts are executed.
						for (const field of ['source', 'repository', 'homepage', 'distribution', 'refer', 'usage', 'examples']) {
							(view.document.node([field])?.children ?? []).forEach((_, index) => {
								const reference = view.document.string([field, index, 'path']);
								if (reference !== undefined) {
									validateRelativePath(reference);
									if (!memberFiles.some(item => item.path === reference)) { throw new Error('Missing local reference.'); }
								}
							});
						}
						const memberDirectories = directories.filter(name => name.startsWith(prefix)).map(name => name.slice(prefix.length)).sort();
						const fingerprintFiles = [...memberFiles, ...memberDirectories.map(name => ({ path: name + '/', hash: sha256('directory') }))];
						members.push(Object.freeze({ root, relativePath: packPath + '/' + directory, metadata: view, files: memberFiles, directories: memberDirectories,
							packName, integrityHash: treeFingerprint(fingerprintFiles, false), semanticHash: treeFingerprint(fingerprintFiles, true),
							usable: reader.verifiedFileIdentity && view.canInsert && packMetadata.document.format !== 'future' }));
					} catch { incomplete = true; report(packPath + '/' + directory, 'invalid-snippet'); }
				}
				const ids = new Set<string>();
				const duplicate = members.some(member => { const id = member.metadata.id!; if (ids.has(id)) { return true; } ids.add(id); return false; });
				if (duplicate) { report(packPath, 'duplicate-snippet-uuid'); }
				snippets.push(...members.map(member => duplicate ? Object.freeze({ ...member, usable: false }) : member));
				const packFiles = files.map(file => ({ path: file.path, hash: file.hash, metadata: recognized.get(file.path) }));
				const fingerprintFiles = [...packFiles, ...directories.map(name => ({ path: name + '/', hash: sha256('directory') }))];
				const validTree = !incomplete && [...recognized.values()].every(document => document.format !== 'invalid');
				packs.push(Object.freeze({ root, relativePath: packPath, metadata: packMetadata, files: packFiles, directories: directories.sort(), packName,
					integrityHash: validTree ? treeFingerprint(fingerprintFiles, false) : undefined,
					semanticHash: validTree ? treeFingerprint(fingerprintFiles, true) : undefined,
					usable: reader.verifiedFileIdentity && validTree && !duplicate && packMetadata.canEdit }));
			} catch { report(packPath, 'invalid-pack'); }
		}
	}
	return Object.freeze({ snippets, packs, snippetGroups: groupAssets(snippets), packGroups: groupAssets(packs), diagnostics });
}
