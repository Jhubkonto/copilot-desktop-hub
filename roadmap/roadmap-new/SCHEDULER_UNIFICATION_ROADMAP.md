# Roadmap: Scheduler Unification + AI Schedule Generator

## Context

The Scheduler feature exists but is a visual and architectural orphan. It uses purple accents while every other section (Projects, Agents, Skills) uses indigo. Its create button lives in a footer instead of the header. It has no AI-powered generator despite Projects, Agents, and Skills all having identical 3-phase chat-based generators. The store manages its state inline rather than via a dedicated slice. This roadmap unifies Scheduler into the same look/feel/behaviour and adds a `ScheduleGeneratorModal` (desktop) and `ScheduleGeneratorScreen` (Android) using the exact same pattern as the existing generators.

---

## Phase 0 — Audit & Gap Inventory

Establish a precise written gap list before touching any code.

### Checklist
- [ ] Read `ScheduledPane.tsx` header/footer and note every `purple-*` class and the footer create button block to remove
- [ ] Read `AgentsPane.tsx` and `SkillsPane.tsx` header rows — copy exact class strings to use in ScheduledPane
- [ ] Read `src/renderer/store/slices/skillSlice.ts` — confirm `showSkillGenerator` / `setShowSkillGenerator` shape to mirror
- [ ] Read `src/main/skill-generator.ts` — confirm full pattern: system prompt, `SPEC_OPEN_TAG`, `extractSpec`, `normalizeSpec`, `runXForAndroid`, `broadcastToMobile`, `registerXHandlers`
- [ ] Confirm all `IpcReturnMap` + `IpcChannels` entries that need to be added (6 new channels)
- [ ] Read `android/.../data/model/WsEvent.kt` lines for `SkillGeneratorToken` through `SkillGeneratorCancelled` — these are the exact names to mirror for `SchedulerGenerator*`
- [ ] Read `android/.../data/WsEventParser.kt` — confirm the `skill-generator:*` parsing block to mirror for `scheduler-generator:*`
- [ ] Read `android/.../ui/agentgenerator/AgentGeneratorViewModel.kt` — confirm ViewModel pattern (`ScheduleGenPhase`, `UiState`, `init` WsEvent collection)
- [ ] Read `android/.../ui/schedulegenerator/` — confirm it does NOT exist (no regressions to worry about)

### End-of-Phase Protocol
- `npm run typecheck` — baseline, zero errors
- `npm run lint` — baseline, zero errors
- `npm run build` — baseline, clean compile
- `./gradlew assembleDebug` — Android baseline, clean compile

---

## Phase 1 — Shared Type Additions (Desktop)

All downstream phases depend on the TypeScript type layer. No UI changes; can be merged standalone.

**Files:** `src/shared/types.ts`

### Checklist
- [ ] After the `SkillGeneratorMessage` interface block, add:
  ```typescript
  export interface ScheduleGeneratorSpec {
    name: string
    prompt: string
    scheduleType: ScheduleType
    localTime: string        // HH:MM
    weekday?: number
    monthDay?: number
    timezone: string
    agentId?: string
    projectId?: string
    notificationPref: 'always' | 'failures_only' | 'off'
  }

  export interface ScheduleGeneratorMessage {
    role: 'user' | 'assistant'
    content: string
  }
  ```
- [ ] In `IpcReturnMap`, after the `skill-generator` block, add:
  ```typescript
  'scheduler-generator:chat': { started: boolean }
  'scheduler-generator:token': void
  'scheduler-generator:spec-ready': void
  'scheduler-generator:done': void
  'scheduler-generator:get-model': string
  'scheduler-generator:set-model': void
  ```
- [ ] In the `IpcChannels` union, after `'skill-generator:set-model'`, add the same 6 channel strings

### End-of-Phase Protocol
- `npm run typecheck` — zero errors
- `npm run lint` — zero errors
- `npm run build` — clean compile

---

