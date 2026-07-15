# Next Round of Nexy — Chat-Native Debrief/Quiz/Code-Changes, Mark-Complete, Slash Commands (Desktop + Android)

## Context

Six issues were raised for this round, three on desktop and three on Android. Investigation via three parallel codebase explorations plus a dedicated design pass turned up a very different picture than the raw ask implied, which changes scope in both directions:

- **Desktop mark-complete is already fully built** — DB column, IPC, WS sync to Android, Zustand store, and three sidebar-list UI surfaces all exist and work. The only real gap is that the *open chat window itself* shows no indicator, even though `ChatWindow.tsx` already has the completion state in scope (it uses it to conditionally hide/show the "Mark complete" menu item at line 1452, just never renders it as a badge).
- **Quiz and Debrief were deliberately built as bespoke IPC-backed modals**, mirroring a pre-artifact-system convention (`roadmap/roadmap-archive/DEBRIEF_ROADMAP--COMPLETE.md` explicitly cites `WikiExtractionModal.tsx` as its template). Meanwhile, a separate, more mature **Artifact system already has almost everything the user is asking for** — real multi-version history (`artifact_versions`), markdown export, and a proven mechanism for inserting a durable, specially-rendered non-text message into a chat transcript (the `__artifact-ref:` sentinel convention in `useChat.ts`/`ChatMessages.tsx`). These two lineages never cross-pollinated. Quiz also turns out to hard-depend on Debrief already existing (`quiz-handlers.ts` throws if no debrief row exists) and never persists its actual questions — only a score.
- **Code Changes is currently 100% project-anchored, 0% chat-anchored.** All three entry points (a Projects-pane button, a chat message action, and a Build Dashboard action) converge on the same standalone `CodeChangesScreen.tsx` panel; the chat entry point literally navigates the user *out* of the chat window. Two mechanical DRY violations were confirmed: `investigator.ts`/`fix-agent.ts` are the only two call sites in the codebase that hand-roll CLI backend selection instead of using the shared `getAdapter()` registry, and they bypass the shared `dispatchToProvider()` that every other generator feature uses correctly.
- **Android's "Mark completed" persistence bug has a fully traced, three-layer root cause**, not a vague sync issue: (1) the Room write for the mark-complete WS event is simply missing from `LocalDataRepository.applyRemoteEvent`, (2) `applySyncSnapshot`'s conversation-merge never carries `completedAt` (drops it to null on every reconnect), and (3) desktop's own `conversation:list` SQL never selects `completed_at` in the first place. All three combine so the in-memory flag set right after tapping the button gets silently overwritten. This is a precise, low-risk fix.
- **Android has no slash-command UI in chat at all**, but the data model for per-agent custom commands (`AgentCustomCommand`) already exists on the wire and is simply never fetched near the chat screen.

The user made four binding product decisions during planning (see below) that resolve every open design fork. This plan builds directly on those decisions and on the verified findings above — it does not re-litigate them.

### Binding decisions

1. **Code Changes goes fully chat-native.** The standalone Projects-pane Code Changes screen and all non-chat entry points are removed. Creation, plan review, diff review, apply/verify/commit/rollback all happen inline in the chat transcript via a `/code-change` slash command and a durable card. Build Dashboard's "Fix build" action posts into the project's chat instead of opening a pane.
2. **Mark-complete gets `/complete` + `/incomplete` slash commands**, added *alongside* (not replacing) the existing "..." menu item, plus a persistent header badge in the open chat window.
3. **`/quiz` auto-generates a debrief transparently if one doesn't exist yet** for the conversation, then builds the quiz from it — no more hard error requiring the user to run `/debrief` first.
4. **Data migration is best-effort**: each conversation's single existing `conversation_debriefs` row becomes version 1 of its new artifact-backed debrief. `conversation_quiz_attempts` (score-only, no question content) is dropped with no migration — there's nothing meaningful to preserve.

**Direct precedent this plan extends:** `useChat.ts`'s `attachArtifact()` (L115-131) inserts a persisted message whose content is the literal string `__artifact-ref:${JSON.stringify({artifactId, versionId})}` via `window.api.insertConversationMessage`; `ChatMessages.tsx` L336-353 detects that prefix at render time and substitutes `<ArtifactCard artifactId versionId />`. This plan reuses that mechanism for Debrief/Quiz artifacts, and introduces a sibling sentinel (`__code-change-ref:`) for Code Changes, whose underlying data (a live, multi-phase `error_reports` row) doesn't fit the Artifact system's immutable-version-snapshot model — a deliberate divergence, flagged as Judgment Call CC-1 below.

