// CI uses the same pinned VS Code archive already used for its Host test.
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { execFileSync } from 'node:child_process';
const version=process.argv[2];if(!['1.134.0','1.142.0'].includes(version)){throw new Error('Unapproved QA runtime version.');}
const executable=await downloadAndUnzipVSCode(version);
execFileSync(process.execPath,['scripts/installed-smoke.mjs',version],{stdio:'inherit',env:{...process.env,TCP_VSCODE_EXECUTABLE:executable},windowsHide:true});
