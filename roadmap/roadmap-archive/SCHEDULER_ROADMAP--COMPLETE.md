# Nexy Scheduled Tasks Roadmap

## Summary

Build a desktop-hosted scheduler that users can add, view, edit, pause, delete, and manually run from both Nexy Desktop and Android.

Each task runs in a dedicated conversation thread. The Electron app owns scheduling, persistence, model and tool execution, and result notifications. Android remains a remote management client.

## Implementation Roadmap

### Phase 1 — Scheduler Domain and Persistence

- Add shared `ScheduledTask` and `ScheduledRun` types.
- Store tasks and run history in new SQLite tables using the next append-only migration.
- Task fields include:
  - name and prompt
  - enabled state
  - agent, project, model, and dedicated conversation
  - schedule type: one-time, daily, weekdays, weekly, or monthly
  - local time, weekday or month-day where applicable, and IANA timezone
  - pre-authorized tool policy
  - next and last run timestamps and creation/update timestamps
- Run records include scheduled, started, and finished timestamps; status; error; conversation and message references; and trigger source.
- Enforce one active run per task and idempotency for each scheduled occurrence.

### Phase 2 — Desktop Scheduling Engine

- Run the scheduler in Electron's main process, independently of renderer windows.
- Calculate and persist `nextRunAt` after every task change or execution.
- Rehydrate enabled tasks during startup and reevaluate them after system wake, clock changes, and timezone changes.
- When runs were missed, execute only the latest occurrence once and skip older duplicates.
- Execute through the existing chat dispatch pipeline so provider, CLI, agent, project context, streaming, and tool behavior remain consistent.
- Append every prompt and result to the task's dedicated conversation.
- Support manual runs without changing the next scheduled occurrence.
- Record failures and apply bounded retries only for transient provider or network failures; do not retry tool side effects automatically.
- Require the desktop app to be running. Expose this limitation clearly on Android.

### Phase 3 — Safety and Tool Authorization

- Save an explicit tool authorization policy with each task.
- Allow unattended execution only for tools and actions approved when the schedule is created or edited.
- Pause the run and send the existing mobile approval flow when an unapproved protected action is requested.
- Resume after approval where the provider or tool loop supports continuation; otherwise fail clearly and allow a manual rerun.
- Never inherit blanket approval from an unrelated interactive chat.
- Show warnings when a selected agent, project, provider, CLI backend, workspace, or MCP server is unavailable.

### Phase 4 — Desktop Experience

- Add a **Scheduled** destination to desktop navigation.
- Match the reference interaction model:
  - Active, Paused, and All filters
  - task cards with name, prompt summary, next run, status, and quick actions
  - persistent **Create a task** action
- Add a create/edit screen with structured recurrence controls, timezone, execution context, notification settings, and tool authorization.
- Provide task details with run history, dedicated conversation link, Run now, Pause/Resume, Edit, and Delete.
- Surface running, awaiting approval, failed, and missed-run states without requiring the task thread to be open.

### Phase 5 — Android Experience

- Add a Scheduled screen to the Compose navigation graph using the supplied ChatGPT screenshot as the interaction reference while retaining Nexy's design system.
- Support the same list filters and CRUD/manual-run actions as desktop.
- Add WebSocket commands and events for task synchronization and live status updates.
- Disable mutations with a clear offline state when Android is disconnected; continue displaying the last synchronized task snapshot.
- Deep-link scheduler notifications into the relevant task details or dedicated conversation.

### Phase 6 — Notifications and Operations

- Add desktop notifications for completion, failure, and approval-required states.
- Extend FCM data notifications with scheduled-task completion and failure payloads.
- Let each task choose completion notifications: always, failures only, or off.
- Keep bounded run history and expose unsuccessful runs for diagnostics.
- Add structured logs for scheduling decisions, catch-up execution, authorization pauses, and failures.

## Public Interfaces

Desktop IPC:

- `scheduler:list`
- `scheduler:get`
- `scheduler:create`
- `scheduler:update`
- `scheduler:delete`
- `scheduler:set-enabled`
- `scheduler:run-now`
- `scheduler:list-runs`

Android WebSocket commands mirror those operations under `scheduler:*`.

