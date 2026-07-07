# Round 5 — Code Changes Gating, Provider Routing Bug, Full Background-Activity Resume, Manual Workflow Rebuild

## Context

A further hands-on pass surfaced 7 problems, investigated via 3 parallel Explore agents, one architecture-design Plan agent, and direct verification (not guessing) before this plan was written.

1. **Android Code Changes has no standalone-mode gating at all.** None of the three screens (`RemoteEditStartScreen`, `RemoteEditReportsScreen`, `RemoteEditReportDetailScreen`) check connection state, unlike the Home screen's own per-project Code Changes icon, which already does (`enabled = connectionState == ConnectionState.CONNECTED`). Reaching these screens while standalone doesn't just fail — `WsRepository.send()` silently no-ops when disconnected (no error event), so "Creating request…", "Planning…", and pull-to-refresh spin **forever** with no error. The chat-message "Create code change" menu entry point is a second, ungated way to reach this dead end.
2. **The Code Changes "Planning settings" backend/model picker has two real bugs.** The backend dropdown (`byok`/`claude-cli`/`codex-cli`) always shows all three regardless of what's actually installed on the desktop, unlike desktop's own equivalent, which filters CLI options to what's actually available. The "Model" field is a plain free-text `OutlinedTextField` — the user must know and type a model id manually — even though the same file's "Revise plan" flow a few hundred lines away already has a working `ModelPickerSheet` bound to real model data. **Important correction to the original ask**: BYOK is not a broken leftover here — `src/main/remote-edit/investigator.ts` and `fix-agent.ts` both have full, working BYOK code paths for investigation *and* patch generation, and BYOK is the server's actual default. Per your decision, BYOK stays; only the two confirmed bugs get fixed.
3. **A general, pre-existing provider-routing bug**, found while tracing an OpenAI-key error that appeared despite an Anthropic model being selected. `getProviderForAgent()` (`src/main/provider-registry.ts:74-96`) falls through to a live OpenRouter-cache membership check, then a fragile `startsWith('claude')` heuristic, then defaults to `openai`. A vendor-prefixed OpenRouter catalog id like `anthropic/claude-haiku-4.5` fails the `claude`-prefix check purely because of its vendor prefix, and — since the OpenRouter cache is only populated after a successful key *test*, not merely after saving a key — commonly misses the cache check too, so it silently defaults to `openai` and fails with OpenAI's own "no API key" error. This is a general defect (same function is used by chat, Skill Generator, and the orchestrator), not Manual-Workflow-specific, and `manual-workflow-generator.ts` also lacks the "no provider configured" guard that `orchestrator.ts` already has.
4. & 5. **Manual Workflow produces a list of steps that are just text prompts with a "Copy prompt" button (Android) or one manual click per step (Desktop) — no persistence, no execution, nothing sequences step 2 after step 1.** Confirmed structurally different from Skill, which is persisted and auto-injected into an agent's system prompt/tools on every turn it handles, with the agent then invoking tools itself. Confirmed the orchestrator and chat tool-loop are both hard-wired to native provider tool-calling and silently collapse to one plain reply for models that don't support it — so there's a genuine, unfilled gap for automatic multi-step chaining that works with any model. **Per your decision**, Manual Workflow is rebuilt into an automatic step-chaining ("prompt chaining") executor: the app itself runs each step through the model in sequence, feeding prior outputs into dependent steps, producing real results — not more prompts to copy.
6. Screenshots corroborate items above (the OpenAI-key error, the Manual Workflow "Copy prompt" steps with "Unassigned" agents, the Code Changes plan-review flow). One screenshot pair showing a light-themed Code Changes screen was checked directly (`RemoteEditReportDetailScreen.kt` has no hardcoded colors, uses `MaterialTheme.colorScheme` throughout) — not a real bug, just the phone's theme setting at that moment.
7. **A new Claude Code skill** so a future session can operate/test this app itself rather than relying only on static code reading.

