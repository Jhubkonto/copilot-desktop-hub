# Code Changes: Ground-Up Rewrite to a Linear 6-Step Flow (Chat-Hosted, Multi-Repo, Android-First)

## Context

The "Code Changes" feature (user-facing name; internal names `remote-edit`/`self-heal`/`error_reports`) lets a user describe a repo change, have an AI plan it, generate a patch, apply it, verify it, and commit it. It currently requires **11-13+ sequential decision points** on the happy path across both desktop and Android — creating a request, configuring a workspace externally, configuring planning settings, planning, an accept/reject/revise branch, patch generation, a per-file "mark reviewed" gate, applying, verifying, another revise branch, checking git status, writing a commit message, committing, and pushing — each with its own button, several with overlapping near-synonymous verbs ("Revise plan" vs "Revise patch" vs "Regenerate patch" vs "Accept anyway"). This grew from an original "self-heal" (app-repairs-itself) feature, through a "reframe" to general repo editing, through an "overhaul" that brought Android to parity — three product pivots layered on the same `error_reports` table, which is now reconciling **four independently-updated signals** (`status`, `fix_status`, a separately-looked-up verification-run status, and a separately-looked-up `committed` boolean) through an if-chain (`deriveCodeChangePhase()`) just to answer "what phase is this request in." That reconciliation complexity is a confirmed root cause of at least one real cross-platform bug (Android's Kotlin port was missing one branch of the if-chain, causing a wrong phase to display after a failed plan).

The user wants a ground-up rewrite: a strictly **linear 6-step flow** —
1. View/select the project workspace
2. Describe the desired change in natural language
3. Verify the AI's interpretation/plan is accurate
4. Execute the change
5. Verify the change was executed correctly
6. Final review

Four design decisions were confirmed with the user before this plan was written:
- **Step 1 is a real, always-visible entry screen** (not today's invisible external prerequisite).
- **Step 6 auto-commits** with an LLM-generated message; review is read-only. Push remains a manual, optional action within step 6.
- **Revise is a single loop-back to step 3** from any failure (bad plan, failed execution, failed verification) — no per-step-local retry verbs.
- **Data-model cleanup is in scope now**: collapse the 4-way reconciliation into one owned `step` value.

Also confirmed as explicitly **outside** the 6-step linear path (persistent actions, not steps): Delete (available any time), Undo/rollback (escape hatch after step 4), planning settings like backend/model/retry-limit (move behind an "Advanced" disclosure, must never block the default path), and "rejected" as a distinct persisted dead-end (folds into "didn't proceed, revise instead").

**Four further decisions were confirmed in a second round, materially reshaping the presentation and scope:**
- **Code Changes is presented as a dedicated, project-scoped chat conversation** — starting the feature creates a brand-new conversation (its own `conversation_id`), and that conversation's entire transcript IS the 6-step wizard (steps render as the chat's content/state, not a separate modal/pane). The user's other chats are untouched.
- **A project's workspace can contain multiple repos.** A single Code Changes request still targets **one repo at a time** — step 1 includes picking which repo, of potentially several under the workspace root. A user wanting to change two repos creates two separate requests (which can run in parallel, each with its own chat/conversation).
- **File browsing and the VS-Code-style "source control" change overview are folded into existing steps**, not a new top-level step: step 1 gains a file-tree browser for the selected repo; steps 4 and 6 gain a change list (files changed, additions/deletions highlighted) replacing today's flatter diff viewer.
- **Android is the primary target; desktop gets the same chat-hijack presentation for parity** — both platforms create a dedicated project-scoped conversation as the Code Changes surface, but Android is where design effort is front-loaded and where "done" is judged first.

## Implementation Status

**Overall Progress**: 2 / 4 phases complete. Backend foundation solid; UI layers pending.

### PHASE 1: Schema ✅ COMPLETE

**Migration 72** successfully adds:
- `step` column (TEXT, 6 values: `describe`, `plan-review`, `executing`, `verifying`, `final-review`, `attention`)
- `repo_relative_path` column (TEXT, supports multi-repo workspace targeting)
- `code_change_plan_revisions` table (stores revision snapshots across step 3 loop-backs)

Fixed `initializeBaseSchema()` to include all columns from migrations 47-72, ensuring fresh-install and incremental-migration schemas match.

**Database tests: 14/14 passing** ✅

#### What This Replaces

**Old Model**: 9-phase derived state via `deriveCodeChangePhase()` if-chain reconciling 4 independent signals (`status`, `fix_status`, separately-looked-up `verification-run status`, separately-looked-up `committed` boolean). Source of confirmed cross-platform bugs (Android's Kotlin port was missing one branch).

**New Model**: Single owned `step` column, written in exactly one place by the backend orchestration layer (`step-flow.ts`). Eliminates the reconciliation if-chain entirely.

#### Technical Notes

- **Table rename deferred**: `error_reports` keeps its name for now (avoids 161+ refactoring touches). Design supports future rename without data loss.
- **Existing engines unchanged**: `investigator.ts`, `fix-agent.ts`, `verifier.ts` logic is untouched; only sequencing layer is new.
- **Migration discipline**: Append-only, per CLAUDE.md; no in-place edits to migrations 1-71.

---

## Pending Phases

### PHASE 2: Backend Orchestration Layer ✅ COMPLETE

**File**: `src/main/code-change/step-flow.ts` (new)

**Composite actions** ✅ IMPLEMENTED:
- `submitDescription(reportId)` → step 2→3 (invoke planner, land on `plan-review`)
- `acceptPlanAndExecute(reportId)` → step 3→4→5 (accept → execute → verify, chained; on failure → `attention`)
- `revisePlan(reportId, notes)` → snapshot to `code_change_plan_revisions`, re-invoke planner, back to `plan-review`
- `pushCurrentCommit(reportId)` → thin passthrough to git-ops push (step 6 only)

**IPC Handlers** ✅ IMPLEMENTED in `code-change-handlers.ts`:
- Added: `code-change:submit-description`, `code-change:accept-plan`, `code-change:revise-plan`, `code-change:get-plan-revisions`
- Added: `code-change:list-repos`, `code-change:list-repo-files` (multi-repo discovery)
- Added: `code-change:git-push`, `code-change:get-report` (utility handlers)

**WS Command Mirror** ✅ IMPLEMENTED in `ws-handlers.ts`:
- Added code-change: WS command handlers for Android sync
- Same naming scheme `code-change:*` across both platforms
- Error handling and async task management per existing patterns

**Supporting Modules** ✅ IMPLEMENTED:
- `repo-discovery.ts`: Multi-repo workspace scanning with bounded depth
- Updated `types.ts` with new IPC channels and ErrorReportEntry fields (`step`, `repo_relative_path`)

#### Implementation Details

**Files Created**:
- `src/main/code-change/step-flow.ts` (320 lines) — Orchestration layer with composite actions
- `src/main/code-change-handlers.ts` (100 lines) — IPC handler registration
- `src/main/code-change/repo-discovery.ts` (180 lines) — Multi-repo workspace discovery

**Files Modified**:
- `src/main/ipc-handlers.ts` — Added `registerCodeChangeHandlers()` call
- `src/main/ws-handlers.ts` — Added 7 new WS command handlers for Android
- `src/shared/types.ts` — Added `step` and `repo_relative_path` to `ErrorReportEntry`; added 8 new IPC channels

**Key Decisions Made**:
1. **Return type consistency**: Used existing `status` fields (`'done'|'error'`, `'done'|'error'`, `'success'|'failed'`, `'committed'|error`) from engine return types; avoided adding a new `success` boolean
2. **Broadcast pattern**: Followed existing `broadcastToMobile()` convention with `{ event: string, data: unknown }` shape
3. **Window lookup**: Used `BrowserWindow.getAllWindows()[0]` pattern consistent with existing ws-handlers code
4. **Async handling**: Used `.then().catch()` for async operations in WS handlers instead of `async/await` to match existing patterns

**Tests**: All 1367 tests passing (141 test files, 4.5 min runtime)

---

### PHASE 3: Android UI (Primary Target) ⏳ PENDING

**Scope**: Chat-hijack rendering in `ChatScreen.kt`

**New Components** (under `android/.../ui/chat/codechange/`):
- `CodeChangeWizardHost.kt` (mounted in place of normal message list when `Conversation.kind == "code-change"`)
- `CodeChangeStepStepper.kt` (6-pill stepper, reusing `PhaseStepper` pattern)
- 6 step composables: `WorkspaceStep`, `DescribeStep`, `PlanReviewStep`, `ExecutingStep`, `VerifyingStep`, `FinalReviewStep`

**Step 1 Features** (Workspace select):
- Multi-repo picker (via new `discoverReposInWorkspace()` function, new WS command `code-change:list-repos`)
- File tree browser (reuse `FileTreeView.kt`, new WS command `code-change:list-repo-files`)

**Steps 4 & 6 Features** (Change overview):
- Extend `FileTreeView.kt`/`FileLeafRow` with change-type badges (added/modified/deleted)
- Reuse `DiffViewer.kt`/`renderDiffHunks()` underneath for diff display

**ViewModel**:
- New `CodeChangeViewModel.kt` (owns `step` StateFlow sourced from `error_reports.step`)
- Rename Kotlin model: `ErrorReport` → `CodeChange` (in `WsEventParser.kt`)
- Delete: `RemoteEditViewModel.kt`, all screen family (`RemoteEditReportDetailScreen.kt`, `RemoteEditStartScreen.kt`, `RemoteEditReportsScreen.kt`)
- Delete: `ui/remoteedit/` package entirely; move to `ui/chat/codechange/`

**Navigation**:
- Remove: `project-code-changes/*` and `remote-edit/{reportId}` routes from `NavGraph.kt`
- Add: Entry point from project chat list or settings → `startCodeChangeConversation(projectId, repoRelativePath)` → opens dedicated conversation

---

### PHASE 4: Desktop UI (Parity) ⏳ PENDING

**Scope**: Chat-hijack rendering in `ChatMessages.tsx`

**New Components** (under `src/renderer/components/code-change/`):
- `CodeChangeWizard.tsx` (mounted where message list goes, reads `step` directly)
- `CodeChangeStepBar.tsx` (6-pill version of `PhaseBar`)
- 6 step React components: `Step1WorkspaceSelect`, `Step2Describe`, `Step3PlanReview`, `Step4Executing`, `Step5Verifying`, `Step6FinalReview`

**Step 1 Features**:
- File-tree browser (reuse pattern from `RemoteEditDiffViewer.tsx`, point at plain repo contents via new `list-repo-files` IPC call)
- Multi-repo picker (fed by new `discoverReposInWorkspace()` result)

**Steps 4 & 6 Features**:
- VS-Code-style change overview (file list grouped/badged by type, expandable to diff)
- Reuse `remote_edit_diffs` diff-hunk data, redesign presentation layer

**Reuse Unchanged**:
- `CodeChangePlanPreview.tsx` for step 3 plan display

**Delete**:
- `CodeChangeCard.tsx` (571 lines; no more inline reference cards in unrelated chats)
- `CodeChangeDetailView.tsx`, `CodeChangeInvestigationSection.tsx`
- `RemoteEditDiffViewer.tsx`'s phase-gating logic (keep diff-hunk rendering only)
- `useChatWindowActions.ts`'s `startCodeChange()` — rewrite to call `startCodeChangeConversation()`

**Entry Point**:
- "New code change" action in project chat list or settings
- Calls `startCodeChangeConversation(projectId, repoRelativePath)` → creates conversation + `error_reports` row → opens chat

---

## Future: Table & Module Rename

**Deferred from Phase 1** to reduce scope creep (161+ refactoring touches).

When ready:
- Rename tables: `error_reports` → `code_changes`, `remote_edit_diffs` → `code_change_diffs`, etc. (via `ALTER TABLE ... RENAME`)
- Rename directory: `src/main/remote-edit/` → `src/main/code-change/`
- Rename files: `investigator.ts` → `planner.ts`, `fix-agent.ts` → `executor.ts`
- Update all IPC/WS channels to use new names

Design is ready for this; just needs the refactoring pass to touch all call sites.

---

## Verification Checklist

- **Schema**: ✅ Fresh-install and incremental schemas match; all 14 DB tests passing
- **Backend**: ⏳ Unit tests for `step-flow.ts` composite actions and `discoverReposInWorkspace()` against multi-repo fixture
- **Android**: ⏳ Manual walk-through of full flow on device (step 1→6); cross-platform sync check
- **Desktop**: ⏳ Component tests for wizard-mode chat rendering; manual E2E mirroring Android walk-through
- **Final**: Run `npm run typecheck`, `npm run lint`, `npm test` (desktop) and `./gradlew testDebugUnitTest` (Android)
