import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { resolve, join } from 'node:path';

const require = createRequire(import.meta.url);
const { CSharpClient } = require('../out/language/csharpClient.js');
const output = resolve('.vscode-test/csharp-measure'); await mkdir(output, { recursive: true });
const dll = resolve('csharp/Tcp.CSharp/bin/Release/net10.0/Tcp.CSharp.dll');
const client = new CSharpClient({ dll, timeoutMs: 15000, options: { languageVersion: '14.0' } });
const documents = [{ id: 'current.cs', source: 'System.Console.WriteLine(N.Dep.Answer);' }, { id: 'dependency.cs', source: 'namespace N; public class Dep { public const int Answer=42; }\n// keep dependency notice' }];
const measurements = {};
async function measure(name, operation, docs, extra = {}, repeats = 1) {
  const elapsed = []; let response;
  for (let i = 0; i < repeats; i++) { const start = performance.now(); response = await client.request(operation, docs, extra); elapsed.push(performance.now() - start); }
  elapsed.sort((a, b) => a - b);
  measurements[name] = { requests: repeats, medianMs: +elapsed[Math.floor(elapsed.length / 2)].toFixed(2), minMs: +elapsed[0].toFixed(2), maxMs: +elapsed.at(-1).toFixed(2), helper: client.lastMetrics };
  return response;
}
try {
  await measure('coldSnippet', 'analyze', [{ id: 'snippet.cs', source: documents[1].source }]);
  await measure('warmSnippet', 'analyze', [{ id: 'snippet.cs', source: documents[1].source }], {}, 20);
  const large = Array.from({ length: 500 }, (_, i) => 'public class Type' + i + ' { public int Value {get;set;} public int Twice(int n)=>n*2; }').join('\n');
  await measure('currentFile500Types', 'analyze', [{ id: 'current.cs', source: large }], {}, 5);
  await measure('referenceAnalysis', 'references', documents, {}, 5);
  const bundle = await measure('bundleEmit', 'bundle', documents, {}, 5);
  // Compile only our generated representative fixture; never load/build a user's project.
  const compile = join(output, 'compile-fixture'); await mkdir(compile, { recursive: true });
  await writeFile(join(compile, 'Generated.cs'), bundle.result.text);
  await writeFile(join(compile, 'Fixture.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>disable</ImplicitUsings><Nullable>disable</Nullable><EnableDefaultCompileItems>false</EnableDefaultCompileItems></PropertyGroup><ItemGroup><Compile Include="Generated.cs" /></ItemGroup></Project>');
  execFileSync('dotnet', ['build', join(compile, 'Fixture.csproj'), '-c', 'Release', '--nologo'], { stdio: 'pipe', windowsHide: true });
  const actual = execFileSync('dotnet', [join(compile, 'bin/Release/net10.0/Fixture.dll')], { encoding: 'utf8', windowsHide: true }).trim();
  if (actual !== '42') throw new Error('Generated Bundle behavior fixture failed.');
  measurements.generatedBundle = { dotnetCompile: 'passed', output: actual };
  async function size(directory) { let bytes = 0, files = 0; if (!existsSync(directory)) return undefined; for (const item of await readdir(directory, { withFileTypes: true })) { const file = join(directory, item.name); if (item.isDirectory()) { const nested = await size(file); bytes += nested.bytes; files += nested.files; } else { bytes += (await stat(file)).size; files++; } } return { bytes, files }; }
  measurements.helperBuild = await size(resolve('csharp/Tcp.CSharp/bin/Release/net10.0'));
  measurements.frameworkDependent = await size(resolve('.vscode-test/csharp-framework'));
  measurements.selfContainedWinX64 = await size(resolve('.vscode-test/csharp-self-contained'));
  measurements.extensionJavaScriptBytes = existsSync('dist/extension.js') ? (await stat('dist/extension.js')).size : undefined;
  // Measure direct apphost startup too, if an optional self-contained publish was produced.
  const executable = resolve('.vscode-test/csharp-self-contained/Tcp.CSharp.exe');
  if (existsSync(executable)) {
    const started = performance.now();
    await new Promise((done, reject) => {
      const child = spawn(executable, [], { windowsHide: true, stdio: 'pipe' }); let pending = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Self-contained probe timeout')); }, 15000);
      child.on('error', reject); child.stderr.resume(); child.stdout.on('data', chunk => { pending += chunk; if (pending.includes('\n')) { const response = JSON.parse(pending.split('\n')[0]); if (!response.ok) { reject(new Error('Self-contained analysis failed')); } else { measurements.selfContainedColdMs = +(performance.now() - started).toFixed(2); done(); } clearTimeout(timer); child.kill(); } });
      child.stdin.write(JSON.stringify({ protocolVersion: 1, id: 'measurement', operation: 'analyze', input: { documents: [{ id: 'snippet.cs', source: documents[1].source }], options: { languageVersion: '14.0' } } }) + '\n');
    });
  }
  await writeFile(join(output, 'metrics.json'), JSON.stringify(measurements, null, 2) + '\n'); console.log(JSON.stringify(measurements, null, 2));
} finally { client.dispose(); }