Push events:

- `scheduler:task-updated`
- `scheduler:task-deleted`
- `scheduler:run-updated`

Schedule input uses structured recurrence data rather than cron or unconstrained natural-language parsing. Validate all IPC and WebSocket payloads in the main process.

## Test Plan

- Test recurrence calculation across daylight-saving transitions, month boundaries, leap years, and timezone changes.
- Test startup and wake catch-up executes only the latest missed occurrence.
- Test duplicate timers and manual/scheduled overlap cannot create duplicate runs.
- Test pause, resume, edit, delete, and one-time task completion.
- Test dedicated conversation creation and repeated result appending.
- Test pre-authorized tools, approval pauses, unavailable tools, provider failures, and app restarts during execution.
- Test IPC and WebSocket validation and Android reconnect synchronization.
- Test desktop and Android list filters, forms, status states, manual runs, and offline behavior.
- Regression-test normal interactive chat dispatch and existing approval notifications.

## Delivery Milestones

1. Persistence, shared types, recurrence calculator, and unit tests.
2. Main-process scheduler and model-only execution.
3. Dedicated task conversations and desktop management UI.
4. Tool pre-authorization, approvals, retries, and diagnostics.
5. Android WebSocket API and scheduler UI.
6. Desktop and FCM notifications, lifecycle hardening, and end-to-end tests.

---

## Implementation Checklist

### Phase 1 — Domain, Persistence & Recurrence Calculator

- [x] Add `ScheduledTask` and `ScheduledRun` TypeScript types to `src/shared/types.ts` (name, prompt, enabled, agentId, projectId, model, conversationId, scheduleType, localTime, weekday, monthDay, timezone, toolPolicy, nextRunAt, lastRunAt, createdAt, updatedAt)
- [x] Add `ScheduledRun` type fields: scheduledAt, startedAt, finishedAt, status (`pending|running|approval_required|success|failed|skipped`), error, conversationId, messageId, triggerSource (`scheduled|manual`)
- [x] Add migration version 38 to `database-migrations.ts` — create `scheduled_tasks` table
- [x] Add migration version 39 to `database-migrations.ts` — create `scheduled_runs` table with FK to `scheduled_tasks`, unique constraint on `(task_id, scheduled_at)` for idempotency
- [x] Add both tables to `initializeBaseSchema()` in `database-migrations.ts`
- [x] Add `scheduler:*` IPC channel names to the `IpcChannels` union in `src/shared/types.ts`
- [x] Add return types for all `scheduler:*` channels to `IpcReturnMap` in `src/shared/types.ts`
- [x] Create `src/main/scheduler-recurrence.ts` — pure functions: `calcNextRunAt(task, fromDate)`, `calcScheduledAt(task, now)`, `isMissed(scheduledAt, now)`, `formatOccurrenceKey(task, date)` — no side effects, no DB access
- [x] Write `src/main/__tests__/scheduler-recurrence.test.ts` covering: daily across DST boundaries, weekdays skipping weekends, weekly on correct weekday, monthly on last-day edge cases, month-day clamping (e.g. Feb 30 → Feb 28/29), leap year, timezone offset shifts, one-time tasks marked complete after first run, missed-run catch-up returns only the latest occurrence

### Phase 2 — Scheduling Engine (Main Process)