**Migration numbering:** current max DB migration version is **59** (confirmed via direct grep of `database-migrations.ts`). This plan needs 2 new migrations, numbered **60 and 61**. The not-yet-implemented `roadmap/roadmap-new/ANDROID_DESKTOP_ROUND5_ROADMAP.md` also claims versions 60/61 for unrelated tables — **whichever roadmap lands second must renumber to 62/63**.

### Validation policy (every phase)

- **Desktop:** `npm run lint && npm run typecheck && npm test && npm run build`
- **Android:** `cd android && .\gradlew.bat lint testDebugUnitTest assembleDebug`
- New Vitest/JUnit/Compose tests are required for every phase that introduces new logic. Android instrumented/Compose UI tests and on-device checks are noted as "not verifiable in this environment" where applicable (no emulator/device attached), matching this repo's established convention.
- Leave changes uncommitted unless told otherwise.

### Sequencing overview

```
Desktop 1 (slash foundation)
   ├──▶ Desktop 2 (Debrief/Quiz → artifacts)         ─┐
   ├──▶ Desktop 3 (mark-complete commands + badge)     ├─ can run in parallel with each other
   └──▶ Desktop 4 (Code Changes chat-native, additive) ┘        by different engineers
              └──▶ Desktop 5 (Code Changes cleanup: remove old screen, DRY fixes)

Android 6 (mark-complete persistence fix)   — fully independent, no desktop dependency, start anytime
   └──▶ Android 7 (in-chat completion badge)

Android 8a (slash composer UI: built-ins + custom commands) — independent, start anytime
   └──▶ Android 9 (LLM-generating slash routing + artifact/code-change card rendering)
              depends on: Desktop 2 (debrief/quiz contract), Desktop 4+5 (code-change contract),
                          Android 6 (mark-complete correctness), Android 8a (composer)
```

Desktop phases 2/3/4 only share Phase 1's small context extension — they touch disjoint files otherwise and are safe to parallelize. Android 6/7 and Android 8a touch none of the desktop files and can start on day one. Android 9 is the only piece that genuinely must wait on desktop's contracts being final.

---

## Phase 1 — Desktop: slash-command foundation

**Goal:** Give `SlashCommandContext` the two capabilities every later chat-native command needs (run a generation flow, attach a durable non-text message), and fix a pre-existing input-clobber bug in the same dispatch path while it's open.

- `src/renderer/slash-commands.ts`: extend `SlashCommandContext` (L130-149) with:
  ```ts
  markComplete: () => Promise<void>
  markIncomplete: () => Promise<void>
  runSlashGeneration: <K extends 'debrief' | 'quiz'>(kind: K, opts?: { model?: string }) => Promise<{ artifactId: string; versionId: string } | { error: string }>
  attachArtifactMessage: (artifactId: string, versionId?: string) => Promise<void>
  startCodeChange: (opts: { description: string; requestType?: CodeChangeRequestType }) => Promise<{ reportId: string } | { error: string }>
  ```
  `attachArtifactMessage` is not new logic — it threads the already-implemented `chat.attachArtifact` (`useChat.ts` L115-131) through the context for the first time.
- Fix the clobber bug: the custom-command branch of `executeSlashCommand`'s `default` case (L449-456) does `ctx.setInput(customCmd.prompt)` to expand a template, but `handleSend` (`useChatWindowActions.ts` L286-291) unconditionally calls `setInput('')` right after `executeSlashCommand` returns `true`, clobbering the expansion before the user sees it. Fix: change `executeSlashCommand`'s return type from bare `boolean` to a discriminated result (e.g. `Promise<'handled' | 'expanded' | false>`), where the custom-command branch returns `'expanded'`; `handleSend` only clears input when the result is `'handled'`. Add a regression test asserting a custom command's expanded prompt survives in the input box.
- `src/renderer/hooks/useChatWindowActions.ts`: wire the 5 new context fields into the `slashCommandCtx` `useMemo` (L151-208). `markComplete`/`markIncomplete` bind to the existing `conversationSlice.ts` actions (`markConversationComplete`/`markConversationIncomplete`, L58-80) already used by `ChatWindow.tsx`'s menu item. `runSlashGeneration`/`attachArtifactMessage`/`startCodeChange` get their real implementations in Phases 2 and 4 — this phase only adds the shape so its own tests can use fakes.
- No IPC/DB changes in this phase — pure renderer plumbing plus the bug fix.

**Phase gate:** Desktop validation gate. New Vitest coverage: the clobber-bug regression test; `SlashCommandContext`'s new shape exercised via a fake in slash-command tests.

---

## Phase 2 — Desktop: Debrief & Quiz become artifact-backed `/debrief` and `/quiz` commands