## Phase 2 — Backend: `scheduler-generator.ts` + IPC Registration

Create the main-process AI generator logic, following `skill-generator.ts` exactly.

**Files:**
- `src/main/scheduler-generator.ts` _(create)_
- `src/main/ipc-handlers.ts` _(add import + call)_

### Checklist
- [ ] Create `src/main/scheduler-generator.ts`:
  - [ ] Define `SPEC_OPEN_TAG = '<schedule-spec>'` and `SPEC_CLOSE_TAG = '</schedule-spec>'`
  - [ ] Write `SCHEDULE_GENERATOR_SYSTEM_PROMPT` — instructs the LLM to gather: task name, prompt text, schedule type (one-time/daily/weekdays/weekly/monthly), time (HH:MM), timezone, optional agent, optional project, notification preference; emit spec wrapped in open/close tags
  - [ ] Implement `extractSpec(text): ScheduleGeneratorSpec | null` — parses the JSON block between the tags
  - [ ] Implement `normalizeSpec(raw): ScheduleGeneratorSpec` — validates `scheduleType` against `ScheduleType`, validates `localTime` format, defaults `notificationPref` to `'always'`
  - [ ] Implement `getScheduleGeneratorModel()` / `setScheduleGeneratorModel()` — module-level `_scheduleGeneratorModel`, identical to `getSkillGeneratorModel()`
  - [ ] Implement `runScheduleGeneratorChat(win, messages, modelOverride?)` — calls provider, streams `scheduler-generator:token` to renderer, emits `scheduler-generator:spec-ready` and `scheduler-generator:done`
  - [ ] Implement `runScheduleGeneratorChatForAndroid(messages, sessionId?, modelOverride?)` — uses `broadcastToMobile` for each event (mirrors `runSkillGeneratorChatForAndroid`)
  - [ ] Implement `createScheduleFromSpec(spec: ScheduleGeneratorSpec): Promise<{ taskId: string; name: string }>` — calls existing `createScheduledTask` from `scheduler-handlers.ts`
  - [ ] Export `registerScheduleGeneratorHandlers(win?)` — registers `safeHandle` for `scheduler-generator:chat`, `scheduler-generator:get-model`, `scheduler-generator:set-model`
- [ ] In `src/main/ipc-handlers.ts`:
  - [ ] Add `import { registerScheduleGeneratorHandlers } from './scheduler-generator'`
  - [ ] Call `registerScheduleGeneratorHandlers(mainWindow)` after `registerSkillGeneratorHandlers(mainWindow)`

### End-of-Phase Protocol
- `npm run typecheck` — zero errors
- `npm run lint` — zero errors
- `npm run build` — clean compile (main process)
- `npx vitest run src/main/__tests__/scheduler-generator.test.ts` — write and pass at minimum: spec extraction, spec normalization, invalid spec rejection

---

## Phase 3 — Preload API Bridge

Expose the new channels to the renderer via the preload script.

**Files:** `src/preload/index.ts`

### Checklist
- [ ] Import `ScheduleGeneratorSpec` and `ScheduleGeneratorMessage` from `'../shared/types'` (add to existing import)
- [ ] After the `skill-generator` preload block, add:
  - [ ] `scheduleGeneratorChat(messages, modelOverride?)` → `typedInvoke('scheduler-generator:chat', ...)`
  - [ ] `onScheduleGeneratorToken(callback)` → `typedOn` + cleanup pattern
  - [ ] `onScheduleGeneratorSpecReady(callback)` → `typedOn` + cleanup
  - [ ] `onScheduleGeneratorDone(callback)` → `typedOn` + cleanup
  - [ ] `getScheduleGeneratorModel()` → `typedInvoke('scheduler-generator:get-model')`
  - [ ] `setScheduleGeneratorModel(modelId)` → `typedInvoke('scheduler-generator:set-model', modelId)`

