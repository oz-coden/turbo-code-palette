using System.Text.Json;
using Tcp.CSharp;

var count = 0;
JsonElement Run(string operation, string source, object? extra = null, string[]? others = null) {
    var input = new Dictionary<string, object?> { ["documents"] = new[] { new { id = "current.cs", source } }.Concat((others ?? []).Select((s, i) => new { id = "dep-" + i + ".cs", source = s })).ToArray(), ["options"] = new { languageVersion = "14.0" } };
    if (extra != null) foreach (var p in JsonSerializer.SerializeToElement(extra).EnumerateObject()) input[p.Name] = p.Value;
    return JsonSerializer.SerializeToElement(Engine.Execute(operation, JsonSerializer.SerializeToElement(input)).Value);
}
void Check(bool value, string message = "assertion failed") { if (!value) throw new InvalidOperationException(message); }
void Reject(Action action) { try { action(); } catch (InvalidOperationException) { return; } throw new Exception("expected refusal"); }
void Test(string name, Action action) { action(); count++; Console.WriteLine("PASS " + name); }
string Output(JsonElement r) => r.GetProperty("text").GetString()!;

Test("exports: namespace, nested generic types, overload, extension, properties, field, const, delegate", () => {
    var r = Run("analyze", "namespace Demo; public class Outer<T> { internal struct Inner {} public int Field; public const int Value=1; public int P {get;set;} public void F(int x){} public void F(string x){} } public interface I {} public enum E {} public delegate void D(); public static class Ex { public static int Twice(this int x)=>x*2; }");
    var exports = r.GetProperty("exports").EnumerateArray().ToArray();
    foreach (var kind in new[] { "class", "struct", "interface", "enum", "delegate", "method", "extension-method", "property", "field", "const" }) Check(exports.Any(e => e.GetProperty("kind").GetString() == kind), kind);
    Check(exports.Count(e => e.GetProperty("name").GetString() == "F") == 2);
    Check(exports.First(e => e.GetProperty("name").GetString() == "Outer").GetProperty("genericArity").GetInt32() == 1);
});
foreach (var source in new[] { "namespace Demo { class A {} }", "namespace Demo; class A {}", "System.Console.WriteLine(1); class A {}" }) Test("namespace/top-level parse " + count, () => Check(Run("analyze", source).GetProperty("syntaxValid").GetBoolean()));
Test("member placement uses containing nested type", () => {
    const string before = "class Outer { class Inner {\n} }"; var r = Run("place", before, new { offset = before.IndexOf('\n'), source = "public int Value;", targets = new[] { "member" } });
    var after = before.Insert(r.GetProperty("offset").GetInt32(), Output(r)); Run("validate", after); Check(after.IndexOf("Value", StringComparison.Ordinal) < after.IndexOf('}'));
});
Test("statement, using, file-scoped namespace and top-level targets", () => {
    foreach (var c in new[] { ("class A { void M(){\n} }", "int n=1;", "statement", 20), ("class A {}", "using System;", "using", 0), ("namespace N; class A {}", "class B {}", "namespace", 15), ("class A {}", "System.Console.WriteLine(1);", "top-level", 0) }) {
        var r = Run("place", c.Item1, new { source = c.Item2, targets = new[] { c.Item3 }, offset = c.Item4 }); Run("validate", c.Item1.Insert(r.GetProperty("offset").GetInt32(), Output(r)));
    }
});
Test("unavailable/incomplete placement refuses; no regex fallback", () => { Reject(() => Run("place", "class A {", new { offset = 8, source = "int n;", targets = new[] { "member" } })); Reject(() => Run("place", "class A {}", new { offset = 1, source = "return;", targets = new[] { "namespace" } })); });
Test("collision detects namespace/container/signature; valid overload remains legal", () => {
    Run("validate", "class A { void F(int x){} void F(string x){} } namespace N { class A {} }");
    Reject(() => Run("validate", "class A { void F(int x){} void F(int y){} }")); Reject(() => Run("validate", "class A {} class A {}"));
    Reject(() => Run("validate", "partial class A {} partial class A {}"));
});
Test("unresolved/ambiguous binding refuses semantic success", () => { Reject(() => Run("validate", "class A { Missing x; }")); Reject(() => Run("references", "using N; using M; class C { A a; }", others: ["namespace N { public class A {} }", "namespace M { public class A {} }"])); });
Test("malformed exports remain candidates with syntax diagnostics", () => Check(!Run("analyze", "class Broken { void F(").GetProperty("syntaxValid").GetBoolean()));
Test("real semantic references exclude strings/comments", () => {
    var r = Run("references", "class Current { Dep value = new Dep(); string s=\"Unused\"; /*Unused*/ }", others: ["public class Dep {}", "class Unused {}"]);
    Check(r.GetProperty("documents").EnumerateArray().Select(v => v.GetString()).SequenceEqual(new[] { "dep-0.cs" }));
});
Test("generic construction and reduced extension references map back to export definitions", () => {
    var result = Run("references", "class Current { Box<int> value = new Box<int>(); int M()=>1.Twice(); }", others: ["public class Box<T> {} public static class Extensions { public static int Twice(this int n)=>n*2; }"]);
    var references = result.GetProperty("references").EnumerateArray().ToArray();
    Check(references.Any(r => r.GetProperty("name").GetString() == "Box" && r.GetProperty("signature").GetString() == "Box<T>"));
    Check(references.Any(r => r.GetProperty("name").GetString() == "Twice" && r.GetProperty("signature").GetString() == "Extensions.Twice(int)"));
});
Test("semantic Bundle converts file namespace, respects top-level and compiles", () => {
    var text = Output(Run("bundle", "System.Console.WriteLine(N.Dep.Answer);", others: ["namespace N; public class Dep { public const int Answer=42; }"]));
    Check(text.Contains("namespace N")); Check(text.IndexOf("WriteLine", StringComparison.Ordinal) < text.IndexOf("class Dep", StringComparison.Ordinal)); Run("validate", text);
});
Test("Bundle preserves dependency-first order; rejects changing using scopes and directives", () => {
    var text = Output(Run("bundle", "class Current { Dep d=new Dep(); }", others: ["class Base {}", "class Dep : Base {}"])); Check(text.IndexOf("class Base", StringComparison.Ordinal) < text.IndexOf("class Dep", StringComparison.Ordinal));
    Reject(() => Run("bundle", "using System; class C {}", others: ["class Dep {}"])); Reject(() => Run("bundle", "#nullable enable\nclass C {}", others: ["class Dep {}"]));
});
Test("Bundle identical using scopes deduplicate without dropping dependency header/license comments", () => {
    var text = Output(Run("bundle", "using System; Console.WriteLine(Dep.Answer);", others: ["// Source URL: https://example.com/dep\n// unclassified license notice\nusing System; class Dep { public const int Answer=42; }"]));
    Check(text.Contains("unclassified license notice")); Check(text.Contains("Source URL:")); Run("validate", text);
});
const string begin = "// TCP BEGIN {\"id\":\"60000000-0000-0000-0000-000000000001\",\"version\":\"v1.0.0\",\"contentHash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}";
const string end = "// TCP END {\"id\":\"60000000-0000-0000-0000-000000000001\",\"version\":\"v1.0.0\"}";
Test("syntax marker pairs removed; source URL and licenses independent", () => {
    var text = "// Source URL: https://example.com/code\n// TCP License: keep me\n" + begin + "\nclass A {}\n" + end;
    var clean = Output(Run("clean", text, new { transforms = new[] { "remove-tcp-markers", "remove-comments" } })); Check(!clean.Contains("TCP BEGIN")); Check(clean.Contains("Source URL:")); Check(clean.Contains("keep me"));
});
Test("partial selection, nested/orphan/noncanonical markers stay", () => {
    var text = begin + "\nclass A {}\n" + end;
    Check(Output(Run("clean", text, new { start = 0, end = begin.Length, transforms = new[] { "remove-tcp-markers" } })) == begin);
    var nested = begin + "\n" + begin + "\n" + begin + "\nclass A {}\n" + end + "\n" + end + "\n" + end;
    Check(Output(Run("clean", nested, new { transforms = new[] { "remove-tcp-markers" } })) == nested);
    var malformed = text.Replace("v1.0.0", "v01.0.0"); Check(Output(Run("clean", malformed, new { transforms = new[] { "remove-tcp-markers" } })) == malformed);
});
Test("marker evidence uses syntax comments, never raw string content", () => {
    Check(Run("markers", begin + "\nclass A {}\n" + end).GetProperty("markers").GetArrayLength() == 1);
    Check(Run("markers", "class A { string S = \"\"\"\n" + begin + "\n" + end + "\n\"\"\"; }").GetProperty("markers").GetArrayLength() == 0);
});
Test("raw/verbatim/interpolated string marker text is preserved", () => {
    foreach (var literal in new[] { "\"\"\"\n" + begin + "\n" + end + "\n\"\"\"", "@\"" + (begin + "\n" + end).Replace("\"", "\"\"") + "\"", "$\"TCP BEGIN {1}\"", "\"// TCP BEGIN string\"" }) {
        var text = "class A { string S = " + literal + "; }"; var clean = Output(Run("clean", text, new { transforms = new[] { "remove-tcp-markers", "remove-comments", "remove-xml-docs" } })); Check(clean == text);
    }
});
Test("preprocessor inactive markers stay; directives preserved", () => {
    var text = "#if NEVER\n" + begin + "\nclass Inactive {}\n" + end + "\n#endif\nclass Active {}"; Check(Output(Run("clean", text, new { transforms = new[] { "remove-tcp-markers", "remove-comments" } })).Contains(begin));
    Reject(() => Run("clean", text, new { transforms = new[] { "normalize-whitespace" } }));
});
Test("ordinary/XML comments use trivia; token separation retained", () => {
    var text = "class A {\n/// <summary>ordinary docs</summary>\nint /*comment*/ x; void M(){ int/*separate*/y=1; } }";
    var clean = Output(Run("clean", text, new { transforms = new[] { "remove-comments", "remove-xml-docs" } })); Check(!clean.Contains("summary")); Check(!clean.Contains("/*comment*/")); Run("validate", clean);
});
Test("AtCoder conservatively retains all non-marker comments including unclassified notices", () => {
    var text = "class A { /*custom notice without legal keywords*/ int x; }"; Check(Output(Run("clean", text, new { transforms = new[] { "remove-comments", "remove-xml-docs" }, protectAllComments = true })) == text);
});
Test("safe normalization preserves literal tokens; malformed input/unknown transform refuses", () => {
    Run("validate", Output(Run("clean", "class A{string S=@\" a   b \";}", new { transforms = new[] { "normalize-whitespace" } })));
    Reject(() => Run("clean", "class A {", new { transforms = new[] { "remove-comments" } })); Reject(() => Run("clean", "class A {}", new { transforms = new[] { "minify" } }));
});
Test("unused using requires complete error-free binding and retains used imports/notice trivia", () => {
    var text = "// Copyright retained\nusing System;\nusing System.Text;\nclass A { StringBuilder Value = new StringBuilder(); }";
    var cleaned = Output(Run("clean", text, new { transforms = new[] { "remove-unused-usings" } })); Check(!cleaned.Contains("using System;")); Check(cleaned.Contains("using System.Text;")); Check(cleaned.Contains("Copyright retained")); Run("validate", cleaned);
    Reject(() => Run("clean", "using System; class A { Unknown x; }", new { transforms = new[] { "remove-unused-usings" } }));
});
Test("caller-info normalization/Bundle is refused, EOF notices survive Bundle", () => {
    var source = "class A { static void F([System.Runtime.CompilerServices.CallerLineNumber] int line=0){} static void M(){F();} }";
    Reject(() => Run("clean", source, new { transforms = new[] { "normalize-whitespace" } })); Reject(() => Run("bundle", source, others: ["class B {}"]));
    Check(Output(Run("bundle", "class C {}\n// trailing notice", others: ["namespace N; // namespace notice\nclass D {}\n// dependency notice"])).Contains("dependency notice"));
});
Test("BOM/directives/header survive syntax-safe license and URL attachment", () => {
    var text = "\uFEFF// original header\n#nullable enable\nclass A {}"; var result = Output(Run("header", text, new { notices = new[] { "License\nSecond line" }, urls = new[] { "https://example.com/source", "https://example.com/source" } }));
    Check(result.StartsWith('\uFEFF')); Check(result.Contains("#nullable enable")); Check(result.Contains("original header")); Check(result.Split("Source URL:").Length == 2); Run("validate", result);
});
Test("explicit language version and defines; unsupported/preview options rejected", () => {
    var input = JsonSerializer.SerializeToElement(new { documents = new[] { new { id = "a.cs", source = "#if KNOWN\nclass Known {}\n#endif" } }, options = new { languageVersion = "12.0", defines = new[] { "KNOWN" } } });
    Check(JsonSerializer.SerializeToElement(Engine.Execute("analyze", input).Value).GetProperty("exports").GetArrayLength() == 1);
    Reject(() => Engine.Execute("analyze", JsonSerializer.SerializeToElement(new { documents = new[] { new { id = "a.cs", source = "class A {}" } }, options = new { languageVersion = "preview" } })));
});
Test("full attribution details are independent of identity markers and reject line injection", () => {
    var source = "class A {}"; var output = Output(Run("header", source, new { notices = new[] { "Keep" }, urls = new[] { "https://example.com/code" }, details = new[] { "Snippet: A v1.0.0 | Authors: Author" } }));
    Check(output.Contains("Source URL:")); Check(output.Contains("Snippet: A v1.0.0 | Authors: Author")); Check(output.Contains("TCP License: Keep")); Check(!output.Contains("TCP BEGIN")); Run("validate", output);
    Reject(() => Run("header", source, new { details = new[] { "bad\nline" } }));
});
Console.WriteLine($"Roslyn tests passed: {count}");
