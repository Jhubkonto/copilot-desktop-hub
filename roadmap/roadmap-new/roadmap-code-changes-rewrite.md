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

**Overall Progress**: 4 / 4 phases complete. Both platforms have a functional chat-hijack wizard with an entry point; the table/module rename remains explicitly deferred (see "Future: Table & Module Rename" below).

**2026-07-13 audit**: Re-verified Phases 1–2 against actual code (not just the roadmap's own claims) using an independent read of every file. Both were functionally sound but had real gaps the roadmap didn't surface: no `conversations.kind` discriminator existed anywhere (needed for the chat-hijack model to work at all), no backend entry point created a code-change conversation+report pair, and desktop's `preload/index.ts` had zero `code-change:*` wrappers despite the IPC handlers existing. Phase 3's Android code did not compile — `CodeChangeViewModel.kt` called a `wsRepository.sendCommand(...)` method that doesn't exist anywhere in `WsClient`/`WsRepository` (only `send(command, data: Map<String,Any>)` exists), the step→composable mapping in `CodeChangeWizardHost.kt` was off-by-one, `DescribeStep`'s submit button never passed the typed description to the callback, and `ChatScreen.kt` had no integration at all. All of these are now fixed; see below.

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

### PHASE 3: Android UI (Primary Target) ✅ COMPLETE

**Scope**: Chat-hijack rendering in `ChatScreen.kt`

**New Components** (under `android/.../ui/chat/codechange/`):
- `CodeChangeViewModel.kt` — owns `CodeChangeState` (reportId, currentStep, plan, workspace, loading/error), collects `wsRepository.events` and reacts to `CodeChangeReport`/`CodeChangeStepUpdated`/`CodeChangeError`/`CodeChangeAck`/`CodeChangeRepos`/`CodeChangeFiles`. On init, resolves its `reportId` by sending `code-change:get-report-for-conversation` (the conversation is assumed to already have a backing `error_reports` row by the time this ViewModel is created).
- `CodeChangeWizardHost.kt` — switches on `state.currentStep` (`describe`/`plan-review`/`executing`/`verifying`/`final-review`/`attention`, with `attention` rendering `PlanReviewStep` since revise-from-failure loops back there) + `CodeChangeStepStepper` (6-pill progress, pill 0 "Repo" always shown complete since repo selection happens before the conversation exists).
- `CodeChangeSteps.kt` — `DescribeStep`, `PlanReviewStep`, `ExecutingStep`, `VerifyingStep`, `FinalReviewStep` (`WorkspaceStep`/`RepoInfo` kept for a future standalone "start a code change" entry screen, not currently mounted by the wizard host).

**ChatScreen.kt integration** ✅: wraps the message `LazyColumn` in `if (conversation?.kind == "code-change") { CodeChangeWizardHost(...) } else { LazyColumn { ... } }`.

**Backend additions made during this pass** (were missing, blocking the whole feature from working):
- Migration 73: `conversations.kind TEXT NOT NULL DEFAULT 'chat'` — the discriminator column the chat-hijack model depends on; nothing wrote to `conversations.kind` before this.
- `startCodeChangeConversation(projectId, workspaceRoot, repoRelativePath)` in `step-flow.ts` — creates the dedicated conversation (`kind = 'code-change'`) + its `error_reports` row in one call. Exposed as IPC `code-change:start` and WS `code-change:start`.
- `getReportForConversation(conversationId)` in `step-flow.ts` — resolves a report by conversation id, since a reopened wizard only has the conversation id to start from. Exposed as IPC `code-change:get-report-for-conversation` and WS (reply event `code-change:report`, carries `investigation_markdown` as `plan`).
- `src/preload/index.ts` had **zero** `code-change:*` wrappers despite the IPC handlers existing since Phase 2 — added wrappers for all 10 channels (desktop renderer still doesn't call them yet; that's Phase 4).
- New Android `WsEvent` cases: `CodeChangeStarted`, `CodeChangeStepUpdated`, `CodeChangeError`, `CodeChangeRepos`, `CodeChangeFiles`, `CodeChangeAck`, `CodeChangeReport` — parsed in `WsEventParser.kt`. `parseConversationArray` now reads `kind` off each conversation row.

**Bugs fixed in the Phase 3 code from the prior session** (none of it had been build-verified before this pass):
- `CodeChangeViewModel.kt` called `wsRepository.sendCommand(reportId, JSONObject)`, a method that doesn't exist on `WsClient`/`WsRepository` (only `send(command: String, data: Map<String, Any>)` does) — this would not compile. Rewrote the ViewModel around `send(...)` and real event collection instead of the previous "fire and forget, methods that never receive a response" shape.
- `CodeChangeWizardHost.kt`'s step→composable `when` block was off-by-one (e.g. the real `plan-review` step rendered `DescribeStep`). Fixed to a direct 1:1 mapping.
- `DescribeStep`'s "Generate Plan" button called `onSubmit()` with no arguments while the typed description lived in a local `remember`d variable — the description the user typed was never actually sent anywhere. `onSubmit` is now `(String) -> Unit` and the button passes the local text.
- `PlanReviewStep`'s plan display was always a placeholder — no code path ever populated `state.plan`. Fixed by carrying `investigation_markdown` on the report lookup and re-fetching it whenever the step transitions to `plan-review`.
- `CodeChangeStepStepper`'s progress index used a `stepOrder` list with `"describe"` appearing twice, which made `indexOfFirst` always resolve to index 0 — fixed to a direct step→index map.

**Verified**: `./gradlew compileDebugKotlin` and `./gradlew testDebugUnitTest` both pass (this is the first time this code has been build-verified). `npm run typecheck` and `npm test` (1367/1367) pass on the desktop side after the backend additions above.

**Still deferred to Phase 4 / later** (by design, not oversight):
- The "New code change" entry point (a button somewhere that calls `code-change:start` and navigates to the resulting conversation) doesn't exist on either platform yet — there's no UI trigger to create the first code-change conversation, only the machinery to run one once it exists. Needed before this is manually testable end-to-end on a device.
- Steps 4 & 6 change-overview (file badges: added/modified/deleted, diff rendering) — still just progress indicators / plain success text.
- Desktop's `code-change:*` preload wrappers exist but nothing in the renderer calls them (Phase 4).

---

### PHASE 4: Desktop UI (Parity) ✅ COMPLETE

**Scope**: Chat-hijack rendering, wired in `ChatWindow.tsx` (not `ChatMessages.tsx` itself — see below).

**What shipped**:
- `src/renderer/components/code-change/CodeChangeWizard.tsx` — single component covering all 6 steps (describe/plan-review-or-attention/executing/verifying/final-review) plus an inline `CodeChangeStepBar` 5-segment progress bar. Reuses `PlanPreview` from `CodeChangePlanPreview.tsx` unchanged for the plan-review step, exactly as planned.
- `ChatWindow.tsx`: `currentConversation?.kind === 'code-change'` now branches between `<CodeChangeWizard>` and the normal `<ChatMessages>` list, right at the existing `<ChatMessages ... />` call site (no new prop threading into `ChatMessages` itself — simpler than the originally-sketched approach).
- Entry point: a `GitBranch`-icon button next to "New chat" in `ProjectHistoryPane.tsx`'s header, calling a new store action `startCodeChangeConversation(projectId)` (`conversationSlice.ts`) that resolves the project's `workspaceRoot`, calls `window.api.startCodeChange(projectId, workspaceRoot, '')`, and reuses the existing `conversationCreated(id)` action to select the new conversation and refresh the list.
- `src/renderer/store/types.ts`: added `kind?: 'chat' | 'code-change'` to the renderer's `Conversation` type (no slice remapping needed — `loadConversations()` already spreads the raw IPC row, and migration 73 already put `kind` on that row).

**Deliberately descoped from the original Phase 4 sketch** (not oversights — cut for scope, matching effort already spent making Phase 3 actually work over building every planned surface):
- No file-tree browser / multi-repo picker step — `startCodeChangeConversation` always passes `repoRelativePath: ''` (single-repo-at-workspace-root assumption), same simplification already made on Android in Phase 3. `discoverReposInWorkspace()`/`list-repo-files` IPC exist and work; nothing calls them from the UI yet on either platform.
- No VS-Code-style change overview for steps 4/6 — same plain-text placeholders as Android.
- `CodeChangeCard.tsx`, `CodeChangeDetailView.tsx`, `CodeChangeInvestigationSection.tsx`, and `RemoteEditDiffViewer.tsx`'s phase-gating were **not deleted** — the legacy `/code-change` slash-command path (`useChatWindowActions.ts`'s `startCodeChange`, via `captureErrorReport`) still exists side-by-side with the new wizard path and still uses these. Deleting them means also ripping out the slash command and everything downstream of it, which is a separate, riskier pass — left as explicit follow-up, not silently dropped.