- [x] Create `src/main/scheduler-engine.ts` — class `SchedulerEngine` with `start()`, `stop()`, `rehydrate()`, `scheduleTask(task)`, `unscheduleTask(taskId)`, `triggerRun(taskId, source)` methods
- [x] `rehydrate()` loads all enabled tasks from DB on startup and registers their next-run timers
- [x] Implement timer management: use `setTimeout` (not `setInterval`); re-arm after each fire; cancel on task disable/delete/update
- [x] Handle `powerMonitor` `resume` and `lock-screen`/`unlock-screen` events from Electron to re-evaluate all timers after system sleep
- [x] Handle clock drift via periodic sanity check (every 60 s, compare `Date.now()` against last-known wall time) and re-arm timers if drift exceeds threshold
- [x] `triggerRun()`: check idempotency (existing `scheduled_runs` row for same `scheduledAt`); create `scheduled_runs` record; dispatch through existing `sendChatMessage`/provider pipeline
- [x] Dedicated-conversation creation: if `task.conversationId` is null, create a new conversation and save its id back to the task row
- [x] Append prompt and response to the task's dedicated conversation using existing message-insert path
- [x] Manual-run path: insert a run with `triggerSource = 'manual'`; does not update `nextRunAt`
- [x] Enforce one active run per task: check for a `running` row before starting; skip if found
- [x] On run completion: update `scheduled_runs` row status/timestamps; recalculate and persist `nextRunAt` on the task row
- [x] Retry logic: transient provider/network errors only, max 3 retries with exponential backoff; no retry for tool side effects
- [x] Export a singleton `schedulerEngine` instance; call `schedulerEngine.start()` from app startup after DB is ready
- [x] Integrate into `src/main/ipc-handlers.ts`: import and call `registerSchedulerHandlers(schedulerEngine)`

### Phase 3 — Safety & Tool Authorization

- [x] Add `toolPolicy` field to `ScheduledTask`: `{ preApproved: string[]; alwaysAsk: string[]; neverAllow: string[] }` — store as JSON in `scheduled_tasks`
- [x] In scheduler run dispatch: check each tool invocation against `task.toolPolicy` before executing — `neverAllow` tools are blocked with an error result; tools not in `preApproved` are blocked with a policy error (enforcement via `runProviderMcpToolLoop` `toolPolicy` param)
- [x] If a tool is in `alwaysAsk` or not in `preApproved`: block tool with policy error message returned to model (full mid-run pause/approval-request flow deferred — not supported by current tool-loop architecture)
- [x] On approval granted: N/A for current architecture — blocked tools return error to model; manual re-run available via UI
- [x] Add warning validation in `scheduler-handlers.ts` create/update path: check that referenced agentId, projectId, model, workspace, and MCP servers still exist; include a `warnings: string[]` field in the response
- [x] Never inherit tool approval from `agent_mcp_server_trust` or any interactive chat session — always resolve against the task's own `toolPolicy`

### Phase 4 — Desktop UI

- [x] Create `src/main/scheduler-handlers.ts` — register `safeHandle` for all 8 IPC channels: `scheduler:list`, `scheduler:get`, `scheduler:create`, `scheduler:update`, `scheduler:delete`, `scheduler:set-enabled`, `scheduler:run-now`, `scheduler:list-runs`
- [x] Add `typedInvoke` wrappers for all 8 channels in `src/preload/index.ts`
- [x] Add `'scheduled'` to the `activeSectionPane` union type and add `openSectionPane('scheduled')` to the Zustand store
- [x] Add a `Clock` icon `NavButton` for "Scheduled" to `Sidebar.tsx` between Skills and Artifacts
- [x] Create `src/renderer/components/section-pane/ScheduledPane.tsx` — Active/Paused/All filter tabs; task cards showing name, prompt summary, next-run, last status, quick-action buttons (Run now, Pause/Resume, Edit, Delete); persistent "Create a task" button
- [x] Add the `'scheduled'` case to `SectionPane.tsx` to render `ScheduledPane`
- [x] Create `src/renderer/components/scheduler/SchedulerTaskForm.tsx` — create/edit form with: name, prompt, schedule type, local-time picker, conditional weekday/month-day fields, IANA timezone, agent picker, project picker, model picker, notification preference
- [x] Create `src/renderer/components/scheduler/SchedulerTaskDetail.tsx` — detail view with run history table (scheduled, started, finished, status, error), link to dedicated conversation, Run now / Pause/Resume / Edit / Delete actions
- [x] Add `schedulerTasks` and `scheduledRuns` slices to `app-store.ts`; include scheduled tasks in `hydrate()`
- [x] Surface running / awaiting-approval / failed / missed states with distinct visual indicators in `ScheduledPane` and `SchedulerTaskDetail`
- [x] Register `scheduler:run-updated` push event listener in the renderer to update task/run state in real time

### Phase 5 — Android UI & WebSocket API

