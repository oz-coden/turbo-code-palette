using System.Text.Json;
// Intentionally adversarial transport peer; excluded from extension packages.
var line = await Console.In.ReadLineAsync();
if (line == null) return;
using var request = JsonDocument.Parse(line);
var root = request.RootElement;
var scenario = root.GetProperty("input").GetProperty("documents")[0].GetProperty("source").GetString();
if (scenario == "crash") { Environment.Exit(7); return; }
if (scenario == "hang") { await Task.Delay(60000); return; }
if (scenario == "malformed") { Console.WriteLine("not-json"); return; }
if (scenario == "oversize") { Console.WriteLine(new string('x', 17 * 1024 * 1024)); return; }
if (scenario == "stderr") { Console.Error.WriteLine(new string('x', 70 * 1024)); await Task.Delay(60000); return; }
Console.WriteLine(JsonSerializer.Serialize(new { protocolVersion = scenario == "version" ? 99 : 1, id = scenario == "id" ? "unexpected" : root.GetProperty("id").GetString(), ok = true, diagnostics = Array.Empty<string>(), result = new { badShape = true } }));
await Task.Delay(1000);
