# Remote Edit Reframe: General Repo-Connected Code Editing

Status: COMPLETE

## Summary

`remoteEdit` should be restructured away from `self-heal` / `report bug` and turned into a general-purpose code editing feature for a connected workspace or git repo. The core value that remains valid is not "Nexy fixes itself," but "Nexy can investigate, propose, stage, review, apply, verify, and optionally commit code changes in a repo with a controlled workflow."

The current self-heal loop is product-confusing and operationally fragile because it assumes the app can reliably diagnose and repair itself from inside the same runtime. The new direction should make the feature explicitly about editing a selected codebase, locally or from Android, with repo-aware guidance and clear change-review steps.

## Product direction

### New intended use cases

1. Edit an existing repo connected to Nexy.
2. Initialize a new repo-backed coding workspace and make changes through Nexy.
3. Start a code change from chat or Android and route it into a structured patch workflow.
4. Review AI-generated diffs before they touch the workspace.
5. Verify, commit, and optionally push repo changes with clear git context.

### Flows to de-emphasize or remove

- `self-heal` as a primary concept
- `report bug` as an entrypoint into code editing
- "fix Nexy from inside Nexy" positioning
- app-crash remediation as the main mental model for the feature

### Recommended surface model

Rename the user-facing feature from `Remote Edit` to something repo- and workflow-oriented, such as:

- `Code Changes` (recommended)
- `Workspace Edits`
- `Repo Edit`

Recommended default: `Code Changes`

This surface should act as a repo-connected inbox/history plus guided edit workflow, not as a bug triage console.

## Core workflow to build

### Primary workflow

1. User connects a workspace/repo.
2. User starts a change request:
   - from chat
   - from Android
   - from the Code Changes screen
3. Nexy investigates the codebase if needed.
4. Nexy generates staged patches without touching the workspace.
5. User reviews per-file diffs.
6. User applies approved files to the workspace.
7. User runs verification steps.
8. User reviews git state and commits.
9. User optionally pushes.

### Workflow principles

- repo/workspace first, not app-self-repair first
- patch review before apply
- explicit current phase and next step
- one primary CTA per phase
- git visibility always available
- Android and desktop share the same mental model

## Implementation changes

### Phase 1: Reposition feature around connected workspace/repo

- Replace user-facing `Remote Edit` branding with `Code Changes`.
- Remove `Self-Heal` wording from desktop, Android, onboarding, dialogs, and notifications.
- Reword the feature as:
  - "Connect a repo and make guided code changes"
  - "Review staged patches before applying"
- Stop presenting bug reporting as a core companion feature for this workflow.

Action checklist:
- [x] Rename primary UI copy to `Code Changes`.
- [x] Remove user-facing `Self-Heal` terminology.
- [x] Rewrite onboarding/help copy around repo-connected editing.
- [x] Rewrite Android labels and subtitles to match.
- [x] Rewrite notifications and toasts to change-request language.

### Phase 2: Add explicit workspace/repo connection model

- Introduce a first-class connection state for the feature:
  - no workspace connected
  - workspace connected but not git-backed
  - git repo connected
- Reuse existing workspace and git inspection capabilities where possible.
- Add a Code Changes landing state that guides the user to:
  - connect existing repo
  - choose project workspace
  - create new coding workspace
- Make connection requirements explicit before change generation begins.

Recommended shared additions:
- `CodeChangesWorkspaceBinding`
- fields:
  - `rootDirectory`
  - `isGitRepo`
  - `repoRoot`
  - `branch`
  - `dirty`
  - `isConnected`
  - `lastValidatedAt`

Action checklist:
- [x] Define a shared workspace binding model for the feature.
- [x] Add desktop connection/selection UI.
- [x] Add Android read-only visibility for current connected workspace.
- [x] Validate workspace state before allowing change requests.
- [x] Show branch/dirty/repo status in the main feature header.

### Phase 3: Replace report-based model with change-request model

- Replace "error report" / "remote edit report" / "self-heal report" in the UI with a neutral request model:
  - `ChangeRequest`
- Request types should support:
  - `edit`
  - `refactor`
  - `bugfix`
  - `investigation`
- The old error-report capture pipeline should no longer be the primary backing model for new requests.
- Existing DB-backed report records can be migrated or adapted as legacy entries if needed.

Recommended shared type direction:
- `CodeChangeRequest`
- fields:
  - `id`
  - `title`
  - `description`
  - `requestType`
  - `workspaceRoot`
  - `projectId`
  - `origin`
  - `status`
  - `createdAt`
  - `updatedAt`

Recommended origin values:
- `chat`
- `android`
- `manual`
- `build-failure`
- `legacy-bug-report`

Action checklist:
- [x] Define neutral request type and origin model.
- [x] Route new entrypoints to change requests, not bug reports.
- [x] Mark old bug-report-backed items as legacy if retained.
- [x] Remove `report bug` as the primary creation path into this feature.
- [x] Update list/detail screens to operate on change requests.

### Phase 4: Simplify the editing workflow UI

- Replace raw state exposure with a guided phase model:
  - `Draft`
  - `Investigating`
  - `Patch ready`
  - `Ready to apply`
  - `Applied`
  - `Verifying`
  - `Ready to commit`
  - `Committed`
  - `Needs attention`
- Each phase gets:
  - phase label
  - one-line explanation
  - primary CTA
  - blocked reason if applicable