- [x] Add `scheduler:*` WebSocket command handlers in `src/main/ws-handlers.ts` mirroring all 8 IPC operations — validate payloads; call through to `schedulerEngine`
- [x] Add `scheduler:task-updated`, `scheduler:task-deleted`, `scheduler:run-updated` push event broadcasts in `ws-server.ts` — fired whenever the engine mutates a task or run
- [x] On Android reconnect: send full task snapshot via `scheduler:list` response
- [x] Add `_scheduledTasks` and `_scheduledRuns` `MutableStateFlow` fields to `WsRepository.kt`; handle incoming `scheduler:task-updated`, `scheduler:task-deleted`, `scheduler:run-updated` WS events
- [x] Create `SchedulerViewModel.kt` — collects task/run flows; exposes create/update/delete/enable/run-now actions that send WS commands
- [x] Create `ScheduledScreen.kt` — Active/Paused/All filter chips; task list with name, prompt summary, next-run, status badge, quick-action overflow menu; FAB "Create task"
- [x] Create `SchedulerTaskConfigScreen.kt` — create/edit form: name, prompt, recurrence type, time picker, weekday/month-day pickers, timezone, agent/project/model dropdowns, tool policy section, notification preference
- [x] Create `SchedulerTaskDetailScreen.kt` — task info header, run history lazy list, action buttons (Run now, Pause/Resume, Edit, Delete)
- [x] Add nav routes `scheduled`, `scheduled/new`, `scheduled/{taskId}`, `scheduled/{taskId}/edit` to `NavGraph.kt`
- [x] Add a "Scheduled" entry to the bottom nav or drawer in `HomeScreen.kt`
- [x] Disable all mutation controls when `connectionState != CONNECTED`; show an offline banner displaying the last-synced snapshot
- [x] Deep-link scheduler notifications into `SchedulerTaskDetailScreen` via `taskId` in the notification payload

### Phase 6 — Notifications, Operations & Hardening

- [x] Desktop notifications: call `new Notification(...)` from main process on run `success`, `failed`, and `approval_required`; respect per-task preference (`always|failures_only|off`)
- [x] Extend FCM data notification payloads in `src/main/fcm-sender.ts`: add `scheduler:run-completed` and `scheduler:run-failed` payloads with `taskId`, `taskName`, `status`, `conversationId`
- [x] Android: handle `scheduler:run-completed`/`scheduler:run-failed` FCM data messages and deep-link into `SchedulerTaskDetailScreen`
- [x] Bounded run history: periodic cleanup job in `scheduler-engine.ts` pruning `scheduled_runs` rows older than 90 days (keep at least the last 20 per task)
- [x] Add structured logger calls in `scheduler-engine.ts` using existing `logger.ts` for: scheduling decisions, catch-up execution, authorization pauses, retries, and failures
- [x] Write `src/main/__tests__/scheduler-engine.test.ts`: startup rehydration, sleep/wake catch-up (only latest missed), duplicate-timer guard, manual-run does not shift `nextRunAt`, one-time task disables itself after first run, pause/resume/delete/edit lifecycle, dedicated conversation created on first run and reused on subsequent runs
- [x] Write `src/main/__tests__/scheduler-handlers.test.ts`: IPC payload validation, CRUD round-trips, `scheduler:run-now` against a task with no prior run
- [x] Write `src/main/__tests__/scheduler-ws.test.ts`: WebSocket payload validation, reconnect sync, push event broadcast on task/run mutations
- [x] Regression-test existing `chat-handlers.ts` and `tool-loop.ts` paths remain unaffected after scheduler dispatch integration
- [x] Manual QA: all desktop list filters; create/pause/resume/edit/delete a task; manual run; verify dedicated conversation is created then reused; force a missed-run by advancing the clock; Android offline → reconnect sync

## Assumptions

- Desktop is the sole execution host; Android manages the same desktop-owned schedules remotely.
- Nexy must be running for execution. A background service or cloud scheduler is not included.
- Version one supports one-time, daily, weekdays, weekly, and monthly schedules.
- Each task has one dedicated conversation containing all runs.
- After downtime, Nexy performs one latest-occurrence catch-up run.
- Natural-language schedule parsing, cron expressions, calendar triggers, and event-driven monitors are future enhancements.
