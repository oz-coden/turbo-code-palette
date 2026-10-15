import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Phase0Api } from '../../extension';
import { captureSnippet } from '../../application/controller';
import { Library } from '../../application/library';
import { InsertionPipeline, type InsertionInteractions } from '../../application/insertionPipeline';
import { CleanCopy, type CleanInteractions } from '../../application/cleanCopy';
import { UserState } from '../../application/userState';
import { PackImportSession, exportPack } from '../../application/packArchive';
import { CSharpClient } from '../../language/csharpClient';
import { CSharpProvider } from '../../language/csharpProvider';

const capture = (editor: vscode.TextEditor) => ({uri:editor.document.uri,version:editor.document.version,selection:editor.selection});
const insertIo = (): InsertionInteractions => ({input:async ()=>'VALUE', mode:async (_,modes)=>modes[0],output:async()=>undefined,preview:async()=>true,warnings:async()=>true});
const cleanIo = (): CleanInteractions => ({origins:async()=>[],preset:async()=> 'Readable', custom:async all=>all.map(t=>t.id),bundle:async()=>[],warnings:async()=>true,output:async()=> 'clipboard',preview:async()=>undefined,destination:async()=>undefined,clipboard:async()=>{},untitled:async()=>{}});

suite('Phase 7 — cross-phase language-neutral workflows (Host/API, not manual mouse proof)',()=>{
	let api:Phase0Api;
	suiteSetup(async()=>{api=await vscode.extensions.getExtension<Phase0Api>('oz-coden.turbo-code-palette')!.activate();});
	async function sandbox(run:(library:Library,state:UserState,folder:string)=>Promise<void>){
		const base=path.join(vscode.workspace.workspaceFolders![0].uri.fsPath,'phase7-cases');await fs.mkdir(base,{recursive:true});const folder=await fs.mkdtemp(path.join(base,'case-'));
		const library=new Library(()=>[{scope:'workspace',workspaceId:'qa',path:path.join(folder,'workspace')},{scope:'global',path:path.join(folder,'global')}]);await library.reload();
		const data=new Map<string,unknown>(),state=new UserState({get:<T>(key:string,fallback:T)=>(data.get(key)??fallback) as T,update:async(key,value)=>{data.set(key,value);}});
		try{await run(library,state,folder);}finally{api.product.panel.saved();api.product.panel.dispose();await vscode.commands.executeCommand('workbench.action.closeAllEditors');assert.equal(path.dirname(folder),base);await fs.rm(folder,{recursive:true,force:true});}
	}
	for(const [language,extension,code] of [['javascript','js','function greet() { return "hello"; }\n'],['python','py','def greet():\n    return "hello"\n'],['html','html','<section aria-label="greeting">Hello</section>\n']]){
		test(language+': Selection creation → Pack → search → Insert/Undo → copy → archive → all Clean presets → explicit revision',async()=>sandbox(async(library,state,folder)=>{
			const source=await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({content:code,language}));source.selection=new vscode.Selection(source.document.positionAt(0),source.document.positionAt(code.length));const captured=captureSnippet('selection',source),root=library.roots()[0];
			const id=await library.createSnippet(root,{fields:{name:language+' reusable',version:'v1.0.0',languages:[language],description:'General application component'},sourceName:'code.'+extension,bytes:captured.bytes});
			let asset=library.catalog.snapshot!.snippets.find(a=>a.metadata.id===id)!;await library.createOrEditPack(root,{fields:{name:'Application components',version:'v1.0.0'},members:[asset]});
			const pack=library.catalog.snapshot!.packs.find(a=>a.metadata.name==='Application components')!;assert.equal(library.members(pack).length,1);assert.ok(library.catalog.search('reusable lang:'+language).hits.length);
			const target=await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({content:'',language}));const pipeline=new InsertionPipeline(library,state,undefined,insertIo());try{assert.equal(await pipeline.run({asset,target:capture(target)}),'inserted');assert.equal(target.document.getText().replace(/\r\n/g,'\n'),code);assert.equal(state.get(`snippet:${id}:v1.0.0`).usage,1);await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');await vscode.commands.executeCommand('undo');assert.equal(target.document.getText(),'');}finally{pipeline.dispose();}
			await library.copySnippets([asset],library.roots()[1]);await library.copyPack(pack,library.roots()[1]);assert.ok(library.catalog.snapshot!.snippetGroups.some(group=>group.locations.length>1));
			const archive=path.join(folder,'components.tcp-sp');await exportPack(library,library.catalog.snapshot!.packs.find(a=>a.metadata.name==='Application components'&&a.root.scope==='workspace')!,archive);
			const imported=new Library(()=>[{scope:'global',path:path.join(folder,'imported')}]);await imported.reload();const session=await PackImportSession.prepare(imported,archive,imported.roots()[0]);try{assert.ok(session.rows.every(row=>row.category==='addition'));await session.commit('add');assert.equal((await imported.source(imported.catalog.snapshot!.snippets[0],'code.'+extension)).toString(),code);}finally{await session.dispose();}
			const cleanTarget=await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({content:code,language})),io=cleanIo();let copied='';io.clipboard=async text=>{copied=text;};const clean=new CleanCopy(library,()=>capture(cleanTarget),api.product.comparison,undefined,io);try{for(const preset of ['Readable','Competitive','Custom'] as const){io.preset=async()=>preset;assert.equal(await clean.run('file'),'completed');assert.equal(copied,code);assert.equal(cleanTarget.document.getText(),code);}}finally{clean.dispose();}
			asset=library.catalog.snapshot!.snippets.find(a=>a.metadata.id===id&&a.packName==='Default'&&a.root.scope==='workspace')!;await library.editSnippet(asset,{description:'Reviewed component',version:'v1.0.1'});await library.reload();assert.ok(library.catalog.search('version:=v1.0.1').hits.length);await state.toggle(`snippet:${id}:v1.0.0`);assert.equal(state.get(`snippet:${id}:v1.0.0`).favorite,true);
		}));
	}
	test('C# basic cursor Insert and Clean Copy survive an unavailable configured helper; semantic placement stops with reason',async()=>sandbox(async(library,state)=>{
		const id=await library.createSnippet(library.roots()[0],{fields:{name:'Simple text',version:'v1.0.0'},sourceName:'code.cs',bytes:Buffer.from('class Plain {}\n')});const asset=library.catalog.snapshot!.snippets.find(a=>a.metadata.id===id)!,provider=new CSharpProvider(new CSharpClient({dll:path.resolve('.vscode-test/no-such-helper.dll')}));const target=await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({content:'',language:'csharp'})),pipeline=new InsertionPipeline(library,state,undefined,insertIo(),undefined,provider);
		try{assert.equal(await pipeline.run({asset,target:capture(target),mode:'cursor'}),'inserted');assert.equal(provider.client.running,false);const io=cleanIo();let output='';io.clipboard=async text=>{output=text;};const clean=new CleanCopy(library,()=>capture(target),api.product.comparison,undefined,io,provider);try{assert.equal(await clean.run('file'),'completed');assert.equal(output,target.document.getText());}finally{clean.dispose();}const fresh=await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({content:'',language:'csharp'}));await assert.rejects(pipeline.run({asset,target:capture(fresh),mode:'structure-aware'}),/unavailable|not available|not allowed|Unsupported/);}finally{provider.dispose();pipeline.dispose();}
	}));
	test('shared full attribution + license survives Insert and confirmed Clean Copy; cancel origin selection leaves output unchanged',async()=>sandbox(async(library,state)=>{
		const id=await library.createSnippet(library.roots()[0],{fields:{name:'Reusable',version:'v1.0.0',authors:['Author']},sourceName:'code.js',bytes:Buffer.from('const reusable = 1;\n')});let asset=library.catalog.snapshot!.snippets.find(a=>a.metadata.id===id)!;
		const metadata={...JSON.parse(asset.metadata.document.text),source:[{url:'https://example.com/component'}],licenseNotices:[{text:'Keep notice'}]};await fs.writeFile(path.join(asset.root.path,asset.relativePath,'snippet.json'),JSON.stringify(metadata));await library.reload();asset=library.catalog.snapshot!.snippets.find(a=>a.metadata.id===id)!;
		const target=await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({content:'',language:'javascript'})),pipeline=new InsertionPipeline(library,state,undefined,insertIo());try{await pipeline.run({asset,target:capture(target),options:{attribution:'full'}});assert.match(target.document.getText(),/Source URL: https:\/\/example.com\/component/);assert.match(target.document.getText(),/Snippet: Reusable v1.0.0 \| Authors: Author/);assert.match(target.document.getText(),/Keep notice/);assert.ok(!target.document.getText().includes('TCP BEGIN'));}finally{pipeline.dispose();}
		const io=cleanIo();let writes=0;io.origins=async()=>undefined;io.clipboard=async()=>{writes++;};const clean=new CleanCopy(library,()=>capture(target),api.product.comparison,undefined,io);try{assert.equal(await clean.run('file',capture(target),{attribution:'full'}),'cancelled');assert.equal(writes,0);io.origins=async()=>[asset];assert.equal(await clean.run('file',capture(target),{attribution:'full'}),'completed');assert.match(clean.lastPlan!.text,/Keep notice/);assert.equal(writes,1);}finally{clean.dispose();}
	}));
	test('reused dependencies contribute canonical citations even when their earlier Insert had attribution disabled',async()=>sandbox(async(library,state)=>{
		const root=library.roots()[0],depId=await library.createSnippet(root,{fields:{name:'Dependency',version:'v1.0.0'},sourceName:'dependency.js',bytes:Buffer.from('const dependency = 1;\n')});
		const mainId=await library.createSnippet(root,{fields:{name:'Main',version:'v1.0.0'},sourceName:'main.js',bytes:Buffer.from('const main = dependency;\n'),dependencies:[{id:depId,name:'Dependency'}]});
		let dependency=library.catalog.snapshot!.snippets.find(a=>a.metadata.id===depId)!;await fs.writeFile(path.join(root.path,dependency.relativePath,'snippet.json'),JSON.stringify({...JSON.parse(dependency.metadata.document.text),source:[{url:'https://example.com/dependency'}]}));await library.reload();dependency=library.catalog.snapshot!.snippets.find(a=>a.metadata.id===depId)!;const main=library.catalog.snapshot!.snippets.find(a=>a.metadata.id===mainId)!;
		const target=await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({content:'// application\n\n',language:'javascript'})),pipeline=new InsertionPipeline(library,state,undefined,insertIo());target.selection=new vscode.Selection(1,0,1,0);
		try{await pipeline.run({asset:dependency,target:capture(target)});assert.ok(!target.document.getText().includes('Source URL:'));target.selection=new vscode.Selection(target.document.positionAt(target.document.getText().length),target.document.positionAt(target.document.getText().length));await pipeline.run({asset:main,target:capture(target),options:{attribution:'source-urls'}});assert.match(target.document.getText(),/Source URL: https:\/\/example.com\/dependency/);assert.equal(target.document.getText().split('const dependency = 1;').length-1,1);assert.equal(state.get(`snippet:${depId}:v1.0.0`).usage,1);}finally{pipeline.dispose();}
	}));
});