### End-of-Phase Protocol
- `npm run typecheck` — zero errors (catches any channel-name mismatches)
- `npm run lint` — zero errors
- `npm run build` — clean compile

---

## Phase 4 — Store Slice: `schedulerSlice`

Extract scheduler state into a proper Zustand slice with `showSchedulerGenerator`, matching `skillSlice.ts`.

**Files:**
- `src/renderer/store/slices/schedulerSlice.ts` _(create)_
- `src/renderer/store/app-store.ts` _(update)_

### Checklist
- [ ] Create `src/renderer/store/slices/schedulerSlice.ts`:
  - [ ] Define `SchedulerSlice` interface: `schedulerTasks`, `setSchedulerTasks`, `showSchedulerGenerator`, `setShowSchedulerGenerator`
  - [ ] Export `createSchedulerSlice` implementing the interface
- [ ] In `src/renderer/store/app-store.ts`:
  - [ ] Import `createSchedulerSlice` and `SchedulerSlice`
  - [ ] Add `SchedulerSlice` to the `AppState` type intersection
  - [ ] Replace the inline `schedulerTasks` / `setSchedulerTasks` with `...createSchedulerSlice(set, get, store)`
  - [ ] Ensure `hydrate()` still calls `setSchedulerTasks(result)` via the slice setter

### End-of-Phase Protocol
- `npm run typecheck` — zero errors (all existing consumers of `schedulerTasks` / `setSchedulerTasks` must still resolve)
- `npm run lint` — zero errors
- `npm run build` — clean compile
- `npm test` — full suite passes, no regressions

---

## Phase 5 — Desktop UI Unification: ScheduledPane

Restyle `ScheduledPane.tsx` to match the indigo/header-button pattern. No new generator features in this phase — purely visual alignment and store wiring.

**Files:** `src/renderer/components/section-pane/ScheduledPane.tsx`

### Checklist
- [ ] Add `Sparkles` to the lucide-react import
- [ ] Pull `showSchedulerGenerator`, `setShowSchedulerGenerator` from the store (via `useAppStore`)
- [ ] Remove the bottom footer `<div className="p-2 border-t ...">` create button block entirely
- [ ] Add a header row at the top (matching `AgentsPane` / `SkillsPane`):
  ```jsx
  <div className="flex items-center justify-between px-4 h-9 border-b border-gray-100 dark:border-gray-800">
    <span className="text-xs text-gray-400 dark:text-gray-500">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</span>
    <div className="flex items-center gap-1">
      <button onClick={() => setShowSchedulerGenerator(true)}
        className="flex items-center gap-1 text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
        <Sparkles className="w-3.5 h-3.5" />Generate
      </button>
      <button onClick={() => { setEditTask(null); setShowForm(true) }}
        className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
        <Plus className="w-3.5 h-3.5" />New
      </button>
    </div>
  </div>
  ```
- [ ] Replace all remaining `purple-*` class occurrences with `indigo-*` equivalents
- [ ] Move the filter tabs bar below the new header row

### End-of-Phase Protocol
- `npm run typecheck` — zero errors
- `npm run lint` — zero errors
- `npm run build` — clean compile
- Visual inspection: header matches `AgentsPane` exactly; no purple anywhere in pane
- `npm test` — full suite passes

---

## Phase 6 — Desktop UI: `ScheduleGeneratorModal` + `App.tsx` wiring

Create the full generator modal (two-column, 38%/62% layout) following `SkillGeneratorModal.tsx` exactly, and wire it into `App.tsx`.

**Files:**
- `src/renderer/components/ScheduleGeneratorModal.tsx` _(create)_
- `src/renderer/App.tsx` _(add lazy import + conditional render)_

