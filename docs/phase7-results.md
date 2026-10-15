# Phase 7 — Polish / Git / Release Preparation

Evidence date: 2026-10-16. Development version remains **0.0.1**. No Marketplace
publication, GitHub Release, tag or v1.0.0 promotion was performed.

## Implemented polish and fixes

- README and Quick Start introduce a language/use-neutral Snippet/Pack manager.
  Native sidebar order is Snippets, Packs, Clean Copy. C# export detection is shown
  only on relevant metadata forms; ordinary Clean Copy text does not force a policy.
- Insert Mode and Options are separate. Defaults are attribution `none`, identity
  markers OFF, preview OFF. Advanced Insert options and reusable settings expose
  `none` / `source-urls` / `full`, markers and preview. Existing mode chooser and all
  Insert entry points retain the same pipeline. Advanced options use the asset's
  default placement; global defaults also apply to the explicit mode chooser.
- Insert/Clean Copy share citation validation, exact deduplication, author/name/version
  details and safe comment generation. Repository/homepage never become citations.
  Known license notices are independent; generic headers label every notice line
  `TCP License:` so later syntax transforms can recognize them. HTML has a bounded
  safe comment renderer; unsupported syntax/selection context stops output.
  Notice deduplication is per complete text; repeated lines/paragraph order within
  a notice are retained (regression-tested for JavaScript, Python and HTML).
- Reused dependencies contribute the actual verified revision's citations, not a
  resolver-selected alternate revision's URL. Their recursive recorded origins and
  known original Pack notices are retained; referenced assets are revalidated.
- Clean Copy adding attribution requires explicit origin selection (multiple assets
  supported) or an explicit unlinked choice unless a physical library source proves
  the relationship. Markers/text hits alone do not establish origin. Escape is inert.
- Optional helper auto-discovery removes normal DLL-path setup. Missing/unusable
  helpers no longer block ordinary cursor text Insert or basic Clean Copy. Explicit
  semantic placement still fails closed. Status explains the existing .NET 10 runtime
  requirement and remedy; no runtime installation/download occurs automatically.
- An optional policy command accepts a contest start with timezone. Policy remains
  separate from presets; forced URL attribution is displayed and unknown transforms
  remain denied. No publication evidence service was added.
- Initial macOS CI exposed a Unicode collision fixture that assumed the filesystem
  could store NFC/NFD names independently. The test now exposes two distinct entries
  through the existing reader contract on every OS; both quarantine assertions stay
  intact. Production path/collision validation was not relaxed.
- macOS installed-smoke startup exposed Unix socket path limits in a deeply nested
  QA profile; non-Windows smoke profiles now use short temporary directories. A
  Windows form-to-editor Undo harness race now waits for focus to settle and the
  target's document-change event, still issuing exactly one Undo without retry.
- macOS found a real helper admission race: a client could receive a completed
  response before the worker Task's completion flag became visible, then receive
  `helper-busy` for its sequential successor. Response publication and slot release
  now share an admission semaphore, preserving cancellation and one active analysis.
  A 200-request sequential protocol regression covers the boundary on every CI OS.
- Added changelog, user guide, known issues, pending-license notice and bundled Roslyn
  notices. Package license stays UNLICENSED: MIT is the owner's preferred candidate,
  with final grant to be reconsidered before formal release.

## E2E coverage and actual GUI limits

**Host/API automation** exercises real VS Code documents, editors, panels, native
Diff tabs, filesystem and commands. It is not proof of physical mouse operations.

| Workflow | Evidence |
|---|---|
| JS / Python / HTML Selection capture → create → Pack → search → Insert/Undo → cross-scope copy → Export/Import → all Clean presets → revision | New cross-phase Host cases, general application fixtures |
| Metadata form edits, unknown fields, explicit revision, source Save → Reload and watcher Later | Existing Phase 2 Host + storage/unit cases |
| Recursive dependencies, SCC, templates, modes, stale inputs, conflict stop/Diff, cancellation | Phase 3/4 Host + unit cases; actual-revision citations added to compatible-version reuse test |
| C# structure-aware insertion, overload/collision, helper timeout/crash/cancel, Clean Copy and semantic Bundle | Phase 6 Host + Roslyn suites |
| Missing configured helper leaves ordinary C# operations usable | New Phase 7 Host case |
| AtCoder URL/license retention, failure without required assertions, unchanged output/state on failure | Policy unit + Roslyn + Phase 6 Host cases |
| Favorites/recent/usage, Global/Workspace logical locations, settings and native command registration | Phase 2/3/7 Host and library/unit cases |
| Installed VSIX, JS create/search/Insert, lazy packaged helper and real export analysis | Dedicated clean-profile installed-artifact smoke on both Windows VS Code versions |

**No new manual/Computer Use UI journey was completed.** The isolated QA windows
launched, but Computer Use `list_apps/list_windows` exposed only the pre-existing
VS Code window, never the target QA window, including after the visible-window retry.
No input was sent to the unrelated window. Computer Use was reset after inspection.
The dedicated GUI-profile processes were stopped after QA. One local Host rerun
with those windows alive showed focus-sensitive Undo failures; after stopping them,
the current Host suite passed all 80 cases. Host/installed/GUI runs must remain
sequential. This does not substitute for a human Undo/focus check.
Therefore real mouse, focus traversal, visual clarity, screen-reader output and
error-recovery interaction remain unverified. The synthetic QA launcher is retained
under scripts; all its generated data/profile/logs stay ignored.