**Bug fixed while wiring this up** (affects both platforms, not desktop-specific): the "describe" step never actually sent the user's typed text to the backend before invoking the planner — `submitDescription(reportId)` only ever read `error_reports.description`, which `startCodeChangeConversation` seeds with a hardcoded `'Pending description'` placeholder and nothing ever overwrote. Fixed by threading `description` through `step-flow.ts`'s `submitDescription()` (now persists it to the row before invoking the planner) and both the IPC/WS handlers and the Android `CodeChangeViewModel`/desktop `CodeChangeWizard` call sites that invoke it.

**Verified**: `npm run typecheck` ✅, `npm run lint` ✅ (only 2 pre-existing warnings, unrelated), `npm test` ✅ (1367/1367), `./gradlew compileDebugKotlin` + `testDebugUnitTest` ✅ (re-verified after the description-parameter fix touched shared Android code).

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

- **Schema**: ✅ Fresh-install and incremental schemas match; migration 73 added (`conversations.kind`); all 1367 DB-suite tests passing
- **Backend**: ✅ Orchestration layer complete with WS/IPC integration; repo discovery functional; `startCodeChangeConversation`/`getReportForConversation` added; preload wrappers added for all `code-change:*` channels
- **Android**: ✅ ChatScreen integration wired, ViewModel drives real state off WS events, step mapping and plan display bugs fixed, description text now actually reaches the backend, `./gradlew compileDebugKotlin` + `testDebugUnitTest` pass
  - [x] ChatScreen.kt modified to render CodeChangeWizardHost when `kind == "code-change"`
  - [x] WsEvent parser updated to populate `Conversation.kind` field
  - [ ] Manual walk-through of full flow on a real device against a real LLM backend — not yet done in this pass (all verification so far is compile + unit-test level on both platforms)
- **Desktop**: ✅ `CodeChangeWizard.tsx` wired into `ChatWindow.tsx`, entry point in `ProjectHistoryPane.tsx`, `startCodeChangeConversation` store action added
- **Integration**: ⏳ Cross-platform sync verification (start a request on one platform, confirm the other renders the same step) — not yet exercised manually
- **Final**: `npm run typecheck` ✅, `npm run lint` ✅, `npm test` ✅ (1367/1367), `./gradlew compileDebugKotlin` ✅, `./gradlew testDebugUnitTest` ✅.