### Checklist
- [ ] Create `src/renderer/components/ScheduleGeneratorModal.tsx`:
  - [ ] Module-level `_session` for persistence (same pattern as `SkillGeneratorModal`)
  - [ ] `DraftPreview` sub-component (left 38%): shows spec fields (name, schedule type, time, timezone, agent, notification pref) when spec is non-null; otherwise shows `<Sparkles>` placeholder
  - [ ] `ChatBubble` sub-component: user/assistant variants, identical to `SkillGeneratorModal`
  - [ ] `EditForm` sub-component: name input, prompt textarea, scheduleType selector (one-time/daily/weekdays/weekly/monthly), localTime time picker, timezone selector (defaulting to `Intl.DateTimeFormat().resolvedOptions().timeZone`), weekday/monthDay conditionals, agentId dropdown (from store `agents`), projectId dropdown (from store `projects`), notificationPref radio group
  - [ ] `CreationOverlay` sub-component: progress indicator during task creation
  - [ ] Main modal component state: `messages`, `spec`, `streamingText`, `inputText`, `isEditing`, `editSpec`, `creationStep`, `creationError`
  - [ ] `useEffect` subscribing to `window.api.onScheduleGeneratorToken`, `onScheduleGeneratorSpecReady`, `onScheduleGeneratorDone`
  - [ ] `sendMessage()` calls `window.api.scheduleGeneratorChat(messages, genModel)`
  - [ ] `handleCreate(spec)` calls `window.api.schedulerCreate(specToTaskInput(spec))`, refreshes scheduler tasks in store, shows toast, closes modal
  - [ ] Spec-ready action bar: "Edit" button + "Create task" (indigo primary) button
  - [ ] "Start over" and "Set up manually" in header row
  - [ ] `ModelPicker` + `VoiceInputButton` in input footer (same as `SkillGeneratorModal`)
  - [ ] Dark-mode support throughout
- [ ] In `src/renderer/App.tsx`:
  - [ ] Add lazy import: `const ScheduleGeneratorModal = lazy(() => import('./components/ScheduleGeneratorModal')...)`
  - [ ] Pull `showSchedulerGenerator`, `setShowSchedulerGenerator` from store
  - [ ] In the `<Suspense>` block add: `{showSchedulerGenerator && <ScheduleGeneratorModal onClose={() => setShowSchedulerGenerator(false)} />}`

### End-of-Phase Protocol
- `npm run typecheck` — zero errors
- `npm run lint` — zero errors
- `npm run build` — clean compile
- `npm test` — full suite passes
- Smoke test desktop app:
  - [ ] Click "Generate" in Scheduled pane → modal opens with two-column layout
  - [ ] Type a message → tokens stream into right column, left column shows spec draft when ready
  - [ ] Spec-ready bar appears → "Edit" and "Create task" buttons visible
  - [ ] "Create task" → task appears in list, toast shown, modal closes
  - [ ] "New" button → inline `SchedulerTaskForm` opens (legacy flow unchanged)
  - [ ] Existing Project/Agent/Skill generators unaffected

---

## Phase 7 — Android: Data Layer (WsEvent + WsRepository + WsEventParser)

Add Android WebSocket plumbing before any UI. Strictly data-layer work.

**Files:**
- `android/.../data/model/WsEvent.kt`
- `android/.../data/model/ScheduleGeneratorSpec.kt` _(create)_
- `android/.../data/WsEventParser.kt`
- `android/.../data/WsRepository.kt`

### Checklist
- [ ] Create `android/.../data/model/ScheduleGeneratorSpec.kt`:
  ```kotlin
  data class ScheduleGeneratorSpec(
      val name: String,
      val prompt: String,
      val scheduleType: String,
      val localTime: String,
      val weekday: Int? = null,
      val monthDay: Int? = null,
      val timezone: String,
      val agentId: String? = null,
      val projectId: String? = null,
      val notificationPref: String = "always",
  )
  ```
