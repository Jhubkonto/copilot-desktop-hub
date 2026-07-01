# Code Changes Overhaul: Delete Fix, Desktop Workflow Redesign, and Android Parity

## Context

The "Code Changes" feature (DB table `error_reports`, internal `remote-edit:*`/`self-heal:*` plumbing, user-facing `CodeChangeRequest` concept) lets an AI agent investigate a repo, stage patches, let the user review diffs, apply them, verify, and commit/push — all under a phase model (Draft → Investigating → Patch ready → Ready to apply → Applied → Verifying → Ready to commit → Committed → Needs attention) introduced by a prior roadmap (`roadmap/roadmap-archive/CODE_CHANGES_REFRAME_ROADMAP--COMPLETE.md`).

Three problems currently block this feature from being usable end-to-end:

1. **Delete is broken on desktop.** The confirmation dialog appears, but clicking "Delete request" does nothing visible — no error, no success, the row often reappears.
2. **The desktop UI is clunky.** `RemoteEditPanel.tsx` is a single 1591-line modal mixing workspace connection, request creation, list, and a dense multi-purpose detail pane (investigation, diffs, verification, git, recovery, history all inline) behind ~30 flat `useState` hooks. There's no clear "what do I do next" signal despite a phase model already existing in `src/shared/code-changes.ts`.
3. **Android is far behind desktop.** It can only create a request, run investigation, and view a generated patch — it explicitly tells the user to "use Nexy desktop" to apply, verify, or commit. There is no delete button at all, and delete was never even wired into the WebSocket protocol Android uses (it only ever existed as an Electron-only IPC handler).
4. **Android's navigation placement undersells the feature.** Code Changes is currently reachable only via Home → Settings → Developer → Code Changes (`SettingsScreen.kt:108-129`, subtitle literally reads "Settings › Developer"), framed alongside Build Dashboard/Diagnostics/Debug Log as developer tooling. Desktop treats the same feature as a first-class sidebar button with a badge count (`src/renderer/components/Sidebar.tsx:152-204`). Comparable Android features — Artifacts, Skills, Scheduled — are surfaced via the top app bar or its overflow menu (`HomeScreen.kt:433-455`), not buried in Settings.

This roadmap fixes the delete bug at its verified root cause, restructures the desktop panel into a clearer phase-driven workflow, brings Android to full functional parity (delete, apply, verify, commit, push, recovery/rollback), and relocates Android's entry point to match the feature's new prominence — reversing the prior roadmap's closing assumption that Android should remain view-only.

## Confirmed root cause of the delete bug

Traced and verified directly in the code (not speculative):

- `src/main/safe-handle.ts:32-39` — `safeHandle()` wraps every IPC handler in try/catch. On a thrown error it **resolves** (not rejects) the invoke call with `{ error: string }`.
- `src/preload/index.ts:54-56` — `typedInvoke()` does a raw type-cast (`ipcRenderer.invoke(...) as Promise<IpcReturn<C>>`) with **no runtime check** for that `{ error }` shape.
- `src/renderer/components/RemoteEditPanel.tsx:1080-1106` (`handleDeleteReport`) does `const deleted = await window.api.deleteErrorReport(reportId); if (!deleted) { ... }`. If the main process throws, the renderer receives `{ error: '...' }` — a **truthy object** — so `!deleted` is `false` and execution falls into the "success" branch: closes the dialog, clears local state, calls `loadReports()`. If the delete didn't actually happen, the row can reappear with zero user-visible error.
- Compounding this: `handleDeleteReport` never calls `addToast` on success or failure (unlike `handleReviewInvestigation`, which does). The only feedback is `investigationStatus` text that's easy to miss or get overwritten — so even a *successful* delete can look like "nothing happened."
- Not a foreign-key issue: `PRAGMA foreign_keys = ON` is set, but no `remote_edit_*` table declares a `REFERENCES error_reports(...)` constraint.
- An existing isolated test (`src/main/__tests__/error-report-handlers.test.ts:121-162`) proves `deleteErrorReport()`'s transaction logic is sound in a clean fixture — confirming the bug is in the renderer's truthy-object handling / lack of feedback, not the deletion logic itself.

