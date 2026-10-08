# Turbo Code Palette v1 Specification + Initial Codex Prompt

## 0. Purpose

Turbo Code Palette (TCP) is a VS Code extension for storing reusable code assets as snippets, browsing them from a palette-like sidebar, dragging/dropping or explicitly inserting them into code, grouping them into distributable Packs, and producing cleaned/bundled output for tasks such as competitive programming submissions.

The product must remain simple at the surface even if its internal model is rigorous.

Core UX principle:

> Find a snippet in the Turbo Code Palette sidebar, drag it into the editor, and have TCP insert it intelligently.

Management features such as metadata, Packs, versioning, dependency resolution, conflict handling, import/export, and Clean Copy support that core interaction rather than replacing it.

---

# 1. Product principles

## 1.1 Surface simplicity, internal rigor

The user-facing flow should stay lightweight:

- search/browse snippet
- drag & drop or Insert
- optionally inspect details
- optionally manage metadata / Packs
- optionally Clean Copy / Dependency Bundle

Internally, TCP may track:

- UUID identity
- versions
- Packs
- dependencies
- exports
- insertion rules
- format versions
- conflicts
- metadata semantics

but these should not create unnecessary friction in normal use.

## 1.2 Open metadata model

`snippet.json` and `pack.json` are open JSON documents.

TCP defines semantics only for recognized / named fields. Unknown fields are valid and must be preserved.

Conceptually:

> Metadata is free-form data. Certain field names are special forms that TCP understands.

Requirements:

- Unknown fields are NOT invalid.
- Unknown fields must survive load/edit/save round-trips.
- Unknown fields should be shown in the detail view.
- The raw JSON must remain viewable/editable.
- Future TCP versions may assign meaning to previously unknown fields.

Internal architecture should therefore treat raw metadata as authoritative, with typed semantic views layered on top.

Suggested mental model:

```text
MetadataDocument
├─ Raw JSON object
└─ Semantic views
   ├─ name
   ├─ version
   ├─ dependencies
   ├─ exports
   ├─ insert rules
   └─ ...
```

## 1.3 User state is separate from distributable metadata

User-local state must not be treated as Pack/Snippet semantics.

Examples:

- favorite
- recent
- usage count
- sort preference
- filter state
- collapsed/expanded UI state

If a Pack contains an unknown field named `favorite`, TCP may preserve/display it as metadata, but it must NOT automatically favorite the item for the importing user.

---

# 2. Storage scopes

TCP supports two storage scopes with the same internal structure.

## 2.1 Global

A global snippet root managed by the extension/user.

Conceptual structure:

```text
<global-snippets-root>/
└─ <Pack>/
   ├─ pack.json
   └─ <Snippet>/
      ├─ snippet.json
      └─ source files...
```

## 2.2 Workspace

Project-local storage:

```text
<workspace>/.snippets/
└─ <Pack>/
   ├─ pack.json
   └─ <Snippet>/
      ├─ snippet.json
      └─ source files...
```

Global and Workspace must use the same Pack/Snippet loader model; only the root differs.

Whether `.snippets/` is committed to Git is entirely the user's choice. TCP must not force `.gitignore` or source-control policy.

---

# 3. Pack model

## 3.1 Everything belongs to a Pack

Every Snippet belongs to a Pack.

Both Global and Workspace should have a `Default` Pack available as the initial/default destination for newly created or copied individual snippets.

A Pack is self-contained:

- Pack-to-Pack dependencies do not exist.
- If a Snippet in a Pack depends on another Snippet, the dependency must also physically exist in that Pack.
- Recursive dependencies are automatically included when required.

## 3.2 Pack identity

Pack identity is defined by UUID + version.

Rules:

```text
same UUID + same version + same content
→ same Pack identity/version

same UUID + higher version
→ newer version of same Pack

same UUID + same version + different content
→ conflict / invalid state

different UUID
→ different Pack
```

Different versions of the same Pack may coexist.

