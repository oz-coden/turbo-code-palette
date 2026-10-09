# Public repository checks

Check both candidate content and the Git index before every commit/push. A `.gitignore` rule does not remove an already tracked file. If a personal file is tracked, remove it from the index with an explicit path while keeping the working file. Do not delete a user's actual data.

## Required review

```sh
git status --short --branch
git ls-files
git diff
npm run check-public -- --history
```

After staging the intended source/documentation/configuration changes:

```sh
git diff --cached --stat
git diff --cached
git diff --cached --check
npm run check-public -- --staged --history
```

The checked-in script scans working/index files and optionally all reachable commit versions for personal absolute paths, home-directory paths, private keys, common secret prefixes and credential assignments. It flags private/generated filenames even if those files are already tracked. Output contains only relative filenames, line numbers and categories, never suspected secret values. These are pattern checks, not proof that arbitrary secrets are absent; manual review of tracked files and diffs remains required.

Ignore rules cover dependencies, build/test/coverage output, private environment/configuration, OS scratch files, C# helper build output, temporary archives/staging and repository-local personal snippet storage. Necessary source, lockfile, deliberate fixtures, documentation and portable `.vscode` development files remain tracked. Do not add personal absolute paths to reports or settings.

The Phase 0 demo uses synthetic source constants and untitled documents. Test/runtime profiles are isolated under ignored `.vscode-test/`; it does not create Global or Workspace snippet data. Development profiles must not share personal settings, extensions or credentials.

Phase 2 tests create synthetic Pack/Snippet/staging/recovery data only in ignored `.vscode-test/` sandboxes. Native local roots reject links and hardlinks. Production URI writes use private staging rather than in-place source writes; providers without verified write support remain read-only. Runtime assets and relative recovery journals are not implementation fixtures to publish. Nested workspace `.snippets/` directories are ignored and rejected by the public file scan, while deliberate `src/test/fixtures/` remain publishable. Webview text and candidate labels are escaped/text-only, with a media-only resource root, CSP, nonce and validated session messages.

If a possible historical secret is found, stop publishing and report its location/category. Do not repeat the value in a report, rewrite history or force-push without user direction. Secret rotation and history cleanup require a separate decision.

Phase 3 insertion tests use native workspaces and output directories only below ignored `.vscode-test/`. The repository ignores/rejects `.tcp-insert-*` private staging directories. Runtime separate-files uses a new owned staging folder and exclusive files, verifies the tree, then publishes a new folder without overwriting existing content. It never deletes the destination on failure. Editor targets and insertion sources retain native identity checks; unverifiable URI libraries remain ineligible. No source markers, persisted code/provenance database, scripts, raw D&D payload or private workbench API is added.

At the start of Phase 0, both existing commits and the tracked working tree were inspected; no personal absolute paths or credential values were found. The portable IDE configurations use workspace variables. No tracked private file needed removal. Generated test/runtime files remain ignored.
