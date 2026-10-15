# Turbo Code Palette

Manage, search, share and reuse code **Snippets** and **Packs** across programming languages and purposes in VS Code.

This is a development snapshot (0.0.1), not a formal v1 release. The core works without .NET and without a contest policy. [License decision is pending](LICENSE); MIT is the preferred candidate for later confirmation.

## Start using it

1. Select JavaScript, Python, HTML or other code in an editor and run **Turbo Code Palette: Create Snippet from Selection**. File capture and New Snippet are also available.
2. Choose Workspace/Global, enter metadata in the form, and Save. Use **Open source in editor** for ordinary code editing.
3. Open the TCP Activity Bar. Search the native Snippets/Packs views; select an item to see its details in a reusable central panel.
4. Choose the insertion position in your editor, then use **Insert** on the Snippet row, context menu, Command Palette or Pack member.
5. Group code in Packs, copy between libraries and share a Pack as a normal ZIP-based `.tcp-sp` archive.

## Features

- Language-neutral storage, search, versions, open metadata and unknown-field preservation.
- One explicit Insert pipeline for dependencies, literal templates, legal modes, optional preview, conflicts and stale-state checks.
- Modes (cursor, EOF, selection, separate files, merged sources and supported structure-aware placement) independent of attribution/identity-marker/preview options.
- Read-only VS Code Diff for preview/conflicts; explicit fork/replace choices for supported library workflows.
- Clean Copy to clipboard, exact preview/untitled or a protected new filename; originals stay unchanged.
- Favorites/recent/counts as local user state; external changes use Reload/Later.
- Optional Language Providers: packaged Roslyn helper for C# advanced features, using an existing .NET 10 runtime. Basic TCP does not require .NET.
- Optional Compliance Policy: AtCoder 2026-10-14 attribution constraints. Disabled by default; no submission-eligibility certification.

Ordinary Insert stays one action unless template/conflict/input is needed. Advanced **Insert with Options** controls `none` / `source-urls` / `full` attribution, TCP markers and Preview independently. Known license notices are always separate. Repository/homepage fields never substitute for canonical `source[].url`. Unsupported safe-comment placement stops output.

## Documentation

- [User Guide / Quick Start](docs/user-guide.md)
- [Known issues / release gates](docs/known-issues.md)
- [Changelog](CHANGELOG.md), [third-party notices](THIRD_PARTY_NOTICES.md)
- [Metadata schemas](schemas), [design review](docs/architecture-review.md)
- [Phase 6 evidence](docs/phase6-results.md), [Phase 7 evidence](docs/phase7-results.md)
- [Public repository security checks](docs/public-repository-security.md)

Within a Pack, a Snippet UUID has one version. Multiple versions can coexist in different Packs/library locations. `formatVersion` (schema) and `version` (asset revision) are independent. Source Save never automatically changes the revision: Save → Reload → explicit metadata revision.

## Development and validation

Use Node.js 24 and `npm ci`. `npm run compile`, `npm run test:unit`, and `npm test` check the extension. Helper development additionally uses .NET 10 SDK: `npm run build:csharp`, `npm run test:csharp`, `npm run measure:csharp`. Only the helper's own fixture projects are built, never user workspace projects.

`npm run package:vsix` builds the framework-dependent helper and an audited local VSIX under ignored test storage. It does not publish. Installing the VSIX does not install a runtime. Runtime/package details and verified environments are recorded in Phase 7 results.

No D&D, unsafe generic semantic fallback, source Save version automation, or mixed editor/file transaction is enabled. Generic Bundle is review JSON; semantic C# Bundle has explicit standalone analysis limits.