## 3.3 Pack version format

See section 8.

## 3.4 Pack contents

Pack membership is determined from actual Pack folder contents.

Do NOT duplicate a canonical Snippet list in `pack.json` unless Codex identifies a compelling technical reason. Avoid two sources of truth.

Pack custom ordering is NOT stored.

UI sorting/search handles presentation order.

## 3.5 Pack deletion constraints

Deleting a Snippet from a Pack must be blocked if another Snippet in the same Pack depends on it, unless the dependent Snippet(s) are removed in the same operation.

TCP must NOT automatically remove apparently-unused dependencies.

## 3.6 Pack creation/editing

Create and Edit should use the same form.

Form should support:

- Pack metadata
- selected Snippets
- automatically-added dependencies
- Snippet search/addition
- Snippet removal when dependency constraints allow it

When creating a Pack from selected Snippets, recursive dependencies are automatically included.

## 3.7 Copy between scopes

Use explicit terminology:

- `Copy to Workspace`
- `Copy to Global`

Original item remains in place.

Pack copy:

- copies the Pack as a Pack

Snippet copy:

- destination is either `Default` or a newly created Pack
- dependencies are recursively copied too

Global ↔ Workspace behavior should be symmetric.

---

# 4. Snippet model

A Snippet is an arbitrary reusable code asset.

It may represent:

- class
- struct
- interface
- enum
- method/function
- DFS fragment
- several lines of code
- whole file
- multiple files
- any other source asset

TCP must not assume all Snippets are C# or even structurally parseable.

Advanced semantic behavior can initially be implemented through language providers, beginning with C#.

## 4.1 Snippet identity

Snippet identity is UUID + version.

Rules:

```text
same UUID + same version + same content
→ same Snippet identity/version

same UUID + higher version
→ newer revision of the same Snippet

same UUID + same version + different content
→ conflict / invalid state

different UUID
→ different Snippet
```

Editing the implementation while considering it the same Snippet keeps UUID and requires a version increase.

A fork/new distinct asset gets a new UUID and may record `derivedFrom`.

Pack-to-Pack copying preserves UUID/version.

## 4.2 Duplicate display

Same UUID + same version + same content appearing in multiple Packs/scopes should be represented as one logical card where practical, with all locations visible in details.

Different versions must appear as separate cards so that direct drag/drop does not require an extra version-selection step.

## 4.3 Existing code after insertion

Inserted code becomes ordinary project code.

TCP does NOT maintain synchronization with the original Snippet.

No hidden Workspace provenance tracking is required for v1.

Optional source marker comments may be inserted, for example:

```text
// TCP-Snippet: <uuid> v1.2.0
```

Source marker insertion should be configurable. Clean Copy may remove TCP markers.

---

# 5. Metadata format

## 5.1 Format version

Both `snippet.json` and `pack.json` use:

```json
"formatVersion": 1
```

This is distinct from the Snippet/Pack's own `version`.

`formatVersion` = metadata format/schema generation.

`version` = asset revision.

### Missing formatVersion

Treat as legacy / v0-equivalent where possible.

- best-effort read
- show Legacy indication
- offer explicit format upgrade
- do not auto-write

### Older supported format

- read normally where possible
- show Upgrade Format action in details
- upgrade only by explicit user action
- in-place upgrade is the default
- no automatic backup management
- failed transformation must leave the original intact

### Newer format than TCP understands

Use best-effort read-only behavior:

- read fields whose semantics are safely known
- preserve unknown fields
- do not write/edit metadata
- do not guess unknown insertion semantics
- allow raw metadata/source/reveal operations
- clearly show newer-format warning

## 5.2 Multiplicity rule

If a field can reasonably have multiple values, design it as an Array from the start.

Examples:

- `authors`
- `languages`
- `tags`
- `features`
- `sources`
- `dependencies`
- `exports`
- `examples`
- `compatibility`
- `refer`
- `licenses`
- `licenseNotices`

