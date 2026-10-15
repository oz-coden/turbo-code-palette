# Known issues and release gates

- Development snapshot 0.0.1. License grant is pending (MIT is the owner's preferred
  candidate, to revisit before release). No Marketplace/GitHub release is authorized.
- Runtime is VS Code 1.134.0 or later. OS test evidence is recorded separately in
  Phase 7 results; untested platforms and accessibility assistive technologies must
  not be represented as verified.
- Native local filesystem roots are the trusted Insert/import/export source. Private
  URI providers and unverifiable link/file identities stay ineligible.
- Mixed editor edits/resource creation is unsupported. New-folder publication has no
  editor Undo; multi-Pack rollback is not implemented. Existing files never overwrite.
- Generic structural/semantic inference is intentionally narrow. Generic Bundle is
  review JSON. Generic Clean Copy preserves ordinary comments and whitespace.
- Standalone C# analysis is not a workspace project model. Missing references, unsafe
  directives, caller-info-sensitive rewrites, ambiguity or parse failures can block
  semantic operations. No workspace build/generator execution occurs.
- Advanced C# needs an existing .NET 10 runtime. No runtime download/installation is
  automated. The packaged helper is optional; generic workflows remain available.
- AtCoder policy cannot verify web publication or certify submission eligibility.
  Publication dates are user assertions. Origin selection cannot prove completeness.
- Source Save never auto-bumps versions. Save, Reload, then explicitly edit revision.
- D&D is retired. No raw payload fallback or internal workbench API is used.
- Comments/headers with unsafe context, shebang/encoding or unsupported syntax may
  prevent attribution output; choosing none does not disable known license retention.