## Phase 1: Fix the desktop delete bug (and its bug class)

- [ ] Reproduce manually in dev build: create a throwaway request, delete it, confirm, observe actual behavior and any console/IPC output.
- [ ] Fix `typedInvoke` in `src/preload/index.ts` to detect the `{ error: string }` shape returned by `safeHandle` and throw, so renderer `try/catch` blocks actually catch main-process failures instead of receiving a truthy object. Apply this generically — it's a systemic bug affecting any `safeHandle`-wrapped call checked via truthiness, not just delete.
- [ ] Update `handleDeleteReport` (and audit sibling handlers in `RemoteEditPanel.tsx` for the same truthiness-check pattern) to rely on the fixed `typedInvoke` throwing on failure.
- [ ] Add explicit `addToast` calls to `handleDeleteReport`: success ("Change request deleted") and failure (real error message), matching the existing pattern in `handleReviewInvestigation` (`RemoteEditPanel.tsx:1069`/`:1074`).
- [ ] Check whether `DeleteRemoteEditReportDialog`'s nested `ModalShell` (stacked inside the parent panel's `ModalShell`) contributes to any focus/escape/backdrop-click misdirection; fix if so.
- [ ] Add a main-process test asserting `error-report:delete` returns the `{ error }` shape (not a bare boolean) when `deleteErrorReport` throws.
- [ ] Add a renderer test: open delete confirmation, click "Delete request," assert row removal + success toast on success, and error toast + row retained on a mocked failure.
- [ ] Manually re-verify the original repro is fixed end-to-end.

## Phase 2: Redesign the desktop Code Changes workflow UI

Split the single 1591-line modal into focused views sharing one phase-driven mental model, built on the existing `CODE_CHANGE_PHASE_ORDER` / `CODE_CHANGE_PHASE_LABELS` / `CODE_CHANGE_PHASE_GUIDANCE` / `deriveCodeChangePhase` helpers in `src/shared/code-changes.ts` — do not invent new phase concepts.

- **List view** (default): all requests with compact phase badges, filter/search, prominent "New request" entry, and row-level quick actions (open, delete) so delete no longer requires opening detail first.
- **Detail/review view**: one request at a time. Phase bar at top, **one clearly primary next-action button** driven by `CODE_CHANGE_PHASE_GUIDANCE[phase]` (e.g. "Run investigation," "Review & apply patch," "Run verification," "Commit & push").
- **Progressive disclosure**: investigation transcript, verification run history, git details, recovery/rollback history collapse into secondary sections by default (extend the existing `investigationCollapsed`/`historyCollapsed` pattern consistently instead of ad hoc per-section).
- **Workspace connection banner** becomes a persistent compact header shared by both views instead of being embedded mid-flow.
- **Component decomposition**: extract `CodeChangeListView`, `CodeChangeDetailView`, `CodeChangeInvestigationSection`, `CodeChangeVerificationSection`, `CodeChangeGitSection`, `CodeChangeRecoverySection`, each owning local state instead of ~30 flat `useState` hooks in one file. Keep `RemoteEditDiffViewer` (already reasonably self-contained, `RemoteEditPanel.tsx:77-260`) as the diff-review sub-component. Keep the file/component named `RemoteEditPanel.tsx` for now — do not rename to `CodeChangesPanel.tsx` as part of this change (avoids a broad low-value import churn).
- End-to-end ordering made explicit in the UI: **create → investigate → review diff → apply → verify → commit → push**, with delete available as a destructive action at any phase from both list and detail views.

Action checklist:
- [ ] Inventory all state/handlers in `RemoteEditPanel.tsx` and map each to its target view/section.
- [ ] Extract `CodeChangeListView` (list, phase badges, filter/search, new-request entry, row quick actions incl. delete).
- [ ] Extract `CodeChangeDetailView` shell (phase bar, primary CTA, section tabs/accordions).
- [ ] Extract `CodeChangeInvestigationSection`, `CodeChangeVerificationSection`, `CodeChangeGitSection`, `CodeChangeRecoverySection`, preserving existing handlers/behavior but relocating state locally.
- [ ] Wire `RemoteEditDiffViewer` into the detail view's "Diff Review" section.
- [ ] Make "new request" creation its own explicit step/view, not inline in the list.
- [ ] Verify no regression: chat-based creation entrypoint, workspace binding banner, investigation streaming, diff staging/review, apply-to-workspace, verification display, git prepare/commit/push, recovery/rollback/history.
- [ ] Add/update renderer tests: list view phase badges, row click opens detail, primary action button matches `deriveCodeChangePhase` output per phase, progressive-disclosure expand/collapse.
- [ ] Manual pass confirming meaningfully less clutter and a clear single next action per phase.