Single-item arrays are normal.

## 5.3 Minimal Snippet metadata

Conceptually:

```json
{
  "formatVersion": 1,
  "id": "<uuid>",
  "name": "SegmentTree",
  "version": "v1.0.0",
  "sources": ["SegmentTree.cs"]
}
```

Other fields are optional unless required by the semantics of a used feature.

## 5.4 Suggested Snippet named fields

Recognized named fields may include:

```text
formatVersion
id
name
version
description
authors[]
languages[]
category
tags[]
features[]
sources[]
dependencies[]
exports[]
insert
sourceOverrides
licenses[]
licenseNotices[]
usage[]
examples[]
notes
compatibility[]
status
source[]
repository[]
homepage[]
distribution[]
refer[]
templateVariables[]
derivedFrom
```

Other arbitrary fields remain valid.

## 5.5 Suggested Pack named fields

Pack should intentionally stay lighter:

```text
formatVersion
id
name
version
description
authors[]
source[]
distribution[]
```

Other arbitrary fields remain valid.

---

# 6. Links / references metadata

Link-like metadata should use arrays of objects rather than raw strings.

Example:

```json
"refer": [
  {
    "label": "API Documentation",
    "url": "https://example.com/docs"
  },
  {
    "label": "README",
    "path": "README.md"
  }
]
```

Likewise `source`, `repository`, `homepage`, and `distribution` may be arrays of objects.

Named keys TCP may understand initially:

- `label`
- `url`
- `path`

Additional keys are allowed and preserved.

Semantics:

- `source`: origin / source material
- `repository`: repository locations
- `homepage`: project/author pages
- `distribution`: download/distribution locations
- `refer`: arbitrary related docs/files/URLs

v1 may treat these as display/navigation metadata only.

---

# 7. License metadata

## 7.1 licenses

Array of objects.

Example:

```json
"licenses": [
  {
    "id": "MIT",
    "name": "MIT License",
    "url": "https://example.com/license",
    "file": "LICENSE"
  }
]
```

TCP may initially understand `id` and `name`; other fields are allowed/preserved.

Do not assume a fixed license enum. Custom licenses must remain possible.

## 7.2 licenseNotices

Array of objects.

Example:

```json
"licenseNotices": [
  {
    "text": "Copyright (c) 2026 oz-coden",
    "preserve": true,
    "source": "LICENSE"
  }
]
```

For v1, `text` is the only field that must have defined display/Clean Copy semantics.

Other fields are free-form unless later promoted to recognized semantics.

Clean Copy may preserve `licenseNotices[].text` even when removing ordinary comments, subject to user settings.

TCP is not a legal-advice engine and should not make legal claims about whether a notice may be removed.

---

# 8. Versioning

## 8.1 Syntax

Formal asset version syntax:

```text
v[major].[middle].[minor](-[patch])
```

Examples:

```text
v1.0.0
v1.2.3
v1.2.3-4
v12.3.4-56
```

All components are non-negative integers.

`v` is part of the canonical syntax.

## 8.2 Comparison

Treat as four numeric components:

```text
major, middle, minor, patch
```

Missing patch behaves lower than positive patch for the same first three numbers.

Examples:

```text
v1.2.3 < v1.2.3-1 < v1.2.3-2 < v1.2.4
```

## 8.3 Dependency constraints

Support comparison operators only:

```text
=v1.2.3
>v1.2.3
>=v1.2.0
<v2.0.0
<=v1.9.9
>=v1.2.0 <v2.0.0
```

Do NOT require `^` / `~` semantics.

A dependency may omit a version constraint, but this is discouraged.

Missing constraint means any available version of the required UUID is acceptable.

---

# 9. Dependencies

Example:

```json
"dependencies": [
  {
    "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "name": "MathUtil",
    "version": ">=v1.0.0 <v2.0.0"
  }
]
```

Rules:

