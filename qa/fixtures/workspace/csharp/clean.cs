using System;
using System.Collections.Generic;

// Source URL: https://example.com/tcp-qa/clean
// TCP License: Synthetic QA source header: retain this text.
/// <summary>Ordinary XML documentation for transform testing.</summary>
class CommentDemo
{
    // An ordinary removable comment.
    const string Literal = "// TCP BEGIN marker-like string, not a marker";
    const string Raw = """
// TCP END marker-like text inside a raw string
""";
    public static void Print() { Console.WriteLine(Literal + Raw); }
}