## Phase 3: Extend the WS protocol for Android parity (desktop-side)

- [ ] Add `self-heal:delete-report` WS handler in `src/main/ws-handlers.ts`, calling the existing `deleteErrorReport()` from `error-report-handlers.ts` (no duplicated logic). Reply with an event (e.g. `self-heal:report-deleted`) carrying `{ reportId, deleted: boolean, error?: string }`, broadcast via `broadcastToMobile(...)` matching other `self-heal:*` handlers. Apply the same lesson as Phase 1: encode success/failure unambiguously.
- [ ] Add a `self-heal:commit-to-workspace` WS handler mirroring the Electron IPC handler `remote-edit:commit-to-workspace` (`remote-edit-handlers.ts:175`) so Android can trigger apply-to-workspace. Reply shape matches the existing IPC return (`{ appliedFiles: string[], backupPaths: string[] } | null`).
- [ ] Confirm (already verified present, no action needed beyond confirming) that `self-heal:start-verification`, `self-heal:git-push`, `self-heal:request-rollback`, `self-heal:start-reload`, `self-heal:approve-relaunch`, `self-heal:get-recovery-runs` already work over WS — only Android's UI/repository/viewmodel layer is missing for these (Phase 6).
- [ ] Add any new shared TypeScript payload types alongside existing `CodeChangeRequest`/`RemoteEditVerificationRun` types in `src/shared/types.ts` if needed for the new WS payloads.
- [ ] Add main-process tests for the two new WS handlers (success/failure/not-found cases, correct event shape, broadcast called).

## Phase 4: Android — delete support end-to-end

- [ ] Add `WsEvent.RemoteEditReportDeleted(reportId: String, deleted: Boolean, error: String?)` to `WsEvent.kt`, following the existing `ProjectDeleted`/`AgentDeleted`/`SkillDeleted` sibling pattern.
- [ ] Wire the new event into WS message parsing/dispatch.
- [ ] Add `fun deleteRemoteEditReport(reportId: String)` to `WsRepository.kt`, following the existing `self-heal:*` command pattern.
- [ ] Add a `deleteReport(reportId: String)` action to `RemoteEditViewModel.kt`, handling `RemoteEditReportDeleted` to update state and expose a transient success/error signal.
- [ ] Add delete UI using the existing `NexyConfirmDialog` component (`ui/components/NexyUx.kt`), matching the pattern already used in `SkillsScreen.kt` (`destructive = true`) — not a new bespoke dialog. Add delete from `RemoteEditReportDetailScreen.kt`, and a row-level delete affordance in `RemoteEditReportsScreen.kt` (check `ScheduledScreen.kt`/`SkillsScreen.kt` row-action patterns at implementation time and match whichever fits the current row layout best).
- [ ] Show a snackbar/toast on delete success and failure — don't repeat the silent-failure mode on Android either.
- [ ] Add JUnit tests for the ViewModel delete action (list updates on event, error surfaces on failure).
- [ ] Add/extend an instrumented Compose UI test for the delete confirm flow.

## Phase 5: Android — apply-to-workspace support

- [ ] Add `fun applyStagedPatch(reportId: String)` to `WsRepository.kt`, calling the new `self-heal:commit-to-workspace` WS command.
- [ ] Add `WsEvent.RemoteEditApplyResult(reportId, appliedFiles, backupPaths, error)` and wire into dispatch.
- [ ] Add `applyPatch(reportId: String)` action + apply state (`isApplying`, last result) to `RemoteEditViewModel.kt`.
- [ ] Update `RemoteEditReportDetailScreen.kt`: replace "use Nexy desktop to apply the patch..." messaging with a real "Apply patch" button, gated by phase (same `patch-ready`/`ready-to-apply` gating desktop uses — see Phase 7 for the shared phase model). Keep explanatory copy only for whatever remains genuinely desktop-only.
- [ ] Show apply progress/result in the detail screen, consistent with how investigation/fix progress renders today.
- [ ] Add JUnit tests for the new ViewModel action/event handling.
- [ ] Add/extend instrumented UI test: tap apply, assert loading then success/failure state.

