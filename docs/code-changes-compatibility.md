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

Android is a remote review/control surface. It displays the connected desktop workspace but does not independently select a filesystem path. Applying patches, verification, and commits remain desktop-controlled until equivalent mobile review gates are implemented.

## Deprecated behavior

Crash reporting is separate from Code Changes and no longer creates or opens a repair workflow automatically. Recovery/reload APIs remain registered for compatibility with old in-progress runs, but are not part of the primary Code Changes product flow.

Internal channel and table renaming should be handled as a separate migration only when all supported desktop and Android versions can be upgraded together.
