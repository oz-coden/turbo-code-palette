using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Text;

namespace Tcp.CSharp;

public record Result(object Value, string[] Diagnostics);
public sealed record InputDocument(string Id, string Source);
public static class Engine {
    static readonly Lazy<MetadataReference[]> References = new(() => ((string?)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") ?? "")
        .Split(Path.PathSeparator).Where(p => Path.GetFileName(p).StartsWith("System.", StringComparison.Ordinal) || Path.GetFileName(p) == "System.Private.CoreLib.dll" || Path.GetFileName(p) == "Microsoft.CSharp.dll")
        .Select(p => MetadataReference.CreateFromFile(p)).ToArray());
    static readonly SymbolDisplayFormat Display = SymbolDisplayFormat.CSharpErrorMessageFormat;
    static string Text(JsonElement node, string name, string fallback = "") => node.TryGetProperty(name, out var value) ? value.GetString() ?? fallback : fallback;
    static bool Flag(JsonElement node, string name) => node.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;
    static string[] Strings(JsonElement node, string name) => node.TryGetProperty(name, out var value) ? value.EnumerateArray().Select(v => v.GetString() ?? throw new InvalidOperationException("string-array")).ToArray() : [];
    public static Result Execute(string operation, JsonElement input, CancellationToken token = default) {
        var diagnostics = new List<string>();
        var options = input.TryGetProperty("options", out var o) ? o : default;
        var versionText = options.ValueKind == JsonValueKind.Object ? Text(options, "languageVersion") : "";
        var version = LanguageVersion.CSharp14;
        if (versionText == "") diagnostics.Add("Standalone analysis uses C# 14 and helper runtime references; project imports, references, generated code and build properties are not evaluated.");
        else if (!LanguageVersionFacts.TryParse(versionText, out version) || version is LanguageVersion.Default or LanguageVersion.Latest or LanguageVersion.LatestMajor or LanguageVersion.Preview) throw new InvalidOperationException("Use an explicit supported C# language version.");
        var defines = options.ValueKind == JsonValueKind.Object ? Strings(options, "defines") : [];
        if (defines.Length > 128 || defines.Any(d => d.Length > 128 || !SyntaxFacts.IsValidIdentifier(d))) throw new InvalidOperationException("Invalid preprocessor symbols.");
        var parse = new CSharpParseOptions(version, DocumentationMode.Diagnose, SourceCodeKind.Regular, defines);
        var documents = input.GetProperty("documents").EnumerateArray().Select(d => new InputDocument(Text(d, "id"), Text(d, "source"))).ToArray();
        if (documents.Length is < 1 or > 128 || documents.Select(d => d.Id).Distinct().Count() != documents.Length || documents.Any(d => d.Id.Length is < 1 or > 128 || d.Source.Contains('\0')) || documents.Sum(d => d.Source.Length) > 4 * 1024 * 1024) throw new InvalidOperationException("Document limits/identity.");
        var trees = documents.Select(d => CSharpSyntaxTree.ParseText(d.Source, parse, path: d.Id, cancellationToken: token)).ToArray();
        var syntaxErrors = trees.SelectMany(t => t.GetDiagnostics(token)).Where(d => d.Severity == DiagnosticSeverity.Error).ToArray();
        diagnostics.AddRange(syntaxErrors.Take(20).Select(Describe));
        var compilation = CSharpCompilation.Create("TcpAnalysis", trees, References.Value, new CSharpCompilationOptions(trees.Any(t => t.GetRoot(token).DescendantNodes().OfType<GlobalStatementSyntax>().Any()) ? OutputKind.ConsoleApplication : OutputKind.DynamicallyLinkedLibrary, allowUnsafe: false));
        var root = (CompilationUnitSyntax)trees[0].GetRoot(token);
        var model = compilation.GetSemanticModel(trees[0]);
        object value;
        switch (operation) {
            case "analyze":
                value = new { exports = Exports(root, model, token), syntaxValid = syntaxErrors.Length == 0, semanticErrors = compilation.GetDiagnostics(token).Where(d => d.Severity == DiagnosticSeverity.Error).Take(40).Select(Describe).ToArray() }; break;
            case "place":
                RequireSyntax(syntaxErrors); value = Place(input, documents[0].Source, root, parse, token); break;
            case "validate":
                RequireSyntax(syntaxErrors); RequireSemantic(compilation, token);
                if (root.DescendantNodes().OfType<TypeDeclarationSyntax>().Any(n => model.GetDeclaredSymbol(n, token)?.DeclaringSyntaxReferences.Length > 1)) throw new InvalidOperationException("Ambiguous partial-type implementation collision; explicit comparison is required.");
                value = new { valid = true }; break;
            case "references":
                RequireSyntax(syntaxErrors); RequireSemantic(compilation, token);
                var paths = new HashSet<string>(); var referenced = new List<object>(); var unresolved = new List<string>();
                foreach (var name in root.DescendantNodes().OfType<SimpleNameSyntax>()) {
                    token.ThrowIfCancellationRequested(); var info = model.GetSymbolInfo(name, token);
                    if (info.CandidateReason != CandidateReason.None || info.CandidateSymbols.Length > 0) { unresolved.Add("Ambiguous reference at " + name.SpanStart); continue; }
                    var symbol = info.Symbol;
                    if (symbol == null) continue; // Declaration names/context keywords do not necessarily bind independently.
                    foreach (var location in symbol.Locations.Where(l => l.IsInSource && l.SourceTree != trees[0])) {
                        paths.Add(location.SourceTree!.FilePath);
                        // Metadata candidates describe definitions, whereas references can be constructed
                        // generic symbols or reduced extension calls with the receiver parameter removed.
                        var exported = (symbol switch { IMethodSymbol { MethodKind: MethodKind.Constructor } constructor => constructor.ContainingType, IMethodSymbol { ReducedFrom: { } extension } => extension, _ => symbol }).OriginalDefinition;
                        referenced.Add(new { document = location.SourceTree.FilePath, name = exported.Name, @namespace = exported.ContainingNamespace?.IsGlobalNamespace == false ? exported.ContainingNamespace.ToDisplayString() : "", container = exported.ContainingType?.ToDisplayString(Display) ?? "", signature = exported.ToDisplayString(Display) });
                    }
                }
                if (unresolved.Count > 0) throw new InvalidOperationException(string.Join("; ", unresolved.Take(10)));
                value = new { documents = paths.Order().ToArray(), references = referenced.Take(10000).ToArray() }; break;
            case "bundle":
                RequireSyntax(syntaxErrors); RequireSemantic(compilation, token);
                var combined = Bundle(trees, token);
                var generated = CSharpCompilation.Create("TcpBundle", [CSharpSyntaxTree.ParseText(combined, parse, cancellationToken: token)], References.Value, compilation.Options);
                RequireSemantic(generated, token);
                using (var binary = new MemoryStream()) { var emitted = generated.Emit(binary, cancellationToken: token); if (!emitted.Success) throw new InvalidOperationException("Bundle emit failed: " + string.Join("; ", emitted.Diagnostics.Where(d => d.Severity == DiagnosticSeverity.Error).Take(10).Select(Describe))); }
                value = new { text = combined, validated = "standalone-runtime-compilation" }; break;
            case "clean":
                RequireSyntax(syntaxErrors); value = Clean(input, documents[0].Source, root, parse, token); break;
            case "header":
                RequireSyntax(syntaxErrors); value = Header(input, documents[0].Source, root, parse, token); break;
            case "markers":
                RequireSyntax(syntaxErrors);
                var trivia = root.DescendantTrivia().ToArray(); var ranges = MarkerRanges(documents[0].Source, trivia, 0, documents[0].Source.Length);
                value = new { markers = trivia.Where(t => ranges.Contains(t.Span) && t.ToString().StartsWith("// TCP BEGIN ", StringComparison.Ordinal)).Select(t => { using var json = JsonDocument.Parse(t.ToString()[13..]); return new { id = Text(json.RootElement, "id"), version = Text(json.RootElement, "version"), contentHash = Text(json.RootElement, "contentHash") }; }).ToArray() }; break;
            default: throw new InvalidOperationException("Unknown operation.");
        }
        return new(value, diagnostics.ToArray());
    }
    static string Describe(Diagnostic d) => $"{d.Id} at {d.Location.SourceSpan.Start}: {d.GetMessage(System.Globalization.CultureInfo.InvariantCulture)}";
    static void RequireSyntax(Diagnostic[] errors) { if (errors.Length > 0) throw new InvalidOperationException("Parse errors; syntax/semantic operation refused."); }
    static void RequireSemantic(CSharpCompilation compilation, CancellationToken token) {
        var errors = compilation.GetDiagnostics(token).Where(d => d.Severity == DiagnosticSeverity.Error).Take(12).ToArray();
        if (errors.Length > 0) throw new InvalidOperationException("Incomplete/unresolved/ambiguous standalone binding: " + string.Join("; ", errors.Select(Describe)));
    }
    static object[] Exports(CompilationUnitSyntax root, SemanticModel model, CancellationToken token) => root.DescendantNodes().Where(n => n is BaseTypeDeclarationSyntax or DelegateDeclarationSyntax or MethodDeclarationSyntax or PropertyDeclarationSyntax || n is VariableDeclaratorSyntax { Parent.Parent: FieldDeclarationSyntax }).Select(node => {
        token.ThrowIfCancellationRequested(); var symbol = model.GetDeclaredSymbol(node, token);
        if (symbol == null) return null;
        var kind = symbol switch { INamedTypeSymbol t => t.TypeKind.ToString().ToLowerInvariant(), IMethodSymbol m => m.IsExtensionMethod ? "extension-method" : "method", IFieldSymbol f => f.IsConst ? "const" : "field", IPropertySymbol => "property", _ => symbol.Kind.ToString().ToLowerInvariant() };
        return (object)new { kind, name = symbol.Name, @namespace = symbol.ContainingNamespace.IsGlobalNamespace ? "" : symbol.ContainingNamespace.ToDisplayString(), container = symbol.ContainingType?.ToDisplayString(Display) ?? "", signature = symbol.ToDisplayString(Display), accessibility = symbol.DeclaredAccessibility.ToString().ToLowerInvariant(), genericArity = symbol is INamedTypeSymbol nt ? nt.Arity : symbol is IMethodSymbol ms ? ms.Arity : 0 };
    }).Where(n => n != null).Cast<object>().Take(10000).ToArray();

    static object Place(JsonElement input, string before, CompilationUnitSyntax root, CSharpParseOptions options, CancellationToken token) {
        var cursor = input.GetProperty("offset").GetInt32(); if (cursor < 0 || cursor > before.Length) throw new InvalidOperationException("Invalid target offset.");
        var source = Text(input, "source"); var targets = Strings(input, "targets");
        var requestedEol = Text(input, "eol");
        if (requestedEol.Length > 0 && requestedEol is not "\n" and not "\r\n") throw new InvalidOperationException("Unsupported placement line ending.");
        var eol = requestedEol.Length > 0 ? requestedEol : before.Contains("\r\n", StringComparison.Ordinal) ? "\r\n" : "\n";
        // Normalize syntax trivia only. Newlines inside literal tokens remain data.
        var incoming = CSharpSyntaxTree.ParseText(source, options, cancellationToken: token).GetRoot(token);
        source = incoming.ReplaceTrivia(incoming.DescendantTrivia().Where(t => t.IsKind(SyntaxKind.EndOfLineTrivia)), (_, _) => SyntaxFactory.EndOfLine(eol)).ToFullString();
        if (targets.Length == 0) throw new InvalidOperationException("C# structure-aware requires explicit insert.targets.");
        // Classify a fragment by parsing in the exact syntactic context of each allowed target.
        var candidates = new List<(int Offset, string Context)>();
        bool Allowed(params string[] names) => names.Any(targets.Contains);
        var fragment = CSharpSyntaxTree.ParseText(source, options, cancellationToken: token).GetCompilationUnitRoot(token);
        if (Allowed("using", "usings") && fragment.Usings.Count > 0 && fragment.Members.Count == 0 && fragment.Externs.Count == 0 && fragment.AttributeLists.Count == 0) candidates.Add((root.Usings.LastOrDefault()?.FullSpan.End ?? root.Externs.LastOrDefault()?.FullSpan.End ?? 0, "using"));
        if (Allowed("using", "usings") && fragment.Usings.Count > 0 && fragment.Members.Count == 0) foreach (var ns in root.DescendantNodes().OfType<BaseNamespaceDeclarationSyntax>().Where(n => n.FullSpan.Contains(cursor))) candidates.Add((ns.Usings.LastOrDefault()?.FullSpan.End ?? (ns is NamespaceDeclarationSyntax b ? b.OpenBraceToken.Span.End : ((FileScopedNamespaceDeclarationSyntax)ns).SemicolonToken.Span.End), "namespace using"));
        if (Allowed("file", "top-level")) { candidates.Add((root.Members.LastOrDefault(m => m is GlobalStatementSyntax)?.FullSpan.End ?? root.Members.FirstOrDefault()?.FullSpan.Start ?? before.Length, "top-level")); candidates.Add((before.Length, "top-level")); }
        if (Allowed("namespace")) {
            foreach (var ns in root.DescendantNodes().OfType<BaseNamespaceDeclarationSyntax>()) {
                // A file-scoped namespace extends through EOF trivia, which Roslyn
                // can attach to the compilation unit rather than this node's span.
                if (ns.FullSpan.Contains(cursor) || cursor == ns.FullSpan.End || ns is FileScopedNamespaceDeclarationSyntax file && cursor >= file.SemicolonToken.Span.End)
                    candidates.Add((ns is NamespaceDeclarationSyntax b ? b.CloseBraceToken.SpanStart : before.Length, ns is FileScopedNamespaceDeclarationSyntax ? "file-scoped namespace" : "namespace"));
            }
            if (!root.Members.OfType<BaseNamespaceDeclarationSyntax>().Any()) candidates.Add((before.Length, "namespace"));
        }
        if (Allowed("type", "member")) foreach (var type in root.DescendantNodes().OfType<TypeDeclarationSyntax>().Where(t => t.FullSpan.Contains(cursor))) candidates.Add((type.CloseBraceToken.SpanStart, "type/member"));
        if (Allowed("method", "statement")) foreach (var block in root.DescendantNodes().OfType<BlockSyntax>().Where(b => b.FullSpan.Contains(cursor))) {
            // Inserting at an arbitrary token offset can split an expression; use a statement boundary.
            var next = block.Statements.FirstOrDefault(s => s.FullSpan.Start >= cursor);
            candidates.Add((next?.FullSpan.Start ?? block.CloseBraceToken.SpanStart, "method/statement"));
        }
        var valid = candidates.Distinct().Select(c => (c.Offset, c.Context, Text: eol + source + eol)).Where(c => {
            var after = before.Insert(c.Offset, c.Text); return !CSharpSyntaxTree.ParseText(after, options, cancellationToken: token).GetDiagnostics(token).Any(d => d.Severity == DiagnosticSeverity.Error);
        }).OrderBy(c => Math.Abs(c.Offset - cursor)).ThenBy(c => c.Offset).ToArray();
        if (valid.Length == 0) throw new InvalidOperationException("No proven legal insertion target. Choose an explicit mode or repair syntax; no fallback.");
        var nearest = valid.Where(c => Math.Abs(c.Offset - cursor) == Math.Abs(valid[0].Offset - cursor)).ToArray();
        if (nearest.Select(c => c.Offset).Distinct().Count() > 1) throw new InvalidOperationException("Ambiguous nearest insertion targets. Select a closer context explicitly.");
        return new { offset = valid[0].Offset, text = valid[0].Text, context = valid[0].Context };
    }

    static string Bundle(SyntaxTree[] trees, CancellationToken token) {
        var roots = trees.Select(t => (CompilationUnitSyntax)t.GetRoot(token)).ToArray();
        if (roots.Any(r => r.ContainsDirectives || r.Externs.Count > 0 || r.AttributeLists.Count > 0)) throw new InvalidOperationException("Bundle directives/extern aliases/assembly attributes require a richer project context.");
        // Cross-file using scope changes can silently rebind symbols. Only identical using sets are merged.
        static string UsingKey(UsingDirectiveSyntax u) => u.WithoutTrivia().NormalizeWhitespace().ToFullString();
        var keys = roots[0].Usings.Select(UsingKey).Order().ToArray();
        if (roots.Any(r => !r.Usings.Select(UsingKey).Order().SequenceEqual(keys))) throw new InvalidOperationException("Bundle using scopes differ; explicit source adjustment is required.");
        var members = new List<MemberDeclarationSyntax>();
        // Input[0] is the current file; dependencies are already in resolver dependency-first order.
        foreach (var r in roots.Skip(1).Append(roots[0])) foreach (var member in r.Members) {
            if (member is FileScopedNamespaceDeclarationSyntax fs) members.Add(SyntaxFactory.NamespaceDeclaration(fs.Name).WithNamespaceKeyword(fs.NamespaceKeyword).WithOpenBraceToken(SyntaxFactory.Token(SyntaxKind.OpenBraceToken).WithTrailingTrivia(fs.SemicolonToken.TrailingTrivia)).WithExterns(fs.Externs).WithUsings(fs.Usings).WithMembers(fs.Members).WithLeadingTrivia(fs.GetLeadingTrivia()));
            else members.Add(member);
        }
        if (members.OfType<GlobalStatementSyntax>().Any() && roots.Skip(1).Any(r => r.Members.OfType<GlobalStatementSyntax>().Any())) throw new InvalidOperationException("Only the current file may contain top-level statements.");
        var ordered = members.OfType<GlobalStatementSyntax>().Cast<MemberDeclarationSyntax>().Concat(members.Where(m => m is not GlobalStatementSyntax));
        var tail = SyntaxFactory.TriviaList(roots.SelectMany(r => r.EndOfFileToken.LeadingTrivia));
        // Deduplicating identical compilation-unit usings must not discard their source/license comments.
        var usingNotices = SyntaxFactory.TriviaList(roots.Skip(1).SelectMany(r => r.Usings).SelectMany(u => u.DescendantTrivia()).Where(t => t.IsKind(SyntaxKind.SingleLineCommentTrivia) || t.IsKind(SyntaxKind.MultiLineCommentTrivia) || t.IsKind(SyntaxKind.SingleLineDocumentationCommentTrivia) || t.IsKind(SyntaxKind.MultiLineDocumentationCommentTrivia)).SelectMany(t => new[] { t, SyntaxFactory.EndOfLine("\n") }));
        var result = SyntaxFactory.CompilationUnit().WithUsings(roots[0].Usings).WithMembers(SyntaxFactory.List(ordered)).WithEndOfFileToken(SyntaxFactory.Token(tail, SyntaxKind.EndOfFileToken, default)).WithLeadingTrivia(usingNotices.AddRange(roots[0].GetLeadingTrivia())).NormalizeWhitespace().ToFullString() + "\n";
        // Require every originally bound name to bind to the same display signature in the single-file result.
        // Current implementation rejects scope-changing using sets above and checks compilation below;
        // partial declarations and overloaded bindings receive an additional reference fingerprint check.
        var original = CSharpCompilation.Create("Before", trees, References.Value, new CSharpCompilationOptions(members.OfType<GlobalStatementSyntax>().Any() ? OutputKind.ConsoleApplication : OutputKind.DynamicallyLinkedLibrary));
        RefuseCallerInfo(original, token);
        var afterTree = CSharpSyntaxTree.ParseText(result, (CSharpParseOptions)trees[0].Options, cancellationToken: token);
        var after = CSharpCompilation.Create("After", [afterTree], References.Value, original.Options);
        static string[] Bindings(CSharpCompilation c, CancellationToken ct) => c.SyntaxTrees.SelectMany(t => {
            var model = c.GetSemanticModel(t); return t.GetRoot(ct).DescendantNodes().OfType<SimpleNameSyntax>().Where(n => !n.Ancestors().OfType<UsingDirectiveSyntax>().Any(u => u.Parent is CompilationUnitSyntax)).Select(n => model.GetSymbolInfo(n, ct).Symbol?.ToDisplayString(Display)).Where(s => s != null).Cast<string>();
        }).Order().ToArray();
        if (!Bindings(original, token).SequenceEqual(Bindings(after, token))) throw new InvalidOperationException("Bundle changes symbol bindings; no output.");
        return result;
    }

    static object Clean(JsonElement input, string full, CompilationUnitSyntax root, CSharpParseOptions options, CancellationToken token) {
        var start = input.TryGetProperty("start", out var s) ? s.GetInt32() : 0; var end = input.TryGetProperty("end", out var e) ? e.GetInt32() : full.Length;
        if (start < 0 || end < start || end > full.Length) throw new InvalidOperationException("Invalid clean range.");
        var transforms = Strings(input, "transforms"); var warnings = new List<string>(); var edits = new List<(int Start, int End, string Text)>();
        var trivia = root.DescendantTrivia(descendIntoTrivia: false).ToArray(); var markerRanges = MarkerRanges(full, trivia, start, end);
        var protectedComments = Flag(input, "protectAllComments");
        if (transforms.Contains("remove-unused-usings")) {
            if (start != 0 || end != full.Length) throw new InvalidOperationException("Unused using removal requires a complete standalone compilation.");
            var compilation = CSharpCompilation.Create("Usings", [root.SyntaxTree], References.Value, new CSharpCompilationOptions(root.DescendantNodes().OfType<GlobalStatementSyntax>().Any() ? OutputKind.ConsoleApplication : OutputKind.DynamicallyLinkedLibrary));
            RequireSemantic(compilation, token);
            foreach (var diagnostic in compilation.GetSemanticModel(root.SyntaxTree).GetDiagnostics(cancellationToken: token).Where(d => d.Id == "CS8019")) {
                var directive = root.FindNode(diagnostic.Location.SourceSpan).AncestorsAndSelf().OfType<UsingDirectiveSyntax>().FirstOrDefault();
                if (directive == null || directive.ContainsDirectives || directive.DescendantTrivia().Any(t => directive.Span.Contains(t.Span) && (t.IsKind(SyntaxKind.SingleLineCommentTrivia) || t.IsKind(SyntaxKind.MultiLineCommentTrivia)))) continue;
                var content = directive.ToString(); edits.Add((directive.SpanStart, directive.Span.End, new string(content.Select(ch => ch is '\r' or '\n' ? ch : ' ').ToArray())));
            }
        }
        foreach (var t in trivia) {
            token.ThrowIfCancellationRequested(); if (t.FullSpan.Start < start || t.FullSpan.End > end) continue;
            var marker = markerRanges.Any(r => r == t.Span);
            bool remove = marker && transforms.Contains("remove-tcp-markers");
            bool ordinary = t.IsKind(SyntaxKind.SingleLineCommentTrivia) || t.IsKind(SyntaxKind.MultiLineCommentTrivia);
            bool xml = t.IsKind(SyntaxKind.SingleLineDocumentationCommentTrivia) || t.IsKind(SyntaxKind.MultiLineDocumentationCommentTrivia);
            var content = t.ToFullString();
            // URLs (including Source URL comments), the full file header, and license-like notices are never stripped.
            var protectedNotice = protectedComments || t.SpanStart < (root.GetFirstToken().SpanStart) || content.Contains("http://", StringComparison.OrdinalIgnoreCase) || content.Contains("https://", StringComparison.OrdinalIgnoreCase) || content.Contains("license", StringComparison.OrdinalIgnoreCase) || content.Contains("copyright", StringComparison.OrdinalIgnoreCase) || content.Contains("SPDX", StringComparison.OrdinalIgnoreCase);
            if (!marker && !protectedNotice && (ordinary && transforms.Contains("remove-comments") || xml && transforms.Contains("remove-xml-docs"))) remove = true;
            if (remove) edits.Add((t.FullSpan.Start, t.FullSpan.End, new string(content.Select(ch => ch is '\r' or '\n' or '\u0085' or '\u2028' or '\u2029' ? ch : ' ').ToArray())));
        }
        foreach (var edit in edits.OrderByDescending(x => x.Start)) full = full[..edit.Start] + edit.Text + full[edit.End..];
        var text = full[start..end];
        if (transforms.Contains("normalize-whitespace")) {
            if (start != 0 || end != full.Length || root.ContainsDirectives) throw new InvalidOperationException("Whitespace normalization requires a complete directive-free document.");
            var parsed = CSharpSyntaxTree.ParseText(full, options, cancellationToken: token).GetRoot(token);
            var compilation = CSharpCompilation.Create("Clean", [parsed.SyntaxTree], References.Value, new CSharpCompilationOptions(parsed.DescendantNodes().OfType<GlobalStatementSyntax>().Any() ? OutputKind.ConsoleApplication : OutputKind.DynamicallyLinkedLibrary));
            RequireSemantic(compilation, token); RefuseCallerInfo(compilation, token);
            // Raw/interpolated literal token text is preserved by Roslyn. Verify the token stream explicitly.
            var normalized = parsed.NormalizeWhitespace().ToFullString(); var check = CSharpSyntaxTree.ParseText(normalized, options, cancellationToken: token).GetRoot(token);
            if (!Tokens(parsed).SequenceEqual(Tokens(check))) throw new InvalidOperationException("Normalization changed tokens.");
            text = (full.StartsWith('\uFEFF') && !normalized.StartsWith('\uFEFF') ? "\uFEFF" : "") + normalized;
        }
        if (transforms.Any(t => !new[] { "remove-tcp-markers", "remove-comments", "remove-xml-docs", "normalize-whitespace", "remove-unused-usings" }.Contains(t))) throw new InvalidOperationException("Unsupported transform; no fallback.");
        if (text.Contains("TCP BEGIN ") || text.Contains("TCP END ")) warnings.Add("Marker-like text retained where a complete independent comment pair was not proven (including literals/inactive directives).");
        if (transforms.Contains("remove-comments") || transforms.Contains("remove-xml-docs")) warnings.Add("Comment removal is explicit: metadata notices, source URL comments and file headers are preserved. Unclassified inline notices cannot be identified legally; AtCoder policy retains all non-marker comments.");
        return new { text, warnings };
    }
    static IEnumerable<string> Tokens(SyntaxNode root) => root.DescendantTokens().Select(t => t.RawKind + ":" + t.Text);
    static void RefuseCallerInfo(CSharpCompilation compilation, CancellationToken token) {
        foreach (var tree in compilation.SyntaxTrees) {
            var model = compilation.GetSemanticModel(tree);
            foreach (var invocation in tree.GetRoot(token).DescendantNodes().Where(n => n is InvocationExpressionSyntax or ObjectCreationExpressionSyntax or ImplicitObjectCreationExpressionSyntax)) {
                if (model.GetSymbolInfo(invocation, token).Symbol is IMethodSymbol method && method.Parameters.Any(p => p.GetAttributes().Any(a => a.AttributeClass?.ContainingNamespace.ToDisplayString() == "System.Runtime.CompilerServices" && a.AttributeClass.Name is "CallerLineNumberAttribute" or "CallerFilePathAttribute"))) throw new InvalidOperationException("Source relocation/normalization may change caller information; operation refused.");
            }
        }
    }
    static List<TextSpan> MarkerRanges(string text, SyntaxTrivia[] trivia, int start, int endOffset) {
        var result = new List<TextSpan>(); (SyntaxTrivia Trivia, string Identity)? open = null; var depth = 0; var nested = false;
        foreach (var t in trivia.Where(t => t.IsKind(SyntaxKind.SingleLineCommentTrivia))) {
            var lineStart = text.LastIndexOf('\n', Math.Max(0, t.SpanStart - 1));
            if (!string.IsNullOrWhiteSpace(text[(lineStart + 1)..t.SpanStart])) continue;
            var value = t.ToString(); var begin = value.StartsWith("// TCP BEGIN ", StringComparison.Ordinal); var end = value.StartsWith("// TCP END ", StringComparison.Ordinal); if (!begin && !end) continue;
            try {
                using var json = JsonDocument.Parse(value[(begin ? 13 : 11)..]); var node = json.RootElement;
                var id = Text(node, "id"); var version = Text(node, "version");
                if (!Guid.TryParseExact(id, "D", out _) || !System.Text.RegularExpressions.Regex.IsMatch(version, @"^v(0|[1-9][0-9]{0,31})\.(0|[1-9][0-9]{0,31})\.(0|[1-9][0-9]{0,31})(?:-(0|[1-9][0-9]{0,31}))?$") || node.EnumerateObject().Count() != (begin ? 3 : 2)) continue;
                if (begin && !System.Text.RegularExpressions.Regex.IsMatch(Text(node, "contentHash"), "^[a-f0-9]{64}$")) continue;
                var identity = id.ToLowerInvariant() + ":" + version;
                if (begin) { depth++; if (depth > 1) { nested = true; } else { open = (t, identity); nested = false; } }
                else { if (depth > 0) depth--; if (depth == 0) { if (!nested && open is { } first && first.Identity == identity && first.Trivia.SpanStart >= start && t.Span.End <= endOffset) { result.Add(first.Trivia.Span); result.Add(t.Span); } open = null; nested = false; } }
            } catch (JsonException) { /* Invalid marker candidates remain source text. */ }
        }
        return result;
    }
    static object Header(JsonElement input, string source, CompilationUnitSyntax root, CSharpParseOptions options, CancellationToken token) {
        var notices = Strings(input, "notices"); var urls = Strings(input, "urls"); var details = Strings(input, "details");
        if (details.Length > 10000 || details.Sum(d => d.Length) > 1024 * 1024 || details.Any(d => d.Any(char.IsControl) || d.Contains('\u2028') || d.Contains('\u2029'))) throw new InvalidOperationException("Unsafe attribution details.");
        if (notices.Length + urls.Length > 10000 || notices.Sum(n => n.Length) > 1024 * 1024 || notices.Any(n => n.Any(ch => char.IsControl(ch) && ch is not '\r' and not '\n' and not '\t') || n.Contains('\u2028') || n.Contains('\u2029')) || urls.Any(u => !Uri.TryCreate(u, UriKind.Absolute, out var uri) || uri.Scheme is not ("https" or "http") || u.Any(char.IsWhiteSpace))) throw new InvalidOperationException("Unsafe attribution/notice text.");
        var existingUrls = root.DescendantTrivia().Where(t => t.IsKind(SyntaxKind.SingleLineCommentTrivia) && t.ToString().StartsWith("// Source URL: ", StringComparison.Ordinal)).Select(t => t.ToString()[15..]).ToHashSet(StringComparer.Ordinal);
        var lines = urls.Distinct().Where(u => !existingUrls.Contains(u)).Select(u => "// Source URL: " + u).Concat(details.Distinct().Select(d => "// " + d)).Concat(notices.Distinct().SelectMany(n => n.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n').Select(l => "// TCP License: " + l)));
        var prefix = string.Join("\n", lines); if (prefix.Length > 0) prefix += "\n";
        var bom = source.StartsWith('\uFEFF') ? "\uFEFF" : "";
        var text = bom + prefix + source[bom.Length..];
        var after = CSharpSyntaxTree.ParseText(text, options, cancellationToken: token).GetRoot(token);
        if (!Tokens(root).SequenceEqual(Tokens(after))) throw new InvalidOperationException("Attribution placement changed syntax tokens.");
        return new { text };
    }
}