## Phase 6: Android — verification and git push/recovery UI

- [ ] Wire the already-defined `WsEvent.RemoteEditVerificationEvent`/`RemoteEditVerificationDone` into `RemoteEditViewModel.kt` (`verificationRuns`/`verificationRunning` state, mirroring desktop) — currently defined but not consumed by any screen.
- [ ] Add `fun startVerification(reportId: String)` to `WsRepository.kt` (WS command already exists server-side).
- [ ] Add a "Run verification" button + results display (step list, pass/fail) to `RemoteEditReportDetailScreen.kt`, positioned after apply in the flow.
- [ ] Add `fun pushRemoteEditFix(reportId: String)` calling the existing `self-heal:git-push` WS command; add a "Push" button/state to the detail screen's git section (after commit).
- [ ] Wire `WsEvent.RemoteEditRecoveryEvent` into the ViewModel; add a recovery/rollback status section to the detail screen, including a **trigger** action (not just view) for `self-heal:request-rollback`, gated behind a destructive `NexyConfirmDialog` matching the Phase 4 delete pattern.
- [ ] Add JUnit tests for verification/git-push/recovery state handling.
- [ ] Add/extend instrumented UI tests for verification trigger+display and git push trigger+display.

## Phase 7: Shared phase model on Android

- [ ] Port `CodeChangeRequestPhase`, `CODE_CHANGE_PHASE_LABELS`, `CODE_CHANGE_PHASE_GUIDANCE`, and `deriveCodeChangePhase` from `src/shared/code-changes.ts` to Kotlin (e.g. `android/.../data/model/CodeChangePhase.kt`), keeping field-for-field parity so both platforms derive the same phase from the same report fields.
- [ ] Update `RemoteEditReportsScreen.kt` to show phase badges (not just raw status) using the ported logic.
- [ ] Update `RemoteEditReportDetailScreen.kt` to show a phase progress indicator and derive its primary CTA the same way the desktop redesign (Phase 2) does.
- [ ] Add a unit test asserting the ported phase derivation matches representative TypeScript fixtures, to guard against future drift.

## Phase 8: Android — relocate Code Changes out of Settings > Developer

Confirmed with the user: the feature moves to a dedicated top app bar icon (matching Artifacts' treatment — the most prominent existing precedent, closer to desktop's sidebar-button prominence than the Skills/Scheduled overflow-menu tier), and the old Settings > Developer entry is removed rather than kept as a secondary shortcut, so there is exactly one canonical entry point.