- [ ] In `WsEvent.kt`, after the `SkillGeneratorCancelled` block, add 7 sealed subclasses:
  - `SchedulerGeneratorToken(sessionId, chunk)`
  - `SchedulerGeneratorTurnComplete(sessionId, content, hasSpec)`
  - `SchedulerGeneratorSpecReady(sessionId, spec: ScheduleGeneratorSpec)`
  - `SchedulerGeneratorCreated(sessionId, taskId, name)`
  - `SchedulerGeneratorError(sessionId, message)`
  - `SchedulerGeneratorCancelled(sessionId)`
  - `SchedulerGeneratorModel(sessionId, modelId)`
- [ ] In `WsEventParser.kt`, mirror the `skill-generator:*` parsing block for `scheduler-generator:token`, `scheduler-generator:turn-complete`, `scheduler-generator:spec-ready`, `scheduler-generator:created`, `scheduler-generator:error`, `scheduler-generator:cancelled`, `scheduler-generator:model`
- [ ] In `WsRepository.kt`, after the existing scheduler CRUD methods, add:
  - [ ] `schedulerGeneratorStart(sessionId, messages)`
  - [ ] `schedulerGeneratorMessage(sessionId, messages)`
  - [ ] `schedulerGeneratorConfirm(sessionId, spec)`
  - [ ] `schedulerGeneratorCancel(sessionId)`
  - [ ] `schedulerGeneratorGetModel(sessionId)`
  - [ ] `schedulerGeneratorSetModel(sessionId, modelId)`
  - [ ] `fun ScheduleGeneratorSpec.toPayload(): Map<String, Any>` extension for payload serialization

### End-of-Phase Protocol
- `./gradlew assembleDebug` — zero compile errors
- `./gradlew test` — unit tests pass

---

## Phase 8 — Desktop: Android WebSocket Bridge for Scheduler Generator

Route Android WebSocket commands to `scheduler-generator.ts` on the desktop side. Follows the exact pattern used for `skill-generator` Android routing.

**Files:** `src/main/android-handlers.ts` (or wherever `skill-generator:start` is handled — confirm during Phase 0 audit)

### Checklist
- [ ] Locate the handler block for `skill-generator:start`, `skill-generator:message`, `skill-generator:confirm`, `skill-generator:cancel` in the desktop WebSocket handler
- [ ] Add equivalent cases for:
  - [ ] `scheduler-generator:start` → `runScheduleGeneratorChatForAndroid`
  - [ ] `scheduler-generator:message` → continue chat session
  - [ ] `scheduler-generator:confirm` → `createScheduleFromSpec` + broadcast `scheduler-generator:created`
  - [ ] `scheduler-generator:cancel` → cancel session
  - [ ] `scheduler-generator:get-model` → broadcast current model
  - [ ] `scheduler-generator:set-model` → `setScheduleGeneratorModel`

### End-of-Phase Protocol
- `npm run typecheck` — zero errors
- `npm run lint` — zero errors
- `npm run build` — clean compile
- Integration smoke: Android sends `scheduler-generator:start` → desktop receives it → `scheduler-generator:token` events broadcast back via WebSocket

---

## Phase 9 — Android: `ScheduleGeneratorViewModel`

**Files:** `android/.../ui/schedulegenerator/ScheduleGeneratorViewModel.kt` _(create)_

### Checklist
- [ ] Define `ScheduleGenPhase` enum: `CHAT`, `SPEC_REVIEW`, `DONE`
- [ ] Define `ScheduleGeneratorUiState` data class: `phase`, `messages`, `streamingText`, `pendingSpec`, `isLoading`, `error`, `createdTaskName`, `createdTaskId`, `activeSessionId`, `selectedModel`, `resolvedModel`
- [ ] Define `ScheduleGenMessage(role, content)` data class
- [ ] Implement `ScheduleGeneratorViewModel`:
  - [ ] `init` block collects all 7 `SchedulerGenerator*` WsEvents from `WsRepository` — identical logic to `AgentGeneratorViewModel`
  - [ ] `sendMessage(content)` — `schedulerGeneratorStart` on first message, `schedulerGeneratorMessage` on subsequent turns
  - [ ] `confirmSpec()` — calls `schedulerGeneratorConfirm`
  - [ ] `reset()` — calls `schedulerGeneratorCancel`, resets `_uiState`
  - [ ] `updateSpec(spec)`, `backToChat()`, `setupManually()`, `retryLastMessage()`, `dismissError()`, `insertPromptText(body)`