**Goal:** Debrief and Quiz generation produce versioned, re-runnable, markdown-exportable artifacts rendered inline via kind-specific `ArtifactCard` views. Decision #3's auto-debrief coupling is implemented. The one existing debrief per conversation migrates to artifact v1; quiz scores are dropped (decision #4).

### Types & schema

- `src/shared/types.ts`: extend `ArtifactKind` (L813-815) with `'debrief' | 'quiz'`. No migration needed for this specific change — `artifacts.kind` is a plain `TEXT NOT NULL` with no `CHECK` constraint (confirmed via migration v33).
- New migration **60**: `ALTER TABLE error_reports ADD COLUMN conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL;` + supporting index — consumed by Phase 4, numbered here to keep both new migrations documented together.
- New migration **61** (a `run(db)` function, not plain SQL — needs `fs`/`path`, matching the existing precedent of migration v49's table-rebuild using `run`):
  1. For each `conversation_debriefs` row: create one `artifacts` row (`kind: 'debrief'`), one `artifact_versions` row (`version_number: 1`), write `debrief.json` + `debrief.md` (rendered via the same logic as today's `DebriefModal.tsx` `formatMarkdown()`, moved server-side) to disk under the artifact storage root, two `artifact_files` rows, and one `artifact_chat_refs` row linking back to the conversation. Wrap each row in try/catch so one malformed legacy row doesn't abort the batch.
  2. `DROP TABLE IF EXISTS conversation_quiz_attempts;`
  - **Judgment call (resolved):** `conversation_debriefs` itself is left in the schema, unused, rather than dropped — the decision said the row "becomes version 1," not "the table is deleted." Say so if you'd rather drop it too for symmetry.

### Main process — generation writes through the artifact system

- `src/main/debrief-handlers.ts`: rewrite `generateDebriefForWs` (L57-151) to keep its existing prompt/parse logic unchanged, but instead of `INSERT OR REPLACE`-ing into `conversation_debriefs`, look up an existing debrief artifact for the conversation (new helper `findArtifactForConversation(conversationId, kind)`) — if found, insert a **new** `artifact_versions` row under the same `artifactId` (making `/debrief` genuinely re-runnable); if not, create a new `artifacts` row. Mirror `promoteConversationMessageToArtifact` (`artifacts.ts` L145-234) as the template, including its transaction wrapping. Return type changes to `{ debrief, artifactId, versionId }` — update the 2 call sites (IPC + WS handlers). `markCompleteForWs`/`markIncompleteForWs` (L161-186) stay untouched — debrief must remain decoupled from mark-complete per the existing design comment at `DebriefModal.tsx` L20-25 and `docs/android-standalone.md` L101-109.
- `src/main/quiz-handlers.ts`: rewrite `generateQuizForWs` (L40-115) to replace the hard-fail-on-missing-debrief (L43-52) with decision #3's transparent auto-generation — call `findArtifactForConversation(conversationId, 'debrief')`; if none, call `generateDebriefForWs` first, then proceed. Read the debrief content from its artifact file instead of the old table row. Write quiz output as a new/versioned `quiz`-kind artifact (`quiz.json` primary + `quiz.md` supporting) with its own `artifact_chat_refs` row. Return type changes to `{ questions, artifactId, versionId }`. Drop `saveQuizAttemptForWs`/`listQuizAttemptsForWs` (L117-132) and their IPC/WS handlers per decision #4 (no replacement scoring persistence — flag if you want one added later). `generateQuizForWs` needs a new `projectId` parameter threaded through both IPC and WS call sites, since the transparent-debrief path needs it.
- `src/shared/types.ts` / `src/preload/index.ts`: update `IpcReturnMap`/channel signatures for the new return shapes; remove the quiz-attempt channels.

### Renderer — `/debrief` and `/quiz` slash commands + kind-aware `ArtifactCard`

- `src/renderer/slash-commands.ts`: add `/debrief [model]` and `/quiz [model]` to `SLASH_COMMANDS`, plus two `executeSlashCommand` cases that push a "Generating…" system message, call `ctx.runSlashGeneration(...)`, then `ctx.attachArtifactMessage(...)` on success (or push an error). Default to `ctx.conversationModel` when no arg is given (already "whatever model is selected in chat") — the optional trailing arg is the power-user override, replacing `DebriefModal`'s bespoke `ModelPicker`.
- `src/renderer/hooks/useChatWindowActions.ts`: implement the real bodies of `runSlashGeneration`/`attachArtifactMessage` from Phase 1's shape.
- `src/renderer/components/artifacts/ArtifactCard.tsx` (currently 105 lines, confirmed generic/kind-agnostic — verified directly): refactor into a dispatcher. Rename the current body to `GenericArtifactCard`; new top-level `ArtifactCard({artifactId, versionId})` keeps the existing fetch and switches on `artifact.kind`: `'debrief'` → new `DebriefArtifactCard`, `'quiz'` → new `QuizArtifactCard`, else → `GenericArtifactCard`. `ChatMessages.tsx`'s call site (L347, confirmed) doesn't change.
- New `DebriefArtifactCard.tsx`: fetches `debrief.json` via a new IPC channel `artifact:get-file-content` (validates the path against the version's known `artifact_files` rows before reading, to guard against path traversal), renders using the existing read-only section layout from `DebriefModal.tsx`'s review step. "Export Markdown" reuses the already-working generic `artifact:export` (`format: 'markdown'`) — no changes needed there. **Scope decision:** the 3 bespoke export paths (Save to Wiki, Save as Prompt, Export MD) are dropped — no clean artifact-system equivalent exists today; generic markdown export covers the core need.
- New `QuizArtifactCard.tsx`: reuses the entire existing `QuizModal.tsx` interactive flow (generating → question → feedback → summary) as requested, with one data-source change — it loads the stored `quiz.json` instead of calling `generateQuiz` fresh on view. "Try Again" re-walks the same stored questions; a new "Regenerate" button calls `/quiz` again (new artifact version, new card). Attempt-history UI is removed (scores are session-local only, per decision #4).
- Delete `QuizModal.tsx` and `DebriefModal.tsx` and their mount points in `ChatWindow.tsx` (state L129-130, menu items, mounts) and `ChatsPane.tsx` once logic is relocated.
- Cleanup: remove dead `pendingDebriefConversationId`/setter in `src/renderer/store/slices/uiSlice.ts` (L87-88, 125, 140-144 — confirmed referenced nowhere else repo-wide).

**Phase gate:** Desktop validation gate. New Vitest coverage: migration 61 produces the right row set from a seeded debrief and round-trips content; re-running `/debrief` on the same conversation creates version 2 under the same artifact; `/quiz` on a conversation with no debrief transparently generates one first (assert both artifacts exist, debrief fires before quiz); `ArtifactCard` kind-dispatch renders the right sub-component. Manual (not verifiable here): visually confirm `QuizArtifactCard` is equivalent to the old modal.

---

## Phase 3 — Desktop: `/complete` + `/incomplete` slash commands and in-chat completion badge

**Goal:** Add the two slash commands alongside the existing menu item, and close the one real UI gap: no visible completion indicator inside the open chat window.

- `src/renderer/slash-commands.ts`: add `/complete` and `/incomplete` to `SLASH_COMMANDS` plus two cases calling `ctx.markComplete()`/`ctx.markIncomplete()` (from Phase 1) then a confirmation system message. Guard for no active conversation.
- `src/renderer/components/ChatWindow.tsx`: add a small persistent badge next to the conversation title, conditioned on `completedConversationIds.includes(conversationId)` — confirmed this selector already exists at L143, and the file already knows this state well enough to conditionally hide its "Mark complete" menu item (L1452) but currently renders nothing for it. Reuse the same green `CheckCircle`-styled badge already used by `ChatsPane.tsx`/`ProjectHistoryPane.tsx`/`AgentHistoryPane.tsx`'s list rows for visual consistency.
- Do not touch `debrief-handlers.ts`'s `markCompleteForWs`/`markIncompleteForWs` or the IPC/WS layer — this is fully built server-side already; this phase is purely 2 slash-command cases + 1 badge.

**Phase gate:** Desktop validation gate. New Vitest coverage: `/complete`/`/incomplete` call the right store actions; a render test asserting the header badge appears iff the conversation is completed and disappears after `/incomplete`.

---

## Phase 4 — Desktop: Code Changes becomes chat-native (additive)

**Goal:** `/code-change` creates a request anchored to the open conversation and renders a durable, live-updating card inline in the transcript, covering the full lifecycle (plan review → diff review → apply → verify → commit/rollback). Built alongside the existing Projects-pane screen so both work during this phase; Phase 5 removes the old one once proven.

- Migration 60 (added in Phase 2, consumed here): `error_reports.conversation_id` + index.
- `src/shared/types.ts`: add `conversationId?: string | null` to `ErrorReportCaptureInput`/`ErrorReportEntry`.
- `src/main/error-report-handlers.ts`: `createErrorReport` (L99-144) accepts/persists `conversation_id`; `rowToErrorReport` (L25-60) reads it back. Note: the existing `request_origin` CHECK constraint (migration v49) already includes `'chat'` as a valid value with no code path ever setting it — `/code-change` becomes the first caller to use it.
- `src/renderer/slash-commands.ts`: add `/code-change <description>` — requires a resolved project for the conversation (push a clear message if the conversation has no project). Before creating, check for an existing non-terminal report already linked to this `conversationId` (new optional `conversationId` filter on the existing report-list query, mirroring its existing `projectId` filter) — if found, point at the existing card instead of duplicating. Otherwise `ctx.startCodeChange({ description })`, which creates the report with `origin: 'chat'` and inserts a system message with content `__code-change-ref:${JSON.stringify({ reportId })}` via the same `insertConversationMessage` primitive `attachArtifact` already uses.
- **Judgment Call CC-1 (resolved):** Code Changes does **not** become an `ArtifactKind`. An artifact version is an immutable snapshot; a code-change request mutates in place across phases (`error_reports.status`, `remote_edit_diffs`, `remote_edit_verification_runs`, etc. all update the same `reportId`). This plan instead adds a second sentinel prefix, `__code-change-ref:`, detected in `ChatMessages.tsx` the same way as `__artifact-ref:` (a second `if` branch after L336-353), rendering `<CodeChangeCard reportId={ref.reportId} />`.
- New `src/renderer/components/chat/CodeChangeCard.tsx`: the direct successor of `CodeChangesScreen.tsx`'s (1012 lines) internal state/handlers — **relocated into a card, not reimplemented**. Resolves its single report from `reportId` (prop) instead of a project-scoped list. Reuses the already-presentational sub-components unchanged: `CodeChangeDetailView.tsx` (326 lines, already prop-driven), `RemoteEditDiffViewer.tsx` (469 lines, its 4 `PhaseSection` collapsibles work fine inside a card), `RevisePlanControl.tsx`, `CodeChangePlanPreview.tsx`, `DeleteRemoteEditReportDialog.tsx`. One extraction: `RemoteEditDiffViewer.tsx`'s hunk-rendering logic (L225-251, confirmed the only diff-rendering code in the entire renderer) pulls out into a standalone `DiffHunkView.tsx` so the card's collapsed default state ("3 files changed, click to expand") doesn't have to drag in the rest of the panel's chrome. Card chrome: collapsed by default with a one-line phase summary (reusing the already-shared `CODE_CHANGE_PHASE_LABELS`/`CODE_CHANGE_PHASE_GUIDANCE` from `src/shared/code-changes.ts`), expands in place — no navigation away from chat.
- All 29 existing `remote-edit:*` + 4 `error-report:*` IPC channels and the WS `self-heal:*` surface are reused unchanged (beyond the `conversationId` filter addition) — Android's WS parser keeps expecting `self-heal:*`, untouched.

**Phase gate:** Desktop validation gate. New Vitest/RTL coverage: `/code-change` sets `conversation_id`/`origin: 'chat'` and inserts the sentinel; a second `/code-change` on the same conversation while one is non-terminal reuses the existing report; `CodeChangeCard` renders correctly per status; `DiffHunkView` extraction is behavior-identical to the old inline block. Manual (not verifiable here): full investigate → plan → fix → verify → commit cycle from inside a chat card.

---

## Phase 5 — Desktop: Code Changes cleanup — remove standalone screen, redirect Build Dashboard, DRY fixes

**Goal:** Remove the old project-anchored surface entirely (decision #1) now that Phase 4's inline flow is proven, and fix the two confirmed mechanical DRY violations while this code is open.

### Remove the standalone screen and its entry points

- Delete `src/renderer/components/section-pane/ProjectCodeChangesPane.tsx` and its `SectionPane.tsx` routing (`showingCodeChanges`, L50).
- `ProjectsPane.tsx`: remove the `<Diff>` icon button + `setCodeChangesProjectId` handler (L223-234). **Judgment call (resolved):** the adjacent "N in progress" badge (L203-211, driven by an unrelated still-alive aggregate) is kept but repointed to open the project's `ChatsPane` instead of a dead pane, since there's no destination panel left. Say so if you'd rather drop the badge outright.
- `ChatWindow.tsx`: `handleCreateCodeChange` (L388-403) currently navigates away (`openSectionPane('projects')`). Replace with prefilling the input as `/code-change ${content}` and letting the user send — keeps exactly one code path through the slash-command dispatcher rather than a second parallel creation path.
- `projectSlice.ts`: remove `codeChangesProjectId`/`pendingCodeChangesProjectId`/`pendingNewRequestDraft`/`pendingRemoteEditReportId` once nothing references them (confirm via repo-wide grep before deleting, since the Build Dashboard handler below is rewritten in this same phase).

### Build Dashboard redirect

- `SettingsPanel.tsx`: rewrite `handleFixBuildWithRemoteEdit` (L590-619). New flow: after capturing the report, resolve a target conversation for the project — **UX decision (resolved):** prefer the project's most-recently-updated non-archived conversation; if none exists, create one (e.g. titled "Build fix"). Insert the `__code-change-ref:` sentinel into it via the same shared function Phase 4's `/code-change` uses (factor "create report + insert sentinel" into one function, e.g. `createCodeChangeInConversation()`, used by both call sites). Switch the active view to that conversation so the user lands in chat looking at the new card.

### DRY fixes

- `investigator.ts` L471-510 and `fix-agent.ts` L276-303: replace hand-rolled CLI-backend branching with the shared `getAdapter(backend)` registry (`cli-adapters/registry.ts` L12-14) that 7 other generator features already use correctly. Mechanical, low-risk call-site substitution.
- **Judgment Call CC-2 (resolved):** `investigator.ts`/`fix-agent.ts` bypass `dispatchToProvider()` and re-derive their own tool-support-fallback logic via `prompted-tool-caller.ts`. **Recommendation: keep as a documented exception, not a forced unification.** `dispatchToProvider` is shaped around chat's fixed tool-loop; investigator's prompted-fallback is narrowly scoped to its own read-only inline tool set. Bolting a generic fallback onto the 7 existing correct callers for a purely cosmetic dedup risks destabilizing them. Add a one-line comment at both call sites explaining why. If you'd rather force real dedup, the concrete alternative is extracting just the prompted-fallback wrapping into a new exported helper in `chat-provider-dispatch.ts` that both sides opt into — flag if you want this instead.
- **Judgment call (resolved):** do not add the `diff` npm package to replace `fix-agent.ts`'s hand-rolled LCS algorithm (L59-136) — it works today; swapping it mid-refactor adds risk disproportionate to the benefit. Revisit only if a concrete correctness bug surfaces.

**Phase gate:** Desktop validation gate. New Vitest coverage: Build Dashboard's conversation-resolution logic (reuse vs. create, both insert exactly one sentinel); `getAdapter()` substitution doesn't change observable behavior. Repo-wide grep confirming zero remaining references to `codeChangesProjectId`/`ProjectCodeChangesPane`. Manual (not verifiable here): trigger "Fix build" and confirm it lands in a chat conversation, not a separate pane.

---

## Phase 6 — Android: mark-complete persistence bug fix

**Goal:** Fix the root-caused bug where marking a conversation complete is immediately visible then silently reverts on the next reconnect/refresh. Fully independent of all desktop phases — can run in parallel with any of them.

Three surgical changes, all directly confirmed against source during investigation:

1. `src/main/ws-handlers.ts`: add `c.completed_at` to the `conversation:list` SQL `SELECT` (L716-733) — this is the desktop-side root cause; the field is currently absent from the JSON Android receives entirely.
2. `LocalDataRepository.kt`: add two cases to `applyRemoteEvent`'s `when` block, before the `else -> Unit` fallback (L1236):
   ```kotlin
   is WsEvent.DebriefConversationCompleted -> database.conversations().get(event.conversationId)?.let {
       database.conversations().upsert(it.copy(completedAt = event.completedAt, remoteVersion = it.remoteVersion + 1))
   }
   is WsEvent.DebriefConversationIncompleted -> database.conversations().get(event.conversationId)?.let {
       database.conversations().upsert(it.copy(completedAt = null, remoteVersion = it.remoteVersion + 1))
   }
   ```
   (Confirm exact DAO method names against `ConversationDao` at implementation time — the `get`/`upsert` pattern matches every other case in this `when` block.)
3. Same file, `applySyncSnapshot`'s conversation-entity construction (L795-810): add `completedAt` from the incoming row, matching the idiom already used for every other field there, and matching `Conversation.toEntity()`'s already-correct handling of the same field on the sibling merge path (`mergeRemoteConversation`, L1463) — proving the fix pattern already exists elsewhere in this same file.

Do not touch `WsEventParser.kt`'s existing completed-event parsing (L1738-1749, already correct) or `WsRepository.kt`'s `markConversationComplete` (L2214, already correct) — the bug is entirely in the Room-persistence layer these 3 changes fix.

**Phase gate:** Android validation gate. New JUnit test: seed a conversation, apply `WsEvent.DebriefConversationCompleted`, assert Room's `completedAt` is set; then apply a simulated `applySyncSnapshot` payload *without* `completed_at` and assert the existing value survives (guards against re-introducing the bug via the sync-merge fix). New test on desktop asserting `completed_at` appears in the `conversation:list` row shape. Manual/on-device (not verifiable here): mark complete on Android, force a reconnect, confirm the checkmark survives.

---

## Phase 7 — Android: in-chat completion badge (depends on Phase 6)

**Goal:** Close the confirmed gap — `ChatScreen.kt` never shows any completion indicator inside the open conversation, only in list views. Deliberately sequenced after Phase 6 since a badge sourced from unreliable state would just relocate the bug.

- `ChatScreen.kt`: `conversation` is already resolved at L157 and already carries `completed_at` (`Conversation.kt` L17) — this phase adds a `collectAsState()` on `WsRepository.completedConversationIds` (or reads `conversation?.completed_at != null` directly, now reliable post-Phase-6) and renders a small badge in `NexyTopAppBar`'s `titleContent` (L801-828), following the exact pattern already used there for `backendLockLabel` (a conditional subtitle row, L819-826).
- Explicitly do not wire this to the unrelated `WsRepository.clearCompletedAway()`/`_completedWhileAwayIds` (a different concept: suppressing a "generation finished while away" push notification).

**Phase gate:** Android validation gate. New Compose test asserting the badge renders iff `completed_at != null`. Manual/on-device (not verifiable here): confirm the badge appears immediately after `/complete` is issued from desktop against the same conversation open on Android.

---

## Phase 8a — Android: slash-command composer UI (independent, can start anytime)

**Goal:** Give the chat composer a slash-command entry point and dropdown, wired to a mobile-appropriate subset of desktop's built-ins plus the already-modeled-but-unused `agentFullConfig.customCommands`. Stops short of anything that calls an LLM or renders a card — that's Phase 9.

- `ChatViewModel.kt`: currently never references `agentFullConfig`/`AgentFullConfig` (confirmed via grep). Add a `StateFlow` derived from `WsRepository.agentFullConfig` (already populated via the existing `agent:get-full` WS reply) filtered to the active agent's `customCommands: List<AgentCustomCommand>` — the shape already matches desktop's `{name, description, prompt}` exactly.
- New `SlashCommands.kt`: a mobile-appropriate subset of desktop's `SLASH_COMMANDS` — recommend keeping text-only, no-filesystem commands (`/clear`, `/new`, `/model`, `/theme`, `/help`, `/copy`, `/share`) and dropping desktop-only ones (`/cwd`, `/cd`, `/add-dir`, `/list-dirs`). **Flagged judgment call** — finalize this subset with product input; it's a reasonable default, not a hard requirement.
- `ChatScreenInput.kt`: extend the chat input bar with a "/" trigger (detect a leading `/` the same way desktop does) opening a bottom-sheet/dropdown list of matching built-ins + custom commands, reusing the existing `ModalBottomSheet` pattern already in this file.
- Dispatch: text-transforming commands rewrite input and fall through to normal send (mirrors desktop's `transformCodeSlashCommand`); local-only commands execute directly against `ChatViewModel`/`WsRepository` state; custom commands expand their `prompt` into the input field — write this correctly the first time (matching Phase 1's fix) rather than porting the clobber bug.

**Phase gate:** Android validation gate. New JUnit test: `ChatViewModel`'s custom-commands `StateFlow` derives correctly from `agentFullConfig`. New Compose test: dropdown filtering/selection, and a custom command's prompt correctly landing (not clearing) in the input field.

---

## Phase 9 — Android: LLM-generating slash routing + artifact/code-change card rendering

**Goal:** Route `/debrief`, `/quiz`, `/complete`, `/incomplete`, `/code-change` through the same WS-level contracts Desktop Phases 2/4/5 define, and render their resulting cards inline in the Android chat transcript. Depends on Desktop 2, Desktop 4+5, Android 6, and Android 8a.

- **Verified directly, not assumed:** Android has `ui/artifacts/ArtifactsScreen.kt` with real `ArtifactSummary`/`ArtifactDetail2` models and a working promote-message flow — but it's a standalone pane only. A repo-wide grep for `artifact-ref`/`ArtifactRef` across the Android source returns zero hits: Android's chat transcript does **not** detect or render the `__artifact-ref:` sentinel inline at all today, unlike desktop. This must be built, not assumed to already exist.
- Add sentinel detection to Android's message-to-render-item mapping, mirroring `ChatMessages.tsx`'s pattern: `__artifact-ref:` → new `ArtifactRefCard`; `__code-change-ref:` → new `CodeChangeRefCard`.
- `ArtifactRefCard`: fetches via the artifact IPC/WS surface already backing `ArtifactsScreen.kt`, branches on `kind` like desktop's dispatcher — `'debrief'`/`'quiz'` get compact purpose-built views, else falls back to the existing generic row rendering. **Verify at implementation time** whether Android's existing Quiz flow has a reusable Compose component or only a full-screen entry point — this determines whether the mobile quiz view is a genuine reuse or a new build.
- `CodeChangeRefCard`: Android's Code Changes screens (`RemoteEditStartScreen`/`RemoteEditReportsScreen`/`RemoteEditReportDetailScreen`) already exist and talk to the same `self-heal:*` WS surface (per the separate, not-yet-implemented Round 5 roadmap's findings) — **recommended default**: a condensed card that deep-links into the existing `RemoteEditReportDetailScreen` for the full phase UI, rather than natively reimplementing Desktop Phase 4's inline card. Full native parity is a separable follow-up if this proves insufficient.
- Slash routing (`ChatViewModel.kt`, extending Phase 8a): `/debrief`/`/quiz` call the existing `conversation:generate-debrief`/`generate-quiz` WS commands (unchanged names — only their payload gained `artifactId`/`versionId` fields in Desktop Phase 2, so `WsEventParser.kt`'s parsing needs extending to read them) then insert the artifact-ref sentinel. `/complete`/`/incomplete` call the already-correct `WsRepository.markConversationComplete`/incomplete (now trustworthy post-Phase-6). `/code-change` calls the existing `error-report:request-capture` WS command (already used by Android's existing Code Changes creation flow) extended with the new `conversationId` field, then inserts the code-change-ref sentinel.

**Phase gate:** Android validation gate. New JUnit/Compose tests: sentinel detection renders the right card per prefix (including artifact-ref, now covered on Android for the first time); `/complete`/`/incomplete` produce the same Room state Phases 6/7 verify; `/quiz` on a conversation with no debrief triggers exactly one debrief generation first. Manual/on-device (not verifiable here): cross-platform check — issue `/debrief` on desktop, confirm identical card/content on Android for the same conversation; issue `/code-change` on Android, confirm desktop's chat card reflects live phase updates.

---

## Summary of flagged judgment calls

| # | Call | Default chosen in this plan |
|---|------|------------------------------|
| CC-1 | Code Changes as a new `ArtifactKind` vs. its own sentinel | Own sentinel (`__code-change-ref:`) — versioning model doesn't fit live-mutating multi-phase state |
| CC-2 | Extend `dispatchToProvider` with a prompted-tool-calling fallback vs. keep bespoke dispatch | Keep as documented exception; only fix the mechanical `getAdapter()` duplication |
| — | Add the `diff` npm package to replace the hand-rolled LCS diff | Do not add it in this pass |
| — | `conversation_debriefs` table: drop entirely vs. leave unused after migration | Leave unused |
| — | Quiz attempt-history: replace the dropped scoring table with something new | No replacement — attempts become session-local only |
| — | `DebriefModal`'s Save-to-Wiki / Save-as-Prompt actions | Dropped; generic artifact markdown export is the supported path forward |
| — | ProjectsPane's "N in progress" code-change badge after screen removal | Kept, repointed to open the project's ChatsPane |
| — | Build Dashboard "Fix build" target conversation selection | Reuse most-recent non-archived project conversation; create one if none exists |
| — | Mobile built-in slash-command subset | Text-only/no-filesystem subset proposed in Phase 8a; needs product confirmation |
| — | Android `CodeChangeRefCard`: condensed deep-link vs. full native inline parity | Condensed card + deep-link to existing `RemoteEditReportDetailScreen` |
| — | Migration numbering collision with `ANDROID_DESKTOP_ROUND5_ROADMAP.md` | Both claim 60/61; whichever roadmap lands second renumbers to 62/63 |

## Critical files for implementation

- `src/renderer/slash-commands.ts`
- `src/renderer/hooks/useChatWindowActions.ts`
- `src/main/debrief-handlers.ts`
- `src/main/quiz-handlers.ts`
- `src/main/artifacts.ts`
- `src/renderer/components/artifacts/ArtifactCard.tsx`
- `src/renderer/components/CodeChangesScreen.tsx`
- `src/main/database-migrations.ts`
- `src/main/ws-handlers.ts`
- `android/app/src/main/java/io/nexy/android/data/local/LocalDataRepository.kt`
- `android/app/src/main/java/io/nexy/android/ui/chat/ChatViewModel.kt`

## Verification

- Run each phase's stated Phase gate (desktop and/or Android validation commands) before moving on.
- After Phase 2: manually run `/debrief` then `/quiz` in a real conversation, confirm both render as inline cards, re-run `/debrief` and confirm a second version appears, export markdown from the card.
- After Phase 3: manually confirm the header badge appears/disappears with `/complete`/`/incomplete` and with the existing menu item.
- After Phase 4/5: manually run a full Code Changes lifecycle (create → investigate → plan → diff → apply → verify → commit) entirely from within a chat conversation, and confirm the old Projects-pane entry point no longer exists.
- After Phase 6/7: on a real Android device/emulator, mark a conversation complete, force a reconnect, confirm persistence; confirm the in-chat badge.
- After Phase 8a/9: on a real Android device/emulator, exercise the slash dropdown, a custom command, and each of `/debrief /quiz /complete /incomplete /code-change`, cross-checking against the same conversation open on desktop.