- The detail screen should separate:
  - request summary
  - current phase
  - staged files/diffs
  - verification
  - git actions
  - advanced logs

Action checklist:
- [x] Add derived presentation-phase mapper.
- [x] Update desktop request list badges.
- [x] Update Android request list badges.
- [x] Redesign detail header around next-step guidance.
- [x] Collapse advanced logs by default.

### Phase 5: Make chat the default creation surface

- Users should mostly start in chat, not in the Code Changes panel.
- Add a clear chat action such as:
  - `Create code change`
  - `Turn into patch request`
- Android chat should keep the same action.
- The Code Changes screen becomes the place to review, continue, and inspect request history.

Recommended behavior:
- from chat message or typed prompt, prefill request title/description
- carry current project/workspace context into the request
- deep-link directly into the created request after submission

Action checklist:
- [x] Add chat action on desktop.
- [x] Keep/improve Android prefill flow from chat.
- [x] Ensure newly created requests auto-open.
- [x] Make the Code Changes screen history/review-first.
- [x] Remove wording that suggests users should start from a bug-report modal.

### Phase 6: Repo-aware patch and git experience

- Keep the existing strengths:
  - stage before apply
  - per-file diffs
  - verification
  - commit/push guidance
- Improve framing:
  - "staged patch" instead of "fix staging"
  - "apply selected changes" instead of "commit to workspace"
- Add stronger repo guidance:
  - clean/dirty warnings
  - detached HEAD warning
  - non-repo fallback behavior
  - auth guidance for push failures

Action checklist:
- [x] Rename patch/apply copy to neutral editing language.
- [x] Show repo state prominently in review/apply screens.
- [x] Explain exactly what `apply` does.
- [x] Keep commit/push actions gated by verification when configured.
- [x] Improve push/auth help messages.

### Phase 7: Deprecate or isolate bug-report/self-heal features

- Remove `Report bug -> Remote Edit` as the main feature story.
- Decide one of these two approaches:
  - recommended: deprecate the bug-report-to-edit flow for normal users
  - fallback: move it into a developer-only diagnostics area as legacy tooling
- Crash handling should be separated from general code editing.
- If crash reporting remains, it should create diagnostics artifacts, not drive the main code-edit workflow by default.

Action checklist:
- [x] Remove prominent sidebar/flow coupling between bug reporting and code changes.
- [x] Move legacy crash-remediation hooks into developer-only or hidden flows if retained.
- [x] Remove self-heal language from crash and delete dialogs.
- [x] Prevent new roadmap work from assuming app-self-repair as the core loop.
- [x] Document legacy compatibility behavior.

## Public/interfaces/types

### New or revised shared types

- `CodeChangesWorkspaceBinding`
- `CodeChangeRequest`
- `CodeChangeRequestType = 'edit' | 'refactor' | 'bugfix' | 'investigation'`
- `CodeChangeRequestOrigin = 'chat' | 'android' | 'manual' | 'build-failure' | 'legacy-bug-report'`
- derived UI phase type for the feature

### Compatibility strategy

- Keep existing IPC/WS plumbing where possible in v1.
- Prefer UI/type adaptation over immediate mass renaming of internal `remote-edit` channels.
- Legacy `error_reports` rows can be adapted into `legacy-bug-report` requests until a deeper migration is done.

## Test plan

- Main/process tests:
  - workspace binding validation for repo and non-repo directories
  - request creation from chat/build/manual origins
  - legacy bug-report rows still load safely if compatibility is kept
  - existing patch/diff/apply/verification/git flow still functions under the new request model
- Renderer tests:
  - landing state for disconnected workspace
  - connected repo header shows branch/dirty state
  - list/detail screens use neutral request language
  - one primary CTA per phase
  - chat can create a code change request
- Android tests:
  - request list/detail use the same phase model
  - chat prefill still works
  - repo/workspace state is visible and understandable
- Regression tests:
  - diff review still works
  - apply-to-workspace still works
  - verification still works
  - git commit/push still works
  - build-failure-origin requests still work if retained

## Before marking any key change complete

- [x] Write tests.
- [x] Run eslint checks.
- [x] Run typechecks.
- [x] Run build test.

## Implementation status

Implemented using a compatibility-focused migration. New requests persist neutral type, origin, workspace, and project metadata on `error_reports`; existing `remote-edit:*` IPC and legacy Android WebSocket channel names remain internal plumbing. Compatibility behavior is documented in `docs/code-changes-compatibility.md`.

Verification on 2026-06-30:

- Desktop: 1,120 tests passed.
- ESLint: completed with no errors and 46 pre-existing warnings.
- TypeScript: passed.
- Electron production build: passed.
- Android: production Kotlin compilation passed. The broader unit suite previously ran 81 of 88 tests successfully; seven existing `ChatViewModelTest` state/timing tests remain unrelated to the modified Code Changes screens.

## Assumptions

- Target roadmap file: `roadmap/roadmap-new/CODE_CHANGES_REFRAME_ROADMAP.md`
- The first pass prioritizes product-model correction and workflow clarity over internal channel renaming.
- Existing `remote-edit` internals are retained initially as implementation plumbing.
- Android remains a remote control/review surface over the desktop workspace, not an independent code editor.
- Full git clone/init flows can be added incrementally; v1 can start with selecting an existing workspace/repo and supporting new repo initialization only if the repo already has the necessary project files.