- `id` required
- `name` required
- `version` optional but recommended
- dependency resolution identity is UUID-based
- name is human-readable confirmation/display

If `name` differs from the resolved Snippet's name:

- continue resolving by UUID
- show a lightweight name-mismatch warning
- do not auto-rewrite metadata

## 9.1 Resolution priority

```text
1. Workspace
2. Global
```

Within a scope, choose an appropriate version satisfying the constraint.

If equally valid candidates remain ambiguous, ask the user.

Do not silently substitute an invalid version.

When an exact requested version is unavailable but candidates exist, UI may recommend a candidate, but it must not silently choose an incompatible one.

## 9.2 Insertion of dependencies

Dependencies are automatically inserted recursively by default.

A setting may later allow:

- ask before inserting dependencies
- always preview dependency plan

Default normal path should not create unnecessary prompts.

Insertion order should be dependency-first (topological order).

Cycles:

- detect SCCs
- treat each SCC as a group
- use deterministic stable ordering inside SCC
- warn if useful, but do not invent semantics

Each dependency Snippet uses its own insertion settings.

If an already-inserted/available dependency satisfies the requirement, do not duplicate it.

---

# 10. Exports

`exports` describes symbols/features a Snippet provides externally, primarily for dependency mapping and Dependency Bundle.

Example:

```json
"exports": [
  {
    "kind": "type",
    "name": "SegmentTree"
  },
  {
    "kind": "method",
    "name": "Prod",
    "container": "SegmentTree"
  }
]
```

Rules:

- `kind` required
- `name` required
- `kind` is an open string, NOT a fixed global enum
- language providers may understand language-specific kinds
- additional fields such as `container`, `namespace`, `signature` are allowed
- arbitrary additional fields must be preserved

C# provider may auto-detect likely exports when creating/editing a Snippet, but the user must be able to review/edit them.

---

# 11. Template variables

Template substitution is a v1 semantic feature.

Syntax in source:

```text
{{NAME}}
```

Example:

```csharp
private {{TYPE}} value;
public {{TYPE}} Get() => value;
```

Metadata example:

```json
"templateVariables": [
  {
    "name": "TYPE",
    "default": "long",
    "required": false,
    "description": "Element type",
    "options": ["int", "long", "double"]
  }
]
```

Initial recognized semantics:

- `name`
- `default`
- `required`
- `description`
- `options`

Rules:

- Same variable name is one variable across the entire Snippet, including multiple source files.
- User enters the value once; all occurrences are replaced.
- If source contains `{{NAME}}` but metadata does not define it, treat it as required input at insertion time.
- Do not leave unresolved `{{NAME}}` placeholders after insertion.
- If any required value is unresolved, insertion must not complete.
- Advanced validation/pattern support is future work.

---

# 12. Sources

`sources` is an array of file paths relative to the Snippet directory.

Example:

```json
"sources": [
  "SegmentTree.cs",
  "SegmentTreeExtensions.cs"
]
```

No per-source role field is required.

Metadata UI should show source files and provide actions such as:

- Open
- Reveal
- Add Source
- Remove Source

Source code editing itself is done in the normal VS Code editor, not in a custom TCP code editor.

---

# 13. Insertion model

## 13.1 Primary interaction

Primary normal interaction:

> Drag Snippet card from TCP sidebar into the code editor.

D&D should use Snippet metadata to decide how to insert.

Secondary explicit interaction:

> Right-click Snippet → Insert menu → choose insertion mode.

Snippet list and Snippet entries inside Pack details should expose the same insertion behavior.

## 13.2 insert metadata

Example:

```json
"insert": {
  "defaultMode": "structure-aware",
  "allowedModes": [
    "structure-aware",
    "cursor",
    "end-of-file"
  ],
  "deniedModes": [
    "replace-selection"
  ],
  "targets": [
    "namespace",
    "top-level"
  ]
}
```

Current insertion mode vocabulary:

```text
cursor
end-of-file
replace-selection
structure-aware
separate-files
merge-sources
```

