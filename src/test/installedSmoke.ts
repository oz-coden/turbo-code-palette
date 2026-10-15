import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import type { Phase0Api } from '../extension';
export async function run(): Promise<void> {
	const extension=vscode.extensions.getExtension<Phase0Api>('oz-coden.turbo-code-palette')!;assert.ok(extension);const relative=path.relative(process.env.TCP_INSTALLED_EXTENSIONS!,extension.extensionUri.fsPath);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));assert.equal(extension.packageJSON.version,'0.0.1');
	const api=await extension.activate();await api.product.reload();assert.equal(api.product.csharp.client.running,false);
	const root=api.product.library.roots().find(root=>root.scope==='workspace')!;
	const id=await api.product.library.createSnippet(root,{fields:{name:'Installed JS',version:'v1.0.0',languages:['javascript']},sourceName:'code.js',bytes:Buffer.from('const installed = true;\n')});await api.product.reload();
	const asset=api.catalog.snapshot!.snippets.find(a=>a.metadata.id===id)!;assert.equal(api.catalog.search('Installed lang:javascript').hits.length,1);
	const editor=await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({content:'',language:'javascript'}));await api.product.insertion.request(asset,undefined,{uri:editor.document.uri,version:editor.document.version,selection:editor.selection});assert.match(editor.document.getText(),/const installed = true/);
	assert.equal(api.product.csharp.client.running,false);const expected=path.join(extension.extensionUri.fsPath,'resources','csharp','Tcp.CSharp.dll');await fs.access(expected);assert.equal(api.product.csharp.client.settings.dll,expected);
	const available=await api.product.csharp.availability();if(process.env.TCP_EXPECT_HELPER==='true'){assert.equal(available.available,true,available.reason);const result=await api.product.csharp.analyze(['class InstalledHelper { public int Value; }']);assert.ok(result.result.exports.some(e=>e.kind==='field'));}
	console.log('INSTALLED VSIX SMOKE PASSED: installed artifact activation, JS create/search/Insert, lazy packaged helper, provider '+(available.available?'ready':'safely unavailable'));
	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}