- [ ] Add a dedicated icon button for Code Changes in the top app bar in `HomeScreen.kt`, alongside the existing `onOpenArtifacts` icon button (`HomeScreen.kt:433-434`), following the same `IconButton`/`Icon` pattern. Pick an icon distinct from Artifacts' `Icons.Default.Inventory2` (e.g. something wrench/diff/patch-oriented, consistent with the wrench icon already used for Skills in the overflow menu).
- [ ] Add an `onOpenRemoteEdit: () -> Unit` (or rename to `onOpenCodeChanges` for clarity — confirm naming consistency with whatever Phase 7's shared phase model settles on) parameter to `HomeScreen`'s composable signature, wired the same way `onOpenArtifacts`/`onOpenSkills`/`onOpenScheduled` already are.
- [ ] Update `NavGraph.kt` (`android/app/src/main/java/io/nexy/android/navigation/NavGraph.kt:494-524`) call site that wires `HomeScreen` to pass the new top-app-bar callback into the existing `"remote-edit"` route navigation (no route/destination changes needed — only the entry point changes).
- [ ] Remove the "Code Changes" entry from the Developer section in `SettingsScreen.kt:108-129`, and remove the `onOpenRemoteEdit` callback from `SettingsScreen`'s parameters/call sites now that Settings no longer links to it.
- [ ] Update `RemoteEditReportsScreen.kt:79`'s top bar subtitle (currently `"Settings › Developer"`) to reflect the new entry point, or remove the subtitle if it no longer adds useful wayfinding context now that the feature isn't nested under Settings.
- [ ] Confirm the chat-prefill deep link (`"remote-edit/start?prefill={prefill}"`) continues to work unchanged — it navigates directly to the route and doesn't depend on the Settings entry point.
- [ ] Add/update a badge or unread-count indicator on the new top app bar icon if feasible within this phase, mirroring desktop's badge count on its Code Changes sidebar button (`Sidebar.tsx:201`) — stretch goal, not blocking if it requires new state plumbing beyond what already exists in `RemoteEditViewModel`.
- [ ] Manual pass: confirm Code Changes is reachable in exactly one tap from the top app bar, Settings no longer references it, and the chat-prefill flow still lands on the right screen.

## Phase 9: Documentation

- [ ] Update `docs/code-changes-compatibility.md` to note the new WS commands and that Android now supports the full lifecycle.
- [ ] Record that the prior roadmap's "Android remains view-only" assumption is superseded, with a short explicit "what's still desktop-only" list: workspace/repo selection (folder picker), investigation/patch backend settings UI, anything requiring direct local filesystem access outside the WS protocol.
- [ ] Keep new WS command names in the existing `self-heal:*` namespace for internal consistency (no renaming to e.g. `code-changes:*`).
- [ ] Note the navigation relocation (Phase 8) in the same doc so future readers don't rediscover "why isn't this under Settings anymore" from scratch.

## Test Plan

- **Desktop main-process (Vitest)**: `error-report:delete` returns `{ error }` shape on failure; existing delete round-trip test continues passing; new `self-heal:delete-report` and `self-heal:commit-to-workspace` WS handlers tested for success/failure/not-found + broadcast; existing investigation/fix/verification/git/recovery tests remain green through the Phase 2 refactor.
- **Desktop renderer (Vitest + Testing Library)**: delete confirm flow (success and failure paths with toasts); list view phase badges; detail view primary CTA per phase; progressive-disclosure sections; existing diff/apply/verification/git renderer tests pass after extraction.
- **Android unit (JUnit)**: ViewModel delete/apply/verify/push/recovery actions and event handling; ported phase-derivation matches TS fixtures.
- **Android instrumented/Compose**: delete flow via `NexyConfirmDialog`; apply flow loading→result; verification trigger+results; git push trigger+result; rollback confirm+trigger; phase badge/progress rendering; top app bar icon navigates to the Code Changes list in one tap; Settings no longer shows a Code Changes entry.
- **Manual (both platforms)**: reproduce and confirm-fixed the original delete bug including toast; walk the full desktop create→investigate→review→apply→verify→commit→push flow in the redesigned UI; walk the same full flow on Android against a paired desktop instance; cross-platform continuity (start on one platform, continue on the other, phase state stays consistent); confirm Android's new top app bar entry point and the removed Settings entry.

## Assumptions

- New WS/IPC channel names stay in the existing `remote-edit:*`/`self-heal:*` namespaces (internal plumbing, per prior roadmap's convention) — no renaming.
- `RemoteEditPanel.tsx` keeps its current name through the Phase 2 decomposition.
- The `typedInvoke` fix is generic (protects all IPC calls), per user confirmation.
- Android reaches full functional parity (delete, apply, verify, push), per user confirmation.
- Android can trigger rollback (not just view it), behind a destructive confirmation, per user confirmation.
- `error_reports` is not migrated to a true `CodeChangeRequest`-backed table in this roadmap — only the existing phase-derivation logic is reused/ported, not a schema change.
- Toast/snackbar mechanisms already exist on both platforms and just need consistent invocation — no new notification infrastructure.
- Android's Code Changes entry point moves to a dedicated top app bar icon (matching Artifacts' prominence tier), and the Settings > Developer entry is removed entirely rather than kept as a secondary shortcut, per user confirmation. A badge/unread-count indicator on the new icon is a stretch goal within Phase 8, not a blocking requirement.
