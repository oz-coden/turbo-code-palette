using System.Text;
using System.Text.Json;
using Tcp.CSharp;

// One active request. The reader remains responsive to a cancellation envelope.
Console.InputEncoding = new UTF8Encoding(false, true);
Console.OutputEncoding = new UTF8Encoding(false);
var json = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
var outputLock = new SemaphoreSlim(1);
Task? active = null;
CancellationTokenSource? cancellation = null;
string? activeId = null;
async Task Reply(object value) {
    var line = JsonSerializer.Serialize(value, json);
    if (Encoding.UTF8.GetByteCount(line) > 16 * 1024 * 1024) throw new InvalidOperationException("response-limit");
    await outputLock.WaitAsync();
    try { await Console.Out.WriteLineAsync(line); await Console.Out.FlushAsync(); }
    finally { outputLock.Release(); }
}
try {
    var reader = Console.OpenStandardInput(); var buffer = new byte[4096]; var line = new MemoryStream();
    int count;
    while ((count = await reader.ReadAsync(buffer)) > 0) {
        for (var i = 0; i < count; i++) {
            if (buffer[i] != 10) {
                if (line.Length >= 8 * 1024 * 1024) throw new InvalidOperationException("request-limit");
                line.WriteByte(buffer[i]); continue;
            }
            using var envelope = JsonDocument.Parse(line.ToArray(), new JsonDocumentOptions { MaxDepth = 64 }); line.SetLength(0);
            var request = envelope.RootElement.Clone();
            var id = request.GetProperty("id").GetString() ?? throw new InvalidOperationException("request-id");
            if (id.Length is < 1 or > 80 || request.GetProperty("protocolVersion").GetInt32() != 1) throw new InvalidOperationException("protocol-mismatch");
            var operation = request.GetProperty("operation").GetString();
            if (operation == "cancel") { if (id == activeId) cancellation?.Cancel(); continue; }
            if (active is { IsCompleted: false }) { await Reply(new { protocolVersion = 1, id, ok = false, diagnostics = new[] { "helper-busy" }, result = (object?)null }); continue; }
            cancellation?.Dispose(); cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(15)); activeId = id;
            var token = cancellation.Token;
            active = Task.Run(async () => {
                try {
                    var watch = System.Diagnostics.Stopwatch.StartNew();
                    var result = Engine.Execute(operation ?? "", request.GetProperty("input"), token);
                    await Reply(new { protocolVersion = 1, id, ok = true, diagnostics = result.Diagnostics, result = result.Value, metrics = new { elapsedMs = watch.Elapsed.TotalMilliseconds, workingSetBytes = Environment.WorkingSet, managedBytes = GC.GetTotalMemory(false) } });
                } catch (Exception error) when (error is not OutOfMemoryException) {
                    // No source, paths or exception stacks in protocol diagnostics.
                    await Reply(new { protocolVersion = 1, id, ok = false, diagnostics = new[] { error is OperationCanceledException ? "cancelled" : "analysis-refused: " + error.Message }, result = (object?)null });
                }
            }, CancellationToken.None);
        }
    }
    cancellation?.Cancel(); if (active != null) await active;
} catch (Exception) { await Console.Error.WriteLineAsync("TCP C# protocol terminated (invalid input or transport failure)."); Environment.ExitCode = 2; }