`allowedModes` and `deniedModes` may both be omitted.

Suggested precedence:

1. denied mode is not usable
2. if allowedModes is present, usable modes must also appear there
3. if neither present, modes are not restricted by explicit metadata
4. defaultMode must resolve to a usable mode

The exact disabled/hidden UI treatment may be chosen for best UX.

## 13.3 Structure-aware targets

Possible target vocabulary for initial C# provider:

```text
top-level
namespace
type
method
statement
using
```

Multiple targets may be specified.

If targets are omitted, the language provider may infer placement.

If multiple targets are valid, prefer the nearest valid enclosing structure around the drop/cursor location.

Do not silently place code in a semantically nonsensical location.

## 13.4 Source overrides

Future-capable schema may permit per-source overrides.

Example:

```json
"sourceOverrides": {
  "Helper.cs": {
    "defaultMode": "structure-aware",
    "targets": ["type"]
  }
}
```

Properties not overridden inherit from the Snippet-level insert configuration.

v1 UI may hide this under Advanced or leave semantic implementation for later as long as metadata is accepted/preserved.

---

# 14. Snippet creation / editing

Supported creation flows:

- selected code → Save as Turbo Snippet
- current file → Save File as Snippet
- dedicated New Snippet metadata flow

Normal creation UI should stay small:

```text
Name
Pack
Language(s)
Description

▼ More Options
```

More Options may contain advanced metadata.

Structural information should be auto-detected when practical, especially for C#:

- name
- languages
- exports
- likely dependencies
- source structure

User can edit before saving.

Metadata editing uses a dedicated metadata form.

Source editing uses normal VS Code editor.

Actions may include:

- Insert
- Insert with Preview
- Edit Metadata
- Open Source
- Reveal in Explorer
- Open Terminal Here
- Duplicate / Fork
- Copy to Workspace / Global
- Delete
- View Raw Metadata

---

# 15. Sidebar / Detail UX

## 15.1 High-level views

Turbo Code Palette sidebar contains major sections/views:

```text
Snippets
Packs
Clean Copy
Settings
```

The UI inspiration is VS Code's Extensions view:

- search/browse in sidebar
- select an item
- open rich details in editor area

Details should use one reusable TCP detail tab rather than creating a new tab for every selection.

## 15.2 Snippet cards

Snippet list card should be lightweight but informative:

```text
SegmentTree
Range query data structure
C# · v1.2.0 · Workspace · 2 Packs
```

Do NOT put feature lists directly on the compact card.

Features belong in details.

Same UUID/version/content may be merged into one card with multiple locations.

Different versions appear as separate cards.

## 15.3 Snippet details

Potential content:

- name
- description
- features
- version
- languages
- tags
- category
- locations / Packs / scopes
- dependencies
- exports
- sources
- source code preview
- license info
- usage
- examples
- notes
- compatibility
- arbitrary additional metadata
- actions

## 15.4 Pack details

Potential content:

- name
- description
- version
- authors
- source/distribution
- contained Snippets
- Snippet versions
- actions

Actions:

- Copy to Workspace / Global
- Add Snippet
- Edit
- Export
- Open Folder
- Reveal in Explorer

Pack D&D is not required for v1.

---

# 16. Search and filtering

Search targets:

- name (strongest)
- tags
- category
- features
- description (weak/optional)

Search ranking should prioritize roughly:

```text
exact name
> name prefix
> name partial
> tags/category
> features
> description
```

Then use scope/version tie-breaking.

Normal non-search ordering for related versions:

```text
Workspace before Global
then newer version first
```

Search supports both:

- GUI filters
- textual search modifiers

Suggested modifiers:

```text
lang:
tag:
category:
pack:
scope:workspace|global
version:
author:
feature:
```

Search modifier autocompletion is desirable.

Autocomplete values should come from actual known metadata where appropriate.

Multiple selection should be supported for bulk actions such as:

- Copy to Workspace / Global
- Create Pack
- add to existing Pack
- export
- delete

Multiple-item D&D is not required for v1.

---

# 17. External edits / refresh

Files may be edited outside TCP:

- normal VS Code edits
- Explorer edits
- Git pulls
- folder copies
- raw metadata edits

TCP should detect changes via watchers, but should NOT silently reload state.

Instead show a notification such as:

```text
Snippet files changed outside Turbo Code Palette.
[Reload] [Later]
```

Debounce batches of changes into one prompt.

---

# 18. Conflict handling

Same UUID + same version + different content is invalid/conflicting.

Do not simply allow both as equivalent.

Resolution options may include:

- Compare
- Use as New Version
- Create New Snippet / new UUID
- Replace one copy

VS Code's existing diff editor should be used where practical.

If the asset is actually a new distinct thing, assign a new UUID.

If it is the same asset with changed content, increase version.

---

# 19. Import / Export

## 19.1 Pack format

File extension:

```text
.tcp-sp
```

Underlying representation:

> ordinary ZIP archive

Contents:

- `pack.json`
- Snippet directories
- source files
- other Pack files

The format should remain inspectable with normal ZIP tools.

## 19.2 Import preview

Before import, show a lightweight summary:

- additions
- already-existing identical items
- version coexistence
- conflicts

Conflict rules follow the normal UUID/version/content rules.

## 19.3 Security

Codex must explicitly review archive extraction safety, including path traversal / ZIP Slip, malformed metadata, duplicate UUIDs, unsafe paths, and transactional extraction.

---

# 20. Clean Copy

Clean Copy is a major TCP sidebar section.

Primary scopes:

- Selection
- Current File
- Dependency Bundle

Default output:

- Clipboard

Optional outputs:

- temporary file
- user-selected output file

Never overwrite source code.

## 20.1 Transform pipeline

Clean Copy should be a configurable transformation pipeline with presets.

Potential transforms:

- remove TCP metadata/source-marker comments
- remove ordinary comments
- remove XML docs
- preserve license notices
- remove unused Snippets/classes
- remove unused usings/imports
- merge files
- remove blank lines
- remove indentation
- minify whitespace
- shorten optional modifiers
- rename locals
- aggressive code-golf transforms

Presets may include:

- Readable
- Competitive
- Custom

v1 does NOT need every aggressive transform. Codex should recommend a safe v1 subset.

## 20.2 Dependency Bundle

Target use case: competitive programming templates where a large reusable library should produce only the required submission code.

Conceptual flow:

```text
current file
→ language-provider symbol analysis
→ match references to Snippet exports
→ recursively resolve metadata dependencies
→ collect needed source files
→ merge
→ apply Clean Copy transforms
→ preview/copy
```

Initial language-specific implementation should focus on C#.

Do not grow this into an arbitrary full-workspace build system.

Metadata dependencies remain authoritative for Snippet-to-Snippet dependencies.

C# analysis primarily maps current code references to known Snippet exports.

---

# 21. Language provider architecture

Base TCP must remain language-agnostic.

Language-specific advanced capabilities belong behind providers/adapters.

Initial advanced provider: C#.

C# provider may use Roslyn or appropriate VS Code/.NET tooling for:

- structural placement
- symbol/export detection
- reference detection
- duplicate/name-collision detection
- unused using analysis where practical
- Dependency Bundle symbol mapping

Do not force advanced semantics on languages that only need raw snippet insertion.

---

# 22. Git integration

Global snippet storage may optionally be a Git repository.

TCP may provide convenience buttons such as:

- Clone
- Pull
- Push
- Commit
- Status
- Open Repo
- Open Terminal
- Reveal in Explorer

TCP must not automatically pull/push by default.

Git remains authoritative for history/version control; TCP should not duplicate a full history system.

---

# 23. Settings

Likely settings include:

- Global snippets root
- default Pack
- default source-marker behavior
- language auto-filter behavior
- dependency insertion confirmation behavior
- Clean Copy default preset/options
- Git integration options
- UI/sort/filter preferences

Settings may be surfaced in the TCP sidebar while persisting through appropriate VS Code configuration/user state mechanisms.

---

# 24. v1 priorities

## MUST

- VS Code extension skeleton and robust architecture
- Global + Workspace roots
- Pack/Snippet discovery
- open metadata model with unknown-field round-trip preservation
- `formatVersion`
- UUID/version identity and conflict detection
- Snippet list/search
- Pack list/search
- detail page in editor area
- one reusable details tab
- Save Selection as Snippet
- Save File as Snippet
- metadata editor
- source open/reveal actions
- Snippet D&D insertion feasibility and implementation where supported
- right-click Insert menu
- core insertion modes that can be safely implemented
- Pack creation/editing
- Copy to Workspace / Global
- dependencies + recursive copying/insertion
- version constraint parser
- template variables `{{NAME}}`
- external-change detection with manual Reload
- `.tcp-sp` ZIP import/export with validation
- basic Clean Copy
- tests for core metadata/version/dependency/conflict logic

## SHOULD

- C# semantic provider
- structure-aware insertion
- export auto-detection
- dependency candidate resolution UI
- VS Code diff for conflicts
- search modifiers + autocomplete
- multi-select bulk actions
- Dependency Bundle for C#
- readable + competitive Clean Copy presets
- Git convenience actions

## FUTURE / MAY DEFER

- per-source insertion overrides UI/semantics
- advanced template validation regex/patterns
- aggressive code-golf transforms
- sophisticated automatic snippet update tracking
- hidden Workspace provenance tracking
- arbitrary whole-workspace bundling/build integration
- advanced language providers beyond C#

---

# 25. Important non-goals for v1

- TCP is NOT a replacement for Git.
- TCP is NOT a full build system.
- TCP is NOT a package manager with Pack-to-Pack dependencies.
- TCP does NOT automatically synchronize inserted code with source Snippets.
- TCP does NOT require every metadata field to have built-in semantics.
- TCP does NOT force a closed metadata schema.
- TCP does NOT need to implement every possible insertion mode perfectly for every language in v1.

---

# 26. Initial Codex task

The first Codex pass should NOT immediately implement the whole product.

Its job is to audit this specification against the existing repository and VS Code APIs, identify contradictions and risky assumptions, and produce an implementation plan.

Only after the audit is accepted should implementation proceed in phases.

---

# Initial Codex Prompt

You are working on the public repository `oz-coden/turbo-code-palette`, a VS Code extension called **Turbo Code Palette**.

The repository may currently be empty or nearly empty. The attached/current specification in this document is the intended product direction.

## Your task for this pass

Do **not** attempt to implement the entire extension yet.

Perform a rigorous pre-implementation architecture and feasibility review of the specification above.

### 1. Repository inspection

Inspect the repository as it currently exists.

Report:

- current files / project state
- whether any extension scaffold already exists
- current package/build/test setup if present
- any constraints imposed by the existing repository

Do not delete or rewrite existing work unless absolutely necessary, and do not make speculative implementation changes during this review pass.

### 2. VS Code API feasibility audit

Verify the feasibility of the proposed UX using actual VS Code extension APIs, especially:

- custom Activity Bar / sidebar views
- TreeView / WebviewView / Webview usage
- Snippet cards resembling the Extensions view
- drag-and-drop from TCP sidebar into text editors
- obtaining drop/cursor position
- right-click context menus with Insert subcommands
- one reusable detail tab in the editor area
- metadata editing UI
- opening source files
- Reveal in Explorer
- diff editor integration
- file system watchers
- clipboard output
- ZIP import/export
- multi-select list behavior
- search input / modifier autocompletion feasibility