### End-of-Phase Protocol
- `./gradlew assembleDebug` — zero compile errors
- `./gradlew test` — ViewModel unit tests pass (mirror `AgentGeneratorViewModelTest` if it exists)

---

## Phase 10 — Android: `ScheduleGeneratorScreen`

**Files:** `android/.../ui/schedulegenerator/ScheduleGeneratorScreen.kt` _(create)_

### Checklist
- [ ] Create `ScheduleGeneratorScreen(onBack: () -> Unit, viewModel: ScheduleGeneratorViewModel)` composable
- [ ] `CHAT` phase:
  - [ ] `NexyTopAppBar` with back/close button + "Start over" TextButton action
  - [ ] `LazyColumn` of `ChatBubble` composables (user/assistant)
  - [ ] Streaming text indicator when `streamingText` is non-empty
  - [ ] `ChatInputBar` at bottom with send button
  - [ ] Model picker in input row
- [ ] `SPEC_REVIEW` phase:
  - [ ] Scrollable form for all spec fields: name (TextField), prompt (multiline TextField), scheduleType (SegmentedButton or RadioGroup), localTime (time picker row), timezone (dropdown or text field), weekday/monthDay (conditional rows), agentId dropdown (from `WsRepository.agents`), projectId dropdown (from `WsRepository.projects`), notificationPref (RadioGroup)
  - [ ] "Create task" (primary) + "Back to chat" (secondary) action buttons at bottom
- [ ] `DONE` phase:
  - [ ] Success card showing created task name
  - [ ] "Done" button that calls `onBack()`
- [ ] `SnackbarHost` for error feedback
- [ ] `NexyConfirmDialog` for "reset" confirmation when clearing in-progress chat

### End-of-Phase Protocol
- `./gradlew assembleDebug` — zero compile errors
- Visual inspection: screen matches `AgentGeneratorScreen` structure and style

---

## Phase 11 — Android: Navigation + ScheduledScreen Header Button

Wire the new screen into the nav graph and add the "Generate" entry point.

**Files:**
- `android/.../navigation/NavGraph.kt`
- `android/.../ui/scheduler/ScheduledScreen.kt`

### Checklist
- [ ] In `NavGraph.kt`:
  - [ ] Add import for `ScheduleGeneratorScreen`
  - [ ] Add composable route: `composable("scheduled/generator") { ScheduleGeneratorScreen(onBack = { navController.popBackStack() }) }`
  - [ ] Pass `onOpenGenerator = { navController.navigate("scheduled/generator") }` to `ScheduledScreen` at its route site
- [ ] In `ScheduledScreen.kt`:
  - [ ] Add `onOpenGenerator: () -> Unit` parameter
  - [ ] Add generator icon action to `TopAppBar` actions:
    ```kotlin
    IconButton(onClick = onOpenGenerator) {
        Icon(Icons.Filled.AutoAwesome, contentDescription = "Generate schedule")
    }
    ```
    (Use `Icons.Filled.AutoAwesome` or the icon used by other generator entry points — confirm during audit)

### End-of-Phase Protocol
- `./gradlew assembleDebug` — zero compile errors
- Smoke test on device/emulator:
  - [ ] Scheduled screen shows generator icon in top bar
  - [ ] Tapping it navigates to `ScheduleGeneratorScreen`
  - [ ] Back navigation returns to Scheduled list

---

## Phase 12 — Android: Visual Style Alignment for Existing Scheduler Screens

Ensure `ScheduledScreen`, `SchedulerTaskDetailScreen`, and `SchedulerTaskConfigScreen` match the style of `AgentConfigScreen`, `ProjectConfigScreen`, and `SkillsScreen`.

