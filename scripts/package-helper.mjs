import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const destination = path.resolve('resources/csharp');
// Only our own helper project is published. Never evaluate a workspace project.
const properties=['-p:Configuration=Release','-p:SelfContained=false','-p:UseAppHost=false','-p:DebugType=None','-p:DebugSymbols=false','-p:SatelliteResourceLanguages=en','-p:RestoreLockedMode=true','-p:ContinuousIntegrationBuild=true','-p:PathMap='+path.resolve('.')+'=/_/tcp','-p:PublishDir='+destination+path.sep];
const result = spawnSync('dotnet', ['msbuild', 'csharp/Tcp.CSharp/Tcp.CSharp.csproj', '-restore', '-t:Rebuild;Publish', ...properties], { stdio: 'inherit', windowsHide: true });
if (result.status !== 0) { process.exit(result.status ?? 1); }
const allowed = new Set(['Tcp.CSharp.dll', 'Tcp.CSharp.deps.json', 'Tcp.CSharp.runtimeconfig.json', 'Microsoft.CodeAnalysis.dll', 'Microsoft.CodeAnalysis.CSharp.dll']);
const entries = await fs.readdir(destination, { withFileTypes: true });
for (const entry of entries) { if (!entry.isFile() || !allowed.has(entry.name)) { throw new Error('Unexpected helper publish output: ' + entry.name + '. Use a fresh generated resources directory.'); } }
for (const name of allowed) { await fs.access(path.join(destination, name)); }
console.log('Packaged portable framework-dependent helper: ' + entries.length + ' files, ' + (await Promise.all(entries.map(entry => fs.stat(path.join(destination, entry.name))))).reduce((n,s) => n+s.size, 0) + ' bytes. Requires existing .NET 10 runtime.');
