# User guide

[日本語の使い方・チュートリアル・手動QA](https://github.com/oz-coden/turbo-code-palette/blob/main/docs/ja/README.md)

Turbo Code Palette manages reusable code as Snippets and Packs across languages
and uses. Its core needs VS Code, not .NET or a contest policy. This development
snapshot is version 0.0.1; Marketplace publication and a formal release are pending.

## Quick start: JavaScript, Python or HTML

1. Open a normal text editor containing code. Select a function, a Python fragment,
   or HTML markup. Run **Turbo Code Palette: Create Snippet from Selection**.
2. Choose Workspace or Global. Enter a name, description and version in the form,
   then Save. File capture and **New Snippet** are also available. New empty source
   can be edited using **Open source in editor** in the detail view.
3. Open Turbo Code Palette in the Activity Bar. Snippets and Packs are native trees.
   Select a row to reuse the central detail panel. Advanced fields are collapsed.
4. In your destination editor, choose the insertion position first. Use a row's
   Insert arrow, its context menu, **Insert Snippet** from Command Palette, or a
   member's Insert button in Pack details. All use the same transaction pipeline.
5. Create a Pack, search/add Snippets, review its dependency closure, then Save.
   Export a Pack to a new `.tcp-sp` filename and Import it into another library.

Keyboard: Command Palette exposes creation, search, Insert, options, copy, archive,
Clean Copy, Reload, favorites and settings commands. Native trees support keyboard
navigation and context menus. Forms use labelled controls, buttons, native details
elements and a status feedback region. A screen reader audit remains pending.

## Libraries and revisions

Workspace storage is `.snippets` in each workspace folder. Global uses extension
storage or **Configure Global Root**. **Open Global Library Folder** / **Reveal
Global Library** make assets accessible. Loading alone creates no library files.
Copy to Workspace / Global preserves original assets; Snippets choose Default or
a new Pack and include dependencies, while Packs copy the entire Pack.

Within one Pack, a UUID has one Snippet version. Different Packs/library locations
can hold different versions. Identical UUID/version/content locations share a
logical row; different versions have separate rows. Same revision/different content
is a conflict. Favorites, recent and counts are local user state, not asset metadata.

Edit code in the normal editor. Save → **Reload Library** → metadata form with an
explicit newer asset version. No auto version bump happens on Save. External changes
offer **Reload / Later** and never reload automatically. Unknown metadata and child
fields survive structured edits. `formatVersion` is schema format; `version` is the
asset revision. Meaning-preserving format migration only updates `formatVersion`.

## Search and Insert

Search supports text and modifiers, e.g. `helper lang:python` or `tag:ui`.
Bad modifiers/constraints show an error rather than expanding results silently.
Dependencies resolve UUID/version constraints through the shared resolver; Pack
dependencies stay in that Pack. Recursive order is dependency-first, cycles stable.
Template `{{NAME}}` inputs are literal, shared per Snippet, and cancellation is inert.

Placement **Mode** is independent from **Options**. Cursor, EOF, replace selection,
merge sources, new-folder separate files and supported structure-aware placement
are available subject to metadata restrictions. **Insert Snippet with Mode…** lists
legal modes. Mixed editor/file plans stop with a reason; no partial writes occur.
Single-document Insert supports one Undo. New folder/file publication is outside
editor Undo; review the destination before proceeding.

Ordinary Insert uses defaults without extra option dialogs. **Insert Snippet with
Options…** selects attribution (`none`, `source-urls`, `full`), independent TCP
identity markers, and Preview. **Configure Insert Defaults** opens reusable settings.
Full attribution includes name/version/authors; URLs always come from `source[].url`,
never promoted repository/homepage fields. Dependencies' attribution and notices
are included. License notices are independent and always preserved where known.
If safe comment rendering cannot be proven, output stops. Preview offers standard
VS Code Diff. Conflicts stop and offer Compare; replacement/forking is explicit.

## Clean Copy

Choose Selection, Current File or Dependency Bundle in the sidebar; then Readable,
Competitive or Custom; then Clipboard, Preview/Untitled or Save As. Originals stay
unchanged. Preview and output use the same frozen final plan. Save As requires a new
native filename outside libraries, with source/alias/symlink/overwrite protection.
Cancellation/failure does not update clipboard, files or usage counts.

Generic Readable and Competitive only remove proven independent TCP marker comment
pairs; uncertain candidates remain with warnings. HTML and unsupported languages
preserve text. Custom lists provider-supported transforms. There is no generic
comment stripping, import removal, rename, minify or code golf fallback.
**Clean Copy with Attribution…** can attach source URLs/full details. A physical
library source can establish origin; otherwise explicitly choose an origin or
keep text unlinked. Markers/text matches alone never establish provenance. Known
`licenseNotices[].text` are exact-deduplicated and preserved; unsafe comment/selection
placement stops output. TCP does not determine legal permission to remove notices.

Generic Bundle is a review JSON document, with explicit asset selection, not a
semantic concatenation. With an available C# provider, a single-file semantic Bundle
is also offered. Both reuse the metadata dependency resolver and conflict rules.

## Optional C# provider

The VSIX includes a portable framework-dependent helper. With an existing .NET 10
runtime, `csharpProvider: auto` locates it automatically. TCP never installs or
downloads a runtime. **C# Provider Status** explains unavailable reasons; disable
the provider to keep only generic functions. Custom DLL path is an advanced override.
Workspace trust is required. Configuration changes require Reload Window.

Roslyn offers export candidates in C# metadata forms, explicit syntax-aware
placement, collision validation, semantic Bundle and additional Clean transforms.
Readable removes proven identity markers. Competitive also removes provably unused
usings and normalizes whitespace when safe. Custom can remove ordinary/XML comments.
Source URLs and recognized notices survive. Unknown or insufficient semantic context
stops advanced operations. Standalone C# 14 is the default; language version/defines
can be set explicitly. No workspace build, generator or MSBuild target is executed.
Missing .NET leaves generic Insert, storage, archives and basic Clean Copy available.

## Optional Compliance Policy

Policy defaults to **none**, independently of presets and attribution settings.
**Choose Optional Compliance Policy** accepts an explicit contest start with timezone.
AtCoder ABC/ARC/AGC policy pins the
[2026-10-14 official rule change](https://github.com/atcoder/rules/commit/61500f0afb842798a5ab626725350059540bec04).
AI origin uses `provenance.aiUsage`, canonical citations use `source[].url`, and
`source[].publication/publishedAt` are assertions. With AI/unknown origin, missing
URL/public-before-start assertions stop output. Policy forces source URL attribution
and displays that change; unreviewed future/obfuscating transforms are denied.
All non-marker comments are conservatively protected under this policy.

TCP does **not** independently verify publication, assertion truth, completeness of
origins/licenses or submission eligibility, and never labels output compliant.
Users must review official rules, publication evidence and license obligations.
Identity BEGIN/END markers are separate from source URL comments and license notices.

See [known issues](known-issues.md) and [architecture](architecture-review.md).