**The two largest items (3-way scope decision, all confirmed by you) compound each other**: making "still generating in the background" survive navigation *everywhere*, with full session-state resume, requires first giving the 5 chat-style generators (Project/Agent/Skill/Schedule + Manual Workflow's planning phase) a shared, process-lifetime-anchored persistence mechanism instead of each owning ephemeral per-screen/per-modal state — which directly fixes a **second bug found during investigation**: the existing `BackgroundActivityTracker` feature (built in an earlier round) is already silently broken for its 4 main registrants, because their ViewModels are scoped to the nav back-stack entry and get destroyed (unregistering) the instant the user navigates away — before the tracker could ever matter. Manual Workflow's rebuild as a persisted, desktop-resident executor then becomes a natural, easy sixth registrant of that same fixed mechanism, rather than a special case.

**Durability scope, decided during design**: no true mid-stream token-level resume exists anywhere in this codebase today on either platform (verified directly — Android's `recoverInterruptedTurns()` is crash-cleanup only, marking interrupted messages failed, not resuming them; desktop chat has no incremental DB checkpointing of streaming tokens either). This plan adds: **Level 1** — in-memory, process/WsRepository-resident accumulators (mirroring chat's existing `active-chat-turns.ts` pattern) so a UI remounting/reattaching while the app keeps running loses nothing; **Level 2** — DB checkpoints at turn/step granularity (not per-token) for crash recovery after a full restart. Exact token-level resume across a process crash is explicitly out of scope, matching Code Changes' own existing durability level.

## Validation Policy (every phase)

- **Android**: `cd android && .\gradlew.bat lint testDebugUnitTest assembleDebug`
- **Desktop**: `npm run lint && npm run typecheck && npm test && npm run build`
- New unit/Compose/Vitest tests are mandatory for every phase that introduces new logic.
- Leave changes uncommitted (matches this session's convention) unless told otherwise.

---

## Phase 1 — Code Changes: standalone-mode gating (Android)

**Goal:** Reaching Code Changes without a connected desktop shows a clear "not connected" state instead of an infinite spinner.

- `RemoteEditStartScreen.kt`, `RemoteEditReportsScreen.kt`, `RemoteEditReportDetailScreen.kt`: add `val disconnected = WsRepository.connectionState.collectAsState().value != ConnectionState.CONNECTED`, reusing the exact idiom already established in `CliModelsScreen.kt`/`McpServersScreen.kt`. When disconnected, show `NexyEmptyState("Not connected to desktop", "Code changes require an active connection to your desktop.")` in place of the list/detail content, and disable the "Create change request"/"Plan change"/refresh actions.
- Gate the second entry point too: `ChatScreen.kt`/`ChatScreenBubbles.kt`'s "Create code change" dropdown item (`onInvestigateWithAi`), matching the Home screen's per-project icon's existing `enabled = connectionState == ConnectionState.CONNECTED` pattern.
- Defense in depth for the race where connection drops mid-use (since `WsRepository.send()` silently no-ops rather than erroring): short-circuit the three screens' action handlers with a toast ("Not connected to desktop") instead of setting `isSubmitting`/`investigationRunning`/`isRefreshing` flags that would then never clear.

**Phase gate:** Android lint/test/build. New Compose test asserting each of the three screens shows the empty state and disables its primary action when disconnected. Manual/on-device (not verifiable in this environment): confirm no spinner ever hangs forever.

---

## Phase 2 — Code Changes: backend/model picker fixes (Android)

**Goal:** Match desktop's actual capability — BYOK stays, but the picker stops lying about what's available.

- `RemoteEditReportDetailScreen.kt`'s `PlanningSettingsSection`: filter the `claude-cli`/`codex-cli` entries in `PLANNING_BACKENDS` by `WsRepository.cliStatus` (only show them when actually installed), mirroring desktop's `hasBackendGroup` check in `CodeChangesScreen.tsx`. `byok` always shows.
- Replace the free-text `model` `OutlinedTextField` with the same `ModelPickerSheet` (`ui/chat/ChatScreenComponents.kt`) already used by this file's `RevisePlanControl`, bound to `WsRepository.models`/`cliStatus` and filtered to the selected backend's models (mirroring desktop's `remoteEditModelGroups` per-backend filter in `CodeChangesScreen.tsx`).

**Phase gate:** Android lint/test/build. New Compose test asserting the backend dropdown omits an uninstalled CLI and the model field opens a picker sheet rather than accepting free text.

---

## Phase 3 — Provider-routing bug fix (general, both platforms' shared main process)

**Goal:** A vendor-prefixed OpenRouter model id (or any future ambiguous id) resolves to the right provider instead of silently defaulting to OpenAI.

- `src/main/provider-registry.ts`'s `getProviderForAgent`: strip a leading `~` up front (matching `resolveToolsSupported`'s existing normalization in `src/shared/models.ts`), and check `normalizedModel.includes('/')` — an unambiguous signal of OpenRouter's `vendor/model` format, since no native provider's bare model id contains a slash — routing to `openrouter` **before** falling through to the fragile `startsWith('claude')` heuristic and the `openai` default. This removes the dependency on the live OpenRouter cache (which is only populated after a successful key *test*, not just a save) for this case entirely.
- `src/main/manual-workflow-generator.ts`'s `runManualWorkflowProviderChat`: add the same "no provider configured" guard `orchestrator.ts` already has (throw `NO_PROVIDER_CONFIGURED_MESSAGE`-equivalent before dispatching with an empty key), so a missing key fails fast with a clear message instead of reaching the real network and relaying a confusing raw provider error.

**Phase gate:** Desktop lint/typecheck/test/build. New test in `src/main/__tests__/providers.test.ts` (or a new `provider-registry.test.ts`) covering: a bare native id (`claude-haiku-4.5`) still resolves to `anthropic`; a vendor-prefixed id (`anthropic/claude-haiku-4.5`) resolves to `openrouter` regardless of cache state; a `~`-prefixed variant normalizes the same way. New test asserting `runManualWorkflowProviderChat` throws a clear configured-provider error rather than dispatching with an empty key.

---

## Phase 4 — Shared generator-session persistence + app-wide background-activity resume (Android + Desktop)

**Goal:** Fix the existing navigate-away-destroys-everything bug for real, and make "still generating" visible and resumable from any screen on both platforms.

### Foundation: `generator_sessions` (new shared table, one migration, not five bespoke ones)

Migration version 60 in `database-migrations.ts` (append-only, current max is 59):
```sql
CREATE TABLE IF NOT EXISTS generator_sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('project','agent','skill','schedule','manual-workflow')),
  scope_id TEXT,                              -- projectId for 'manual-workflow'; NULL for the other four
  status TEXT NOT NULL CHECK (status IN ('idle','streaming','awaiting-input','spec-ready','creating','done','error','cancelled')) DEFAULT 'idle',
  messages_json TEXT NOT NULL DEFAULT '[]',   -- committed turns only
  streaming_text TEXT NOT NULL DEFAULT '',    -- last turn-granular checkpoint (Level 2)
  spec_json TEXT,
  model TEXT,
  resolved_model TEXT,
  result_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_generator_sessions_kind_scope ON generator_sessions(kind, scope_id, updated_at DESC);
```
Verified only `manual-workflow` needs `scope_id` (a `projectId`) — the other four generator chat functions (`runProjectGeneratorChat`, `runAgentGeneratorChat`, `runSkillGeneratorChat`, `runScheduleGeneratorChat`) take no project scope today.

### Desktop main process

- New `src/main/generator-sessions.ts`: an in-memory `Map<sessionId, GeneratorSessionState>` (Level 1 — same shape as the existing `active-chat-turns.ts`), backed by turn/status-granular writes to `generator_sessions` (Level 2). Exports `createGeneratorSession`, `appendUserMessage`, `appendStreamingChunk` (memory only), `commitAssistantTurn` (memory + DB), `setSpec`, `setStatus` (memory + DB), `getGeneratorSession` (memory else last DB checkpoint — the rehydrate path), `findActiveGeneratorSession(kind, scopeId)`, `deleteGeneratorSession`. Calls into the existing, untouched per-kind chat functions and per-kind "create real entity from spec" functions — this is a thin envelope, not a reimplementation of any generator's prompt/parsing logic.
- New `src/main/generator-session-handlers.ts`: `registerGeneratorSessionHandlers(win)`.
- `src/shared/types.ts`: add `GeneratorSessionKind/Status/Message/Snapshot/Patch` types; replace the ~10 existing per-kind `*-generator:chat/token/spec-ready/done/get-model/set-model` channel entries with 6 generic ones (`generator-session:start/send-message/get/find-active/confirm-spec/cancel` + push-only `generator-session:updated`) plus 2 generic model-default channels (`generator:get-default-model`/`generator:set-default-model`, args include `kind`).
- `src/main/ws-handlers.ts`: replace the per-kind `*-generator:*` branches (including `manual-workflow-generator:start/message/cancel/get-model/set-model`) with the 6 generic `generator-session:*` branches.
- `src/preload/index.ts`: replace the ~30 per-kind wrappers with the generic set (`startGeneratorSession`, `sendGeneratorSessionMessage`, `getGeneratorSession`, `findActiveGeneratorSession`, `confirmGeneratorSpec`, `cancelGeneratorSession`, `onGeneratorSessionUpdated`, `getGeneratorDefaultModel`, `setGeneratorDefaultModel`).
- `src/main/ipc-handlers.ts`: swap the five `register*GeneratorHandlers` calls for one `registerGeneratorSessionHandlers`.

### Desktop renderer

- New `src/renderer/hooks/useGeneratorSession.ts`: rehydrates via `findActiveGeneratorSession` on mount, subscribes to `onGeneratorSessionUpdated` filtered by session id, exposes `{ session, sendMessage, confirmSpec, cancel }`.
- `ProjectGeneratorModal.tsx`, `AgentGeneratorModal.tsx`, `SkillGeneratorModal.tsx`, `ScheduleGeneratorModal.tsx`: delete each file's module-level `_session`/`getSession`/`saveSession` singleton and local streaming/listener-teardown state; use `useGeneratorSession(kind, null)` instead.
- `src/renderer/components/project-settings/WorkflowTab.tsx`: its chat portion switches to `useGeneratorSession('manual-workflow', projectId)`.
- New `src/renderer/store/slices/backgroundActivitySlice.ts` (registered in `app-store.ts` like `uiSlice`): `{ backgroundActivities: BackgroundActivity[] }` where `BackgroundActivity = { id, label, route }` and `route` is a discriminated union (`generator-session` / `code-change` / `manual-workflow-run`, the last added in Phase 5). Actions: `upsertBackgroundActivity`, `removeBackgroundActivity`.
- New `src/renderer/components/BackgroundActivityBridges.tsx`: renders nothing, mounted once as a permanent sibling in `App.tsx`. Independent `onGeneratorSessionUpdated` subscription (separate from any open modal's own hook instance) upserting/removing store entries by status. Second effect subscribes to a new small additive IPC channel `remote-edit:list-active-code-changes` (`{ reportId, projectId, title }[]`, new handler in `remote-edit-handlers.ts` reusing the existing `activeInvestigations` set — the existing count-only `active-code-changes-changed` channel is untouched since `ProjectsPane.tsx` still depends on it as-is).
- New `src/renderer/components/BackgroundActivityDock.tsx`: reads the slice, renders a small fixed-position stack; mounted as a permanent sibling in `App.tsx` alongside `BackgroundActivityBridges`, outside the lazy `<Suspense>` block.
- `uiSlice.ts`: add `pendingGeneratorSessionToResume`/`pendingManualWorkflowRunId` (+ setters) for click-through, alongside the existing `pendingRemoteEditReportId`/`pendingCodeChangesProjectId` pattern the dock reuses for code-change activities.

### Android

- `WsRepository.kt`: add `_generatorSessions: MutableStateFlow<Map<String, GeneratorSessionInfo>>`, populated by new `GeneratorSessionUpdated`/`GeneratorSessionSnapshot` `WsEvent` cases (replacing the removed `ManualWorkflowToken`/`Message`/etc. cases). Add `startGeneratorSession`/`sendGeneratorSessionMessage`/`findActiveGeneratorSession`/`confirmGeneratorSpec`/`cancelGeneratorSession`, replacing `startManualWorkflow`/`sendManualWorkflowMessage`. **The actual bug fix**: add a `scope.launch { }` in `WsRepository`'s existing `init {}` — sibling to the current Manual-Workflow one — that registers/unregisters `BackgroundActivityTracker` off `_generatorSessions` entries with `status == "streaming"`. Both the session data and its tracker registration move from ViewModel-owned (destroyed on `onCleared()`) to `WsRepository`-owned (process-lifetime), mirroring how Manual Workflow's session already correctly works today.
- `WsEvent.kt`/`WsEventParser.kt`: add the new sealed cases, remove the retired per-kind ones.
- `ProjectGeneratorViewModel.kt`, `AgentGeneratorViewModel.kt`, `SkillGeneratorViewModel.kt`, `ScheduleGeneratorViewModel.kt`: `uiState` becomes derived (`.map`) from `WsRepository.generatorSessions[activeSessionId]` instead of owning `_uiState` as source of truth; `init {}` calls `findActiveGeneratorSession` to adopt a resumable session. Delete the `BackgroundActivityTracker.register/unregister` calls and the `onCleared()` overrides (registration now lives solely in `WsRepository`).
- `ManualWorkflowScreen.kt`: its chat/spec-preview portion switches from `WsRepository.manualWorkflowSession` to the generic `generatorSessions` map.
- `NavGraph.kt`: change to accept a hoisted `navController: NavHostController` parameter instead of creating its own internally.
- New `android/app/src/main/java/io/nexy/android/navigation/AppShell.kt`: creates the `NavHostController`, renders `NavGraph(navController, ...)` inside a `Box`, overlays a new bottom-aligned `BackgroundActivityDock` composable fed by `BackgroundActivityTracker.activities`, `onOpenActivity = { navController.navigate(it.route) }`.
- `MainActivity.kt`: `setContent { NexyTheme(darkTheme) { NavGraph(...) } }` → `AppShell(...)`.
- New `android/app/src/main/java/io/nexy/android/ui/home/BackgroundActivityDock.kt` (separate from `StatusActivityBar.kt` — different layout needs as a floating overlay vs. a full-width in-flow strip).
- `StatusActivityBar.kt` / `HomeScreen.kt:549-558`: remove the now-redundant `backgroundActivities` rendering (the new global dock covers Home too); leave the connectivity/sync rows untouched.

**Known simplification (flagged, not hidden):** cancellation is best-effort everywhere — neither `dispatchToProvider` nor the CLI adapters expose a real abort signal today; cancelling stops relaying output and marks the row cancelled, but the underlying call may finish server-side regardless. Threading a real abort signal through is out of scope for this round.

**Phase gate:**
- Desktop: lint/typecheck/test/build. New Vitest coverage for `generator-sessions.ts` (create/append/commit/status transitions, rehydrate-from-DB-when-not-in-memory) and for the provider-routing test from Phase 3 if not already covered. Extend/replace the 4 generator modals' existing tests for the new hook-based data flow.
- Android: lint/test/build. New unit test proving a generator's `BackgroundActivityTracker` registration survives a simulated ViewModel recreation (registration driven by `WsRepository`, not the ViewModel). New Compose test for `BackgroundActivityDock` rendering + tap-through.
- Manual/on-device (not verifiable in this environment): start a Project/Agent/Skill/Schedule generator chat, navigate away mid-stream and back on Android; close and reopen the modal mid-stream on desktop — confirm the conversation and streaming state are both still there, and the dock/bar shows a real, tap-through-resumable entry from any other screen.

---

## Phase 5 — Manual Workflow: automatic step-chaining executor (Android + Desktop)

**Goal:** Once a plan is generated, the app executes it automatically — sequential completion calls per step (no native tool-calling required), each step's output feeding any step that declares it as a dependency, with real per-step results instead of copy-paste prompts.

### Ordering & prompt-weaving rules

- Steps with declared `dependsOnStepIds` anywhere in the plan → topological sort (Kahn's algorithm); a dependency cycle is a hard validation error surfaced before execution starts.
- No declared deps (today's common case) → strictly sequential in listed order.
- A dependent step's user turn is prefixed with each dependency's title + output (truncated ~6000 chars) under a `## Context from step '<title>'` heading, followed by `## Your task:` + the step's own prompt. Independent steps send their prompt unchanged. Each step is one independent completion call — no growing cross-step chat history.
- Model/backend per step: if `step.agentId` is set and that agent pins a `backend`/`cliModel` (CLI), use it; otherwise use the workflow-level model chosen at execution start. Either way, if `step.agentId` is set, that agent's `systemPrompt` is layered into the step's system prompt (`AgentConfig.model` is deprecated — a pinned CLI backend is the only concrete "the agent's model" left to honor).
- On any step failure, the run halts rather than continuing independent branches (v1 simplification — the ask is "retry from a failed step," which implies stopping there).

### New DB schema (two tables — steps are independently queried/updated/retried, unlike the flat `generator_sessions` blob)

Migration version 61:
```sql
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_session_id TEXT,
  title TEXT NOT NULL,
  goal_summary TEXT NOT NULL DEFAULT '',
  assumptions_json TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','running','paused','done','failed','cancelled')) DEFAULT 'pending',
  current_step_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  started_at INTEGER,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_project ON workflow_runs(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workflow_run_steps (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  agent_name TEXT,
  prompt TEXT NOT NULL,
  expected_output TEXT NOT NULL DEFAULT '',
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('pending','running','done','failed','skipped')) DEFAULT 'pending',
  output TEXT NOT NULL DEFAULT '',
  error TEXT,
  resolved_backend TEXT,
  resolved_model TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  completed_at INTEGER,
  PRIMARY KEY (run_id, id)
);
CREATE INDEX IF NOT EXISTS idx_workflow_run_steps_run ON workflow_run_steps(run_id, sort_order);
```

### New/modified files

- New `src/main/prompt-chain-runner.ts`: shared dual-dispatch helper (CLI-prefix → adapter `.send()`; else → `dispatchToProvider` with empty `toolDefs`) extracted from `manual-workflow-generator.ts`'s existing `runManualWorkflowProviderChat`, reused by both Phase 4's generator chats and this executor — one dispatch primitive, not two near-duplicates. Must call the *fixed* `getProviderForAgent` from Phase 3.
- New `src/main/workflow-executor.ts`: `activeRuns`/`runProgress` (Level 1, mirrors `remote-edit-handlers.ts`'s existing `activeInvestigations` shape). Exports `startWorkflowRun`, `retryStep(runId, stepId)` (resets that step **and every step that transitively depends on it**, bumping `attempt`, leaving unrelated earlier steps untouched), `getWorkflowRunSnapshot` (DB + live progress merged — the rehydrate path), `listWorkflowRuns(projectId)`.
- New `src/main/workflow-handlers.ts`: `registerWorkflowHandlers`, new WS/IPC surface: `workflow:create-from-spec`, `workflow:start`, `workflow:retry-step`, `workflow:cancel`, `workflow:get`, `workflow:list`, push-only `workflow:run-updated`.
- `src/renderer/components/BackgroundActivityBridges.tsx` (from Phase 4): third `useEffect` subscribing to `workflow:run-updated`, upserting `{ label: 'Running workflow: <title> (step N/M)', route: { kind: 'manual-workflow-run', ... } }`.
- New `src/renderer/hooks/useWorkflowRun.ts` + new `src/renderer/components/project-settings/WorkflowRunView.tsx` (modeled on `CodeChangeDetailView.tsx`: step list, status icons, expandable output, retry button on failed steps). `WorkflowTab.tsx`'s per-step "Start in chat" buttons become one "Start execution" button; the tab renders `<WorkflowRunView>` once a run exists.
- Android: `WsRepository.kt` gains `_workflowRuns: MutableStateFlow<Map<String, WorkflowRunInfo>>` + the same `BackgroundActivityTracker` registration pattern as Phase 4's generator sessions, route `"manual-workflow-run/{runId}"`. New `WsEvent`/`WsEventParser` cases (`WorkflowRunUpdated`, `WorkflowSnapshot`, `WorkflowListResult`). New `ManualWorkflowRunScreen.kt` + route in `NavGraph.kt`, new thin `ManualWorkflowRunViewModel`. `ManualWorkflowScreen.kt` gains a "Start execution" primary action alongside "Copy prompt" (kept for transparency/manual inspection).

**Phase gate:**
- Desktop: lint/typecheck/test/build. New Vitest coverage for `workflow-executor.ts`: topological ordering (including cycle rejection), prompt-weaving for a dependent step, `retryStep` resetting only the target + downstream steps, halt-on-failure. New coverage for `prompt-chain-runner.ts`'s dispatch branching.
- Android: lint/test/build. New unit tests mirroring the desktop ones for any Android-side pure logic (e.g. step-status derivation for the run screen). New Compose test for `ManualWorkflowRunScreen` rendering step statuses and a working retry action.
- Manual/on-device (not verifiable in this environment): generate a plan with 3+ steps including at least one dependency, start execution, confirm steps run in order with dependency context flowing through, fail one deliberately (e.g. bad model), retry it, confirm only downstream steps re-run.

---

## Phase 6 — Self-testing Claude skill

**Goal:** A reusable skill so a future Claude Code session can operate/verify this app itself, not just read code.

- New `.claude/skills/nexy-app-check/SKILL.md` (project-level, per Anthropic's current skill format: directory name is the invocable name, `description` frontmatter drives when Claude proactively loads it, keep the body under ~500 lines). Content: how to start the dev server (`npm run dev`) and the two validation gates (Android `lint testDebugUnitTest assembleDebug`, desktop `lint && typecheck && test && build`); how to build/install/launch the Android debug APK and pull logs via `adb` when a device/emulator is actually available; how to pair Android with a locally-running desktop instance for connected-mode manual testing; where debug logs live (`Settings → Developer → Debug log` per `docs/android-standalone.md`); and an explicit, honest note on this session's confirmed environment constraints (no Android emulator/device available by default, so on-device/visual verification must be called out as unverified rather than claimed; `compileDebugAndroidTestKotlin` has a pre-existing, unrelated Compose-test dependency-resolution failure that predates this work).

**Phase gate:** No code validation gate applies (it's a skill file, not app code) — read it back once written and confirm it's under the line-count guidance and doesn't duplicate CLAUDE.md content verbatim.

---

## Phase 7 — Final regression

- Re-run both validation gates end-to-end across the whole branch (Android: `lint testDebugUnitTest assembleDebug`; Desktop: `lint && typecheck && test && build`).
- Manually re-walk all 7 items against the running apps where this environment allows it; call out explicitly anything that could only be verified by code/test inspection rather than live use (no emulator/device in this environment, matching every prior round).
- Update `docs/android-standalone.md` for the Code Changes gating change, the provider-routing fix, and Manual Workflow's new execution model.

**Leave changes uncommitted** (matches this session's established convention) unless told otherwise.