For D&D in particular, determine exactly what VS Code officially supports. Do not assume arbitrary sidebar-to-editor drag/drop works the way a browser UI would. If direct drag/drop into the text editor has API limitations, clearly explain them and propose the closest UX that preserves the core "palette → insert" interaction.

### 3. Architecture review

Propose a clean internal architecture that keeps the base system language-agnostic.

At minimum consider modules/services for:

- metadata documents / raw JSON preservation
- semantic named-field views
- Pack discovery/storage
- Snippet discovery/storage
- identity/version comparison
- dependency resolution
- conflict detection
- import/export
- insertion planning
- language providers
- C# provider
- search/indexing
- user state
- Clean Copy pipeline
- Dependency Bundle
- UI/view models

The raw metadata model must preserve unknown fields exactly enough that editing known fields does not silently delete unrelated metadata.

### 4. Schema audit

Review `snippet.json` and `pack.json` semantics.

Check for:

- contradictions
- ambiguous field names
- array/object consistency
- identity/version edge cases
- formatVersion forward/backward compatibility
- dependency range parsing
- duplicate/conflict behavior
- path safety
- template variable ambiguity
- insertion-rule ambiguity

Do not turn the metadata format into a closed schema. Unknown fields are valid by design.

### 5. Version/dependency model audit

Validate or challenge the proposed version syntax:

`v[major].[middle].[minor](-[patch])`

and constraints such as:

`>=v1.2.0 <v2.0.0`

Recommend exact parser/comparison rules and edge-case behavior.

Dependency identity is UUID-based; dependency `name` is also required for humans but is not authoritative for resolution.

Resolution priority should be Workspace before Global.

### 6. Pack/archive security review

Review `.tcp-sp` as ZIP.

Specify protections for:

- ZIP Slip / path traversal
- absolute paths
- symlinks if relevant
- malformed/hostile JSON
- duplicate UUID/version entries
- partial extraction failures
- overwrite behavior
- import transactionality

### 7. C# provider feasibility

Recommend the lowest-complexity reliable way to implement C# semantic features in a VS Code extension.

Evaluate options such as:

- Roslyn process/service
- `dotnet` helper process
- language-server interaction where available
- lightweight parsing where safe

Consider:

- export detection
- referenced-symbol detection
- structure-aware insertion
- collision detection
- Dependency Bundle
- unused using removal

Avoid building an unnecessary compiler platform inside the extension.

### 8. Clean Copy v1 scope

Recommend a safe and useful v1 subset.

Separate transformations into:

- language-agnostic and safe
- C#-specific and safe
- risky/aggressive and better deferred

The implementation must never overwrite source files.

### 9. Implementation phases

Produce a phased plan, preferably something like:

- Phase 0: extension scaffold + test foundation
- Phase 1: metadata/storage/versioning/search
- Phase 2: Snippet/Pack UI + creation/edit/copy
- Phase 3: insertion + dependency handling
- Phase 4: import/export + conflicts
- Phase 5: Clean Copy
- Phase 6: C# provider / Dependency Bundle
- Phase 7: polish/release hardening

Adjust this structure if you have a better decomposition.

For each phase include:

- goals
- concrete files/modules
- tests
- acceptance criteria
- major risks

### 10. UX simplification review

The current specification is intentionally detailed, but normal use must stay simple.

Identify places where implementation complexity can remain internal while the UI stays minimal.

The primary product interaction must remain:

> find snippet → drag/insert → code appears

Avoid turning normal usage into a multi-step package-management workflow.

### 11. Deliverables for this pass

Return:

1. **GO / GO WITH NOTES / NO-GO** feasibility verdict
2. repository assessment
3. API feasibility findings
4. specification contradictions / required clarifications
5. proposed architecture
6. proposed v1 scope cuts, if any
7. phased implementation plan
8. security concerns
9. test strategy
10. explicit list of questions that truly require product-owner decisions

Keep the product-owner question list short. Do not ask about matters that can be resolved by sound engineering judgment.

Do not begin broad implementation until this review is complete.

