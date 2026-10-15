import { runTests, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
const version=process.argv[2]??'1.134.0', base=path.resolve('.vscode-test','vsix-smoke-'+version+'-'+Date.now()),profile=path.join(base,'profile'),extensions=path.join(base,'extensions'),workspace=path.join(base,'workspace');
for(const folder of [path.join(profile,'User'),extensions,workspace]){await mkdir(folder,{recursive:true});}
await writeFile(path.join(profile,'User','settings.json'),JSON.stringify({'workbench.startupEditor':'none','security.workspace.trust.enabled':false,'extensions.autoUpdate':false,'update.mode':'none'}));
const executable=process.env.TCP_VSCODE_EXECUTABLE??path.resolve('.vscode-test',`vscode-win32-x64-archive-${version}`,'Code.exe');if(!existsSync(executable)){throw new Error('Use an existing QA installation via TCP_VSCODE_EXECUTABLE. No automatic program download.');}
const vsix=path.resolve('.vscode-test/turbo-code-palette-0.0.1.vsix'),cli=resolveCliPathFromVSCodeExecutablePath(executable);
const args=['--user-data-dir',profile,'--extensions-dir',extensions,'--install-extension',vsix];
if(process.platform==='win32'){
  const values=[cli,...args];if(values.some(value=>/["%&|<>^!\r\n]/.test(value))){throw new Error('Unsafe CLI argument.');}
  execFileSync('cmd.exe',['/d','/s','/c','"'+values.map(value=>'"'+value+'"').join(' ')+'"'],{stdio:'inherit',windowsHide:true,windowsVerbatimArguments:true});
}else{execFileSync(cli,args,{stdio:'inherit'});}
const installed=(await readdir(extensions)).filter(name=>name.startsWith('oz-coden.'));if(installed.length!==1){throw new Error('Expected one installed VSIX.');}
console.log('Installed artifact directories: '+installed.length);
// The test entry requires Development Host mode. Point it at the installed VSIX
// extraction, never the repository; this verifies the packaged files in isolation.
await runTests({vscodeExecutablePath:executable,extensionDevelopmentPath:path.join(extensions,installed[0]),extensionTestsPath:path.resolve('out/test/installedSmoke.js'),extensionTestsEnv:{TCP_INSTALLED_EXTENSIONS:extensions,TCP_EXPECT_HELPER:process.env.TCP_EXPECT_HELPER??'true'},launchArgs:[workspace,'--skip-welcome','--skip-release-notes','--disable-workspace-trust',`--user-data-dir=${profile}`,`--extensions-dir=${extensions}`]});