Interaction review is static/Host-based: normal row Insert adds no option dialog;
Advanced options add two Quick Picks; creation uses destination/form/Save. Command
Palette exposes keyboard entry points, forms use labelled controls and status regions,
and advanced fields use native details elements. These are design checks, not measured
human usability/action counts or an accessibility certification.

## Tests and platforms

- Windows x64 local: unit/security **139**, Roslyn **28**; generated semantic Bundle
  compiles with dotnet and executes with output **42**. Type checking/lint pass.
- Minimum VS Code **1.134.0** and official current stable **1.142.0** run the Host
  suite (80 cases after the final dependency-attribution regression was added).
- Installed-artifact smoke uses a new user profile/extensions directory for each run.
  CLI installation is real; the test runner loads the installed extraction as its
  Development Host path, not repository source. This distinguishes it from testing
  only a development checkout. Packaged DLL auto-discovery/analysis succeeds.
- CI was expanded to Windows/Linux/macOS unit/Roslyn/Bundle checks and minimum/current
  Host + VSIX installation checks. Final remote job results are recorded below after
  completion; matrix configuration alone is not proof that a platform passed.
- Other architectures, Remote/WSL/container hosts, actual mouse and assistive technology
  are not claimed as verified.

Official current version checked against [VS Code 1.142 release notes](https://code.visualstudio.com/updates/v1_142).

## Helper distribution recommendation

**Recommend packaged framework-dependent, optional helper.** Ship its managed DLLs
with the extension, discover them automatically, and require an existing .NET 10
runtime only for advanced C# operations. Basic TCP starts without it. User installation
of a runtime is separate; TCP never downloads/installs .NET. Workspace trust is required.

| Option | Measured files/bytes | Setup / maintenance |
|---|---:|---|
| Phase 7 optimized framework-dependent | 5 / 9,974,070 | Portable managed code; existing runtime needed. No DLL-path input. Single helper payload for supported .NET OS/architectures. |
| Phase 6 framework-dependent baseline, translations/debug included | 33 / 16,826,489 | Historical comparison baseline |
| Phase 6 self-contained win-x64 baseline | 220 / 97,376,869 | No shared runtime needed; each OS/architecture needs a distinct package, runtime security updates and separate tests. Other self-contained RIDs unverified. |

The optimized self-contained configuration has not been rebuilt/measured here, so
the historical baseline is not presented as a same-options package-size comparison.
No self-contained runtime is included in the candidate VSIX. Satellite diagnostic
translations/apphost/PDBs are excluded; helper diagnostics are English.

Local representative timing (single machine; not a general SLA): cold framework
request **467.48 ms** (one sample), warm Snippet median **1.30 ms** / 20 requests,
500-type file median **57.20 ms** / 5, references **2.95 ms** / 5, Bundle Emit
**9.61 ms** / 5. Working set about **138–183 MB** during this run. The cached Phase 6
self-contained sample cold probe was **482.46 ms** (one sample). Lifetime/concurrency
limits and idle shutdown remain unchanged; no stale source cache was introduced.

## VSIX and repository security

Candidate VSIX contains 21 allowlisted files, approximately 3.51 MiB compressed.
Includes production JS, required media/schemas, guide/known issues, license status,
third-party notices and the five helper files. It excludes source/tests, Node packages,
logs, Global/Workspace data, build trees, PDBs, credentials and QA profiles.

The first packaging audit found a local build path in the helper's CodeView debug
record despite a non-debug publish request (incremental build reuse). Packaging now
forces Rebuild/Publish with no symbols and a portable PathMap; regenerated DLLs pass
the binary home-path scan. The audit also parses bundled JS strings/comments to
avoid mistaking minified conditional expressions for drive paths, with regression
tests that still catch actual escaped paths and secrets. ZIP names have a strict
allowlist, collision/type/size/count checks; text and DLL string scans supplement
manual file/diff review. Pattern checks are not a proof that no unknown secret exists.

Tracked files, working/staged diff and history are scanned before commit/push. No
history rewrite/force push is needed or performed. Generated binaries stay outside
Git, with lockfiles, fixtures and sources retained. No personal files were deleted.

## AtCoder policy guarantees and limits

The optional policy pins the [2026-10-14 official rule change](https://github.com/atcoder/rules/commit/61500f0afb842798a5ab626725350059540bec04).
It enforces known metadata assertions, source URL and notice retention, transform
allowlisting, conservative comment protection and fail-closed unknowns. Source URL,
TCP identity markers and licenses remain separate. Readable/Competitive/Custom under
policy none have no AtCoder-specific prerequisites. Publication timestamps remain
self-reported assertions; no independent publication proof, provenance completeness,
license completeness or submission eligibility is certified.

## Release decision / remaining gates

**Hold formal v1 release.** Local technical/package checks provide a development
candidate, not final release approval. Blocking gates are final license grant,
manual GUI/keyboard/accessibility QA and successful completion/review of the expanded
platform CI. Arm/remote support and runtime distribution variants need separately
scoped evidence if advertised. Existing known limits remain: new-folder files outside
editor Undo, no mixed transaction, standalone C# limits, review-only generic Bundle,
no D&D and no auto Save version bump. See [known issues](known-issues.md).

Large provenance evidence integrations, a dedicated Policy form and broader semantic
providers remain follow-up proposals rather than silently expanded Phase 7 scope.
