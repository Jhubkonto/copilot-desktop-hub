# Code Changes Compatibility

## Current architecture

`Code Changes` is the user-facing product model. The first migration keeps the established remote-edit implementation as internal plumbing:

- SQLite records remain in `error_reports`.
- Desktop IPC channels remain under `error-report:*` and `remote-edit:*`.
- Android WebSocket commands remain under `error-report:*` and `self-heal:*`.
- Staging, diff, verification, git, and history tables retain their existing names.

These identifiers are implementation details and must not be used as user-facing labels.

## Request metadata

New records persist neutral metadata directly on `error_reports`:

- `request_type`: `edit`, `refactor`, `bugfix`, or `investigation`
- `request_origin`: `chat`, `android`, `manual`, `build-failure`, or `legacy-bug-report`
- `workspace_root`: workspace targeted when the request was created
- `project_id`: optional originating Nexy project

Rows created before migration 46 have null metadata. The shared compatibility adapter presents those rows as:

- type: `edit`
- origin: `legacy-bug-report`
- workspace: current connected workspace when no stored workspace is available

No destructive data migration is required, and existing request IDs continue to work with investigation, staged patch, verification, and git operations.

## Safety boundary

The backend still executes against the current desktop `build_workspace_path`. The stored `workspace_root` is provenance, not authorization to edit a historical path. The Code Changes UI therefore shows and validates the current connected workspace before allowing new requests.

Android is a remote review/control surface. It displays the connected desktop workspace but does not independently select a filesystem path — all filesystem access happens on the desktop, driven by commands received over the WS protocol.

**Update:** the earlier assumption that Android remains view-only for apply/verify/commit is superseded. Android now supports the full Code Changes lifecycle end-to-end: create, investigate, review a staged patch, delete, apply to workspace, run verification, push, and trigger recovery/rollback. What's still desktop-only:

- Workspace/repo selection (the folder picker that binds `build_workspace_path`).
- Investigation/patch backend settings UI (model/backend/retry-limit configuration for the investigator).
- Git prepare/commit UI (Android can push an already-committed change via `self-heal:git-push`, but composing and creating the commit itself is desktop-only in this pass).
- Anything else requiring direct local filesystem access outside the WS protocol.

### New WS commands

Two commands were added to the existing `self-heal:*` namespace so Android can reach parity without introducing a new namespace:

- `self-heal:delete-report` — deletes a change request (mirrors the existing `error-report:delete` IPC handler's `deleteErrorReport()`). Broadcasts `self-heal:report-deleted` with `{ reportId, deleted, error? }` — success/failure is always unambiguous, never inferred from a falsy value.
- `self-heal:apply-staged-patch` — applies the staged patch to the connected workspace (mirrors the existing `remote-edit:commit-to-workspace` IPC handler; both now call a shared `applyStagedPatchToWorkspace()` function in `remote-edit-handlers.ts` to avoid duplicated apply logic). Replies with `self-heal:apply-result` carrying `{ reportId, appliedFiles, backupPaths }` on success or `{ reportId, error }` on failure.

All other commands Android needs (`self-heal:start-verification`, `self-heal:git-push`, `self-heal:get-recovery-runs`, `self-heal:start-reload`, `self-heal:approve-relaunch`, `self-heal:request-rollback`) already existed server-side before this work — only Android's client-side plumbing (WsEvent types, WsRepository functions, ViewModel state, UI) was missing.

### Shared phase model

`CodeChangeRequestPhase` / `CODE_CHANGE_PHASE_LABELS` / `CODE_CHANGE_PHASE_GUIDANCE` / `deriveCodeChangePhase()` (`src/shared/code-changes.ts`) are ported field-for-field to Kotlin in `android/app/src/main/java/io/nexy/android/data/model/CodeChangePhase.kt`, replacing an earlier ad hoc `presentationPhase()` function that lived in `RemoteEditReportsScreen.kt` and didn't take verification/commit state into account. A JUnit fixture test (`CodeChangePhaseFixtureTest`) guards against the two implementations drifting apart — update both together when the phase-derivation logic changes.

### Navigation

Code Changes moved from Android's Settings → Developer section to a dedicated top-app-bar icon on the Home screen (`onOpenCodeChanges`, next to the Artifacts icon), matching the prominence of desktop's sidebar entry. The Settings entry was removed entirely — there is exactly one canonical entry point now. The chat-prefill deep link (`remote-edit/start?prefill=...`) is unaffected since it navigates directly to the route.

## Deprecated behavior

Crash reporting is separate from Code Changes and no longer creates or opens a repair workflow automatically. Recovery/reload APIs remain registered for compatibility with old in-progress runs, but are not part of the primary Code Changes product flow.

Internal channel and table renaming should be handled as a separate migration only when all supported desktop and Android versions can be upgraded together.
