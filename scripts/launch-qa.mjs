import { spawn } from 'node:child_process';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { installedVSCode } from './vscode-installation.mjs';
const base=path.resolve('.vscode-test/phase7-gui'),workspace=path.join(base,'workspace'),profile=path.join(base,'profile');
const installations=(await readdir('.vscode-test')).filter(name=>name.startsWith('vsix-smoke-1.134.0-')).sort();
const extensions=path.resolve('.vscode-test',installations.at(-1),'extensions');
await mkdir(path.join(profile,'User'),{recursive:true});await mkdir(workspace,{recursive:true});
await writeFile(path.join(profile,'User/settings.json'),JSON.stringify({'window.title':'TCP Phase 7 QA — ${activeEditorShort}','workbench.startupEditor':'none','workbench.colorTheme':'Default Dark Modern','editor.fontSize':16,'editor.minimap.enabled':false,'extensions.autoUpdate':false,'update.mode':'none','turboCodePalette.globalRoot':path.join(base,'global')}));
const pack=path.join(workspace,'.snippets','Application');await mkdir(pack,{recursive:true});const uuid=n=>'70000000-0000-0000-0000-'+String(n).padStart(12,'0');
await writeFile(path.join(pack,'pack.json'),JSON.stringify({formatVersion:1,id:uuid(0),name:'Application components',version:'v1.0.0',description:'Synthetic general-purpose QA data'}));
for(const [n,language,ext,code] of [[1,'javascript','js','function greet() { return "hello"; }\n'],[2,'python','py','def greet():\n    return "hello"\n'],[3,'html','html','<section aria-label="greeting">Hello</section>\n']]){
  const directory=path.join(pack,language);await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'snippet.json'),JSON.stringify({formatVersion:1,id:uuid(n),name:language+' greeting',version:'v1.0.0',description:'General application component',languages:[language],sources:['code.'+ext],source:[{url:'https://example.com/components/'+language}],licenseNotices:[],tags:['ui']}));await writeFile(path.join(directory,'code.'+ext),code);await writeFile(path.join(workspace,'target.'+ext),'');
}
const executable=process.env.TCP_VSCODE_EXECUTABLE??installedVSCode();
const child=spawn(executable,[workspace,path.join(workspace,'target.js'),'--new-window','--skip-welcome','--skip-release-notes','--disable-workspace-trust','--locale=en',`--user-data-dir=${profile}`,`--extensions-dir=${extensions}`],{detached:true,windowsHide:false,stdio:'ignore',env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});child.unref();console.log('Launched visible isolated installed-VSIX GUI QA with synthetic JS/Python/HTML data.');