**Files:**
- `android/.../ui/scheduler/ScheduledScreen.kt`
- `android/.../ui/scheduler/SchedulerTaskDetailScreen.kt`
- `android/.../ui/scheduler/SchedulerTaskConfigScreen.kt`

### Checklist
- [ ] In `ScheduledScreen.kt`:
  - [ ] Replace raw `TopAppBar` with `NexyTopAppBar` if other screens use it
  - [ ] Replace `FloatingActionButton` with a "New" icon action in the top bar (matching `SkillsScreen` — confirm which pattern that screen uses during audit)
- [ ] In `SchedulerTaskConfigScreen.kt`:
  - [ ] Audit and align form field styles to match `AgentConfigScreen` patterns (padding, dividers, label styles)
- [ ] In `SchedulerTaskDetailScreen.kt`:
  - [ ] Audit header and action button styles; align to `ProjectConfigScreen` / `AgentConfigScreen` detail patterns

### End-of-Phase Protocol
- `./gradlew assembleDebug` — zero compile errors
- `./gradlew test` — all tests pass
- Visual inspection: Scheduler screens match Projects/Agents/Skills screens in typography, spacing, and button placement

---

## Phase 13 — End-to-End Integration + Final Verification

Full regression and smoke test pass across desktop and Android before shipping.

### Desktop Checklist
- [ ] `npm run typecheck` — zero errors
- [ ] `npm run lint` — zero errors
- [ ] `npm run build` — Electron main + renderer compile cleanly
- [ ] `npm test` — full Vitest suite passes, no regressions
- [ ] Scheduled pane: header shows "Generate" (indigo) and "New" (gray); no purple anywhere
- [ ] "Generate" → `ScheduleGeneratorModal` opens two-column layout
- [ ] Send message → tokens stream; spec draft renders in left column
- [ ] AI emits `<schedule-spec>` block → action bar with "Edit" + "Create task" appears
- [ ] "Create task" → task in scheduler list, toast, modal closes
- [ ] "New" → inline `SchedulerTaskForm` opens (unchanged legacy flow)
- [ ] Project, Agent, Skill generators unaffected (regression check)

### Android Checklist
- [ ] `./gradlew assembleDebug` — zero compile errors
- [ ] `./gradlew test` — all unit tests pass
- [ ] Scheduled screen: generator icon visible in top bar; no FAB
- [ ] Tapping generator → `ScheduleGeneratorScreen` opens in CHAT phase
- [ ] Send message → streaming renders; model indicator shows
- [ ] AI emits spec → SPEC_REVIEW phase with editable form
- [ ] "Create task" → DONE phase shows task name; "Done" pops back; Scheduled list shows new task
- [ ] Existing scheduler create ("New" in top bar) still works
- [ ] Existing generators (agent, skill, project, artifact) unaffected

---

## Phase Dependency Order

```
Phase 0 (Audit)
└── Phase 1 (Types: shared/types.ts)
    └── Phase 2 (Backend: scheduler-generator.ts)
        └── Phase 3 (Preload bridge)
            ├── Phase 4 (Store slice)           ← Desktop UI track
            │   └── Phase 5 (ScheduledPane UI unification)
            │       └── Phase 6 (ScheduleGeneratorModal + App.tsx)
            │           └── Phase 13 (Final verification)
            └── Phase 7 (Android data layer)    ← Android track
                └── Phase 8 (Desktop WS bridge for Android)
                    └── Phase 9 (ScheduleGeneratorViewModel)
                        └── Phase 10 (ScheduleGeneratorScreen)
                            └── Phase 11 (NavGraph + header button)
                                └── Phase 12 (Style alignment)
                                    └── Phase 13 (Final verification)
```

Phases 4–6 (desktop UI) and Phases 7–12 (Android) run in parallel once Phases 0–3 are complete.
