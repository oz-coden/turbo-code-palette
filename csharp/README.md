# Optional C# helper

TCP's JavaScript extension does not require .NET. C# semantic features opt in through a trusted helper DLL in the machine-scoped `turboCodePalette.csharpHelperPath` setting. The extension never builds/downloads a helper or evaluates a workspace project. Empty configuration retains the existing conservative generic provider.

Build with .NET SDK 10:

```sh
npm run build:csharp
npm run test:csharp
dotnet build csharp/Tcp.ProtocolFixture/Tcp.ProtocolFixture.csproj -c Release
npm run test:unit
npm run compile
npm run measure:csharp
```

Configure the absolute location of `csharp/Tcp.CSharp/bin/Release/net10.0/Tcp.CSharp.dll` locally in VS Code Settings, then Reload Window. Do not commit machine paths. Execution requires .NET 10 runtime. Source/build outputs are excluded from the extension package; a final binary distribution method is intentionally undecided. `Tcp.ProtocolFixture` is an adversarial test peer and must never be configured for normal use or distributed as the provider.

`C# Provider Status` probes availability and displays the reason for failure. `Cancel Current C# Operation` cancels the pending request and terminates the helper. It starts again for a subsequent request. After configuration changes Reload Window is required. Restricted workspaces do not start a helper.

## Protocol v1

UTF-8 newline-delimited JSON on stdin/stdout. Logs belong only on stderr. Example:

```json
{"protocolVersion":1,"id":"request-1","operation":"analyze","input":{"documents":[{"id":"snippet.cs","source":"public class Example {}"}],"options":{"languageVersion":"12.0","defines":[]}}}
```

Every response has the same protocol version and request ID, `ok`, `diagnostics: string[]`, and `result` (null on refusal). Successful responses additionally provide bounded numeric timing/memory metrics. Source document IDs are logical labels, never paths the helper opens. Operations:

| Operation | Additional input | Structured result |
|---|---|---|
| analyze | documents/options | exports candidates, syntaxValid, semanticErrors |
| place | source fragment, offset, targets | offset/text/context |
| validate | complete planned document | valid, or parse/binding/collision refusal |
| references | current document first; candidate sources after it | referenced document IDs and symbol descriptors |
| bundle | current first; resolver dependency-first sources after it | generated text and standalone compilation validation |
| clean | start/end, ordered transforms, protectAllComments | selected output text, warnings |
| header | notices, URLs | syntax-safe complete output text |
| markers | complete document | syntax-proven marker evidence; never implementation compatibility |
| cancel | envelope only; same active ID | cooperative cancellation; client also kills the process |

Client limits: one request, no implicit queue; 8 MiB encoded request, 16 MiB response/buffer, 64 KiB stderr, 10-second deadline, 30-second idle shutdown. Helper additionally limits 128 documents, 4 Mi UTF-16 characters, unique bounded IDs, JSON depth 64, 128 preprocessor symbols and 15-second cooperative deadline. Malformed response, mismatched ID/version/shape, crash and transport failure terminate the process and reject the plan. Source is not cached. The only shared references are the helper's trusted runtime assemblies; no external workspace references, analyzers, generators, scripts, MSBuild or commands run.

Known language version/defines can be explicitly supplied through settings; project evaluation is not implemented. Otherwise C# 14 regular-source parsing is used with a standalone-context diagnostic. Runtime references differ from an arbitrary project's references/target framework. Parse errors still allow explicitly labeled exports candidates, but do not permit placement, cleanup or semantic success. Incomplete/unresolved/ambiguous bindings stop semantic operations.

See `docs/phase6-results.md` for guarantees, refusals, performance and distribution comparison.
