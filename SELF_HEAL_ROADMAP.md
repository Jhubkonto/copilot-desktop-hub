# Roadmap: Self-Healing App Feature

---

## Implementation checklist

Use this as the canonical tick-off list. The detailed phase notes below explain the design, affected files, and verification for each item.

### Milestone A — Observability foundation

- [x] **A0.1 Debug mode state** — add `src/main/debug-mode.ts` with `initDebugMode`, `isDebugEnabled`, `setDebugEnabled`, and `debugLog`.
- [x] **A0.2 Debug setting persistence** — store and hydrate `debug_logging` through settings handlers and app store hydration.
- [x] **A0.3 Debug IPC/preload bridge** — add typed `debug:set-enabled` invoke and `debug:log` push event.
- [x] **A0.4 Developer toggle** — expose a Debug logging toggle in Developer settings.
- [x] **A0.5 Convert noisy diagnostic logs** — move existing timing/debug `console.*` calls behind `debugLog`.
- [x] **A0.6 Verify debug mode** — typecheck/test, toggle on/off, restart persistence, and devtools API path.

### Milestone B — Error capture and console

- [x] **B1.1 Error log DB schema** — add `error_log` migration with source, level, message, stack, timestamp.
- [x] **B1.2 Main log IPC** — add `errors:get-log-path`, `errors:get-recent`, and `errors:clear`.
- [x] **B1.3 Renderer console capture** — capture BrowserWindow console messages into the ring buffer and DB.
- [x] **B1.4 Live error events** — push new entries to renderer with `errors:new`.
- [x] **B1.5 Console UI** — add Developer Console panel/tab with level filters, clear, copy, stack expansion, and auto-scroll.
- [x] **B1.6 Verify console** — trigger renderer and main-process errors and confirm they appear without terminal access.

### Milestone C — Bug report capture

- [x] **C2.1 Error reports DB schema** — add `error_reports` table with report metadata, status, paths, and timestamps.
- [x] **C2.2 Renderer ErrorBoundary** — wrap the app and provide a minimal report-bug fallback UI.
- [x] **C2.3 Report capture IPC** — implement `error-report:capture` with optional screenshot and log snapshot.
- [x] **C2.4 Report Bug UI** — add report form with title, description, screenshot/log toggles, preview, and submit state.
- [x] **C2.5 Android report trigger** — add Android settings action and WS command for desktop-side report capture.
- [x] **C2.6 Verify reports** — confirm reports persist, include selected context, and can be reopened.

### Milestone D — Investigation agent

- [x] **D3.1 Investigation settings** — add backend/model selection and retry limits to settings storage/UI.
- [x] **D3.2 MCP auto-approve path** — thread an `autoApprove` option through MCP calls and tool loop for investigator-only use.
- [x] **D3.3 Inline workspace tools** — implement read file, list directory, and grep handlers for no-MCP investigation mode.
- [x] **D3.4 Investigation runner** — add `src/main/self-heal/investigator.ts` with BYOK tool-loop and Claude CLI paths.
- [x] **D3.5 Structured report output** — enforce YAML front matter with confidence, affected files, and root cause.
- [x] **D3.6 Streaming IPC/events** — stream tokens, activity events, and completion events to desktop and Android.
- [x] **D3.7 Report viewer** — show report history, live investigation output, tool activity, and Accept/Reject/Revise actions.
- [x] **D3.8 Verify investigation** — run against a synthetic report and confirm tool use, status transitions, and saved Markdown.

### Milestone E — Fix staging and review

- [x] **E4.1 Fix staging schema** — store patched files, backups, and fix status on the report/history records.
- [x] **E4.2 Fix agent** — add `src/main/self-heal/fix-agent.ts` to generate complete patched files into staging only.
- [x] **E4.3 Context guard** — truncate or summarize oversized affected files before sending to the model.
- [x] **E4.4 Diff generation** — produce before/after diffs for every staged file.
- [x] **E4.5 Desktop diff UI** — show reviewable diffs with per-file revert and reviewed state.
- [x] **E4.6 Apply to workspace** — copy staged files into the workspace only after explicit approval, with backups.
- [x] **E4.7 Android fix status** — broadcast patched file list and provide read-only diff retrieval.
- [x] **E4.8 Verify staging** — confirm dry-run staging never touches workspace until approved.

### Milestone F — Verification pipeline

- [x] **F5.1 Verification runner** — add `src/main/self-heal/verifier.ts` for typecheck, lint, build, and tests.
- [x] **F5.2 Lint command support** — add a lint verification command if build handlers do not already expose it.
- [x] **F5.3 Verification streaming** — stream logs and step statuses to desktop and Android.
- [x] **F5.4 Failure retry loop** — allow up to the configured number of re-investigation rounds with compiler/test errors appended.
- [x] **F5.5 Verification UI** — show four status rows with expandable logs and next actions only after all pass.
- [x] **F5.6 Verify pipeline** — test one passing fix and one failing fix with retry behavior.

### Milestone G — Git, reload, and rollback

- [x] **G6.1 Git IPC handlers** — add branch, stage, commit, push, and status handlers under `src/main/self-heal/git-ops.ts`.
- [x] **G6.2 Git UI flow** — add branch/commit/push prompt cards with editable commit message and skip options.
- [x] **G6.3 Android git relay** — mirror git prompts and decisions over WebSocket.
- [x] **G7.1 Reload preparation** — record last-heal metadata, target version, backup path, and pre-reload state.
- [x] **G7.2 App reload flow** — rebuild/package as needed and relaunch into the fixed version after user approval.
- [x] **G7.3 Startup confirmation** — mark heal confirmed only after the app loads and reports healthy startup.
- [x] **G7.4 Rollback path** — restore backup if startup fails or the user rejects the healed version.
- [x] **G7.5 Failsafe window** — provide minimal rollback UI if the normal renderer cannot load.
- [x] **G7.6 Android reload UX** — broadcast reloading/failsafe events and reconnect guidance.
- [x] **G7.7 Verify recovery** — test successful reload and intentionally bad reload rollback.

### Milestone H — Self-heal product integration

- [x] **H8.1 Self-heal dashboard** — add active pipeline and report history surfaces.
- [x] **H8.2 Self-heal history table** — persist model/backend, rounds, statuses, verification, git, reload, and rollback metadata.
- [x] **H8.3 Notifications** — send desktop notifications for investigation complete, verification failure, and approval-required steps.
- [x] **H8.4 Android end-to-end control** — allow Android to follow and control the full healing workflow.
- [x] **H8.5 End-to-end verification** — run from captured error to reloaded app using desktop and Android paths.

### Milestone I — Developer UI redesign

- [x] **I9.1 Developer inner tabs** — split Developer into Desktop, Android, Self-Heal, and Console tabs.
- [x] **I9.2 Desktop pipeline layout** — present Preflight, Build, Publish, and Launch as a clear pipeline.
- [x] **I9.3 Reusable BuildLog** — add ANSI-stripping, timestamps, auto-scroll, copy, line count, and resize support.
- [x] **I9.4 Expandable build history** — show stored log tails and rerun actions inline.
- [x] **I9.5 Persistent preflight status** — keep results visible and badge the tab with worst status.
- [x] **I9.6 Android signing modal** — move signing inputs into a modal and keep inline status compact.
- [x] **I9.7 Version shelf** — replace feed/history `<details>` with persistent version shelves.
- [x] **I9.8 Move FCM config** — move FCM service account config to Mobile settings.
- [x] **I9.9 Self-Heal tab UI** — integrate active healing pipeline and report viewer.
- [x] **I9.10 Console tab UI** — move console into its own tab with unread error count.
- [x] **I9.11 Verify UI redesign** — typecheck and manually exercise all four tabs.

### Milestone J — Project generator

- [x] **J10.1 Replace New Project entry** — open the generator wizard from the existing New Project button.
- [x] **J10.2 Desktop wizard modal** — build two-column chat plus live draft preview layout.
- [x] **J10.3 Project generator backend** — add `src/main/project-generator.ts` and `project-generator:chat`.
- [x] **J10.4 Structured `<project-spec>` parsing** — detect and validate generated project specs.
- [x] **J10.5 Agent matching/creation plan** — reuse existing agents when suitable and propose new specialist agents when needed.
- [x] **J10.6 Edit-before-create flow** — allow users to adjust project fields and proposed agents before commit.
- [x] **J10.7 Creation chain** — run project create, config update, agent create, team assignment, primary agent, and orchestration enablement.
- [x] **J10.8 Rollback on failure** — delete created project/agents if any creation step fails.
- [x] **J10.9 Android generator flow** — add WS-backed generator conversation, spec preview, confirm, and created events.
- [x] **J10.10 Verify generator** — test cancel, edit, successful create, rollback, orchestration, and Android creation.

### Milestone K — Feature generator

- [ ] **K11.1 Developer sub-tab** — add a dedicated Feature Generator tab under Developer options.
- [ ] **K11.2 Guided discovery chat** — ask the developer what they want to add/change, target surfaces, constraints, risk tolerance, and acceptance criteria.
- [ ] **K11.3 Structured feature spec** — emit and validate a `<feature-spec>` block with scope, user story, acceptance criteria, risks, affected areas, and verification plan.
- [ ] **K11.4 Approval before implementation** — require explicit developer approval of the generated spec and implementation plan before any code path starts.
- [ ] **K11.5 Specialist team proposal** — propose a lead plus specialists matched to the feature type and app surface.
- [ ] **K11.6 Temporary specialist sessions** — use temporary per-feature specialists by default, with an option to promote useful specialists into persistent agents after the run.
- [ ] **K11.7 Specialist work panel** — show a live panel of specialist activity; each specialist can be expanded to inspect reasoning, files reviewed, proposed tasks, and current output.
- [ ] **K11.8 Implementation runner** — after approval, hand the approved plan to the same staged file-edit workflow used by self-heal.
- [ ] **K11.9 Staged diff review** — require review and approval of generated diffs before applying changes to the workspace.
- [ ] **K11.10 Verify/apply/commit/reload flow** — support the full Plan + apply + verify + commit + reload path through existing self-heal pipeline pieces.
- [ ] **K11.11 Artifact workspace mode** — design the feature generator so it can later target user-selected workspaces, not only the Nexy repo.
- [ ] **K11.12 Run history** — store feature generator runs, specs, specialist team, changed files, verification results, commit SHA, and reload status.
- [ ] **K11.13 Verify feature generator** — test plan-only, approved implementation, failed verification, commit skip, reload success, and rollback paths.

### Milestone L — Artifact generator

- [ ] **L12.1 Artifact definition** — define artifacts as global-or-project-scoped, versioned deliverables with one or more generated files.
- [ ] **L12.2 Artifact storage root** — add a configurable global artifact storage location, with project-scoped subfolders when applicable.
- [ ] **L12.3 Artifact DB schema** — add artifact, artifact version, artifact file, and chat reference records.
- [ ] **L12.4 Project Artifacts tab** — add an Artifacts tab in each project for browsing, opening, exporting, and version history.
- [ ] **L12.5 Chat artifact references** — when an artifact is generated from a project chat, insert a chat-visible reference card/link to the artifact and version.
- [ ] **L12.6 Guided artifact generator** — ask what deliverable to create, audience, format, constraints, target project/global scope, files, and export needs.
- [ ] **L12.7 Project team generation** — use the project's existing agent team to plan and generate artifacts.
- [ ] **L12.8 Artifact spec approval** — require approval of a structured `<artifact-spec>` before generating files.
- [ ] **L12.9 Workspace file writing** — generate and save artifact files to the configured storage/workspace location.
- [ ] **L12.10 Artifact versioning** — save every revision as a new version with file manifest, notes, and source conversation/run metadata.
- [ ] **L12.11 Export support** — export artifacts to formats such as Markdown, PDF, HTML, JSON, ZIP, or raw file bundle where applicable.
- [ ] **L12.12 Global artifact library** — provide a global view for artifacts not attached to a project.
- [ ] **L12.13 Verify artifact generator** — test global artifacts, project artifacts, chat references, version creation, file storage, and exports.

### Cross-cutting acceptance gates

- [ ] Every new IPC/WS channel is typed in `src/shared/types.ts`, exposed through preload where needed, and registered with `safeHandle`.
- [ ] Every DB change has a migration and backwards-compatible read path.
- [ ] Every workspace write path validates that target paths stay inside the configured workspace.
- [ ] Every LLM-generated file edit is staged and diff-reviewed before touching the workspace.
- [ ] Every potentially destructive action has an explicit user approval step.
- [ ] Desktop typecheck and relevant tests pass for each milestone before marking it complete.
- [ ] Android unit tests or manual device checklist entries are updated for every Android-facing milestone.
- [ ] Roadmap checkboxes are updated in the same PR/session that completes each item.

---

## Phase 0 — Debug Logging Toggle

**Goal:** A first-class debug mode that can be toggled by a human in Developer settings or programmatically by the self-heal agent. Controls verbose/timing logs across terminal, electron-log file, and (via push event) the in-app console panel planned in Phase 1B.

### Log level strategy

- **`warn` / `error`** — always on, unaffected by toggle
- **`debug`** — key non-error events (chat dispatch, MCP tool calls, slow IPC handlers)
- **`verbose`** — timing/diagnostic instrumentation (`[build]`, `[android]`, `[cli]`, etc.)

Toggle off = only problems. Toggle on = full picture.

### Implementation

**`src/main/debug-mode.ts`** — new file, module-level state:
```ts
let _enabled = false
let _win: BrowserWindow | null = null

export function initDebugMode(win: BrowserWindow): void { _win = win }
export function isDebugEnabled(): boolean { return _enabled }
export function setDebugEnabled(enabled: boolean): void {
  _enabled = enabled
  log.transports.file.level = enabled ? 'debug' : 'warn'
}
export function debugLog(prefix: string, ...args: unknown[]): void {
  if (!_enabled) return
  const msg = `[${prefix}] ${args.map(String).join(' ')}`
  console.log(msg)
  log.debug(msg)
  _win?.webContents.send('debug:log', { message: msg, timestamp: Date.now() })
}
```

**`src/main/settings-handlers.ts`** — on startup read `'debug_logging'` from DB and call `setDebugEnabled`; add `safeHandle('debug:set-enabled', ...)` as the agent-callable channel.

**`src/main/index.ts`** — call `initDebugMode(mainWindow)` alongside `initAutoUpdater`.

**`src/shared/types.ts`** — add `'debug:set-enabled'` to `IpcChannels` + `IpcReturnMap`.

**`src/preload/index.ts`** — add `typedInvoke` for `debug:set-enabled`; `typedOn` for `debug:log` push event.

**`src/renderer/store/slices/uiSlice.ts`** — add `debugLogging: boolean` + `setDebugLogging(enabled)` setter (dual-dispatch: Zustand state + `window.api.setSetting('debug_logging', ...)` + `window.api.setDebugEnabled(...)`).

**`src/renderer/store/app-store.ts`** — hydrate `debugLogging` from DB in `hydrate()`.

**`src/renderer/components/settings/DeveloperTab.tsx`** — add "Debug logging" toggle row at top (mirrors `autoStart` toggle in `GeneralTab.tsx`); wire `typedOn('debug:log', ...)` listener stub for Phase 1B console panel.

**`src/renderer/components/SettingsPanel.tsx`** — pass `debugLogging` + `onToggleDebugLogging` props from `useAppStore`.

**Convert existing timing logs** — replace all `console.time`/`console.timeEnd`/`console.log` added during diagnosis in `cli-adapters/utils.ts`, `build-handlers.ts`, `android-handlers.ts`, `model-availability.ts` with `debugLog('cli'|'build'|'android'|'model', ...)`.

### Verification

1. `npm run typecheck && npm test` — green
2. Toggle debug ON in Developer settings → timing logs appear in terminal on next Developer tab open
3. Toggle OFF → no timing logs
4. Restart app → toggle state preserved
5. Agent path: `window.api.setDebugEnabled(true)` from devtools console fires same logs without touching UI

---

## Context

The goal is to build an in-app, end-to-end self-healing pipeline: errors are captured inside the app (not just in the terminal), the user can report them, an LLM investigates and drafts a fix plan, the user approves, the fix is applied, verified (lint/typecheck/build), committed, pushed, and the app reloads — all from both the desktop and Android companion. A safe rollback path exists if the reload fails.

This is a large, multi-phase feature. Each phase is independently shippable and builds on the previous one.

---

## Existing infrastructure to reuse

- **Build orchestration**: `src/main/build-handlers.ts` — already runs typecheck/test/build/package via `spawn`, streams logs via IPC, tracks records in `build_records` DB table. All build commands are already wired.
- **Error logging**: `src/main/logger.ts` — electron-log captures `uncaughtException`/`unhandledRejection` to file. Log file path is accessible via `log.transports.file.getFile().path`.
- **Screen capture**: `src/main/screen-capture.ts` + `screen-capture-handlers.ts` — full screen/region capture, clipboard image read, OCR. IPC channels: `screen:capture`, `clipboard:read-content`, `clipboard:read-image`.
- **Developer tab**: `src/renderer/components/settings/DeveloperTab.tsx` — existing home for build UI; self-healing UI should integrate here initially.
- **Git child process pattern**: `build-handlers.ts` uses `execSync` for git queries and `spawn` for commands — the same pattern can run `git add`, `git commit`, `git push`.
- **WebSocket server**: `src/main/ws-server.ts` + `ws-handlers.ts` — already broadcasts typed events to Android. New self-healing events follow the same broadcast pattern.
- **File read IPC**: `context:read-file` channel and `fs:list-directory` exist — use these to show changed files in-app.
- **Chat/LLM dispatch**: `src/main/chat-provider-dispatch.ts` + `src/main/providers.ts` — use `sendOpenAIMessage` / `sendAnthropicMessage` etc. directly, or route through the tool loop (see Phase 3).
- **Tool loop**: `src/main/tool-loop.ts` — `runProviderMcpToolLoop(caller, messages, toolDefs, toolMap, agentId, webContents, onChunk, ...)` handles the full tool-call/response cycle. Can be called headlessly with a stub `webContents`.
- **MCP tool discovery**: `src/main/mcp.ts` — `getAvailableMcpTools(serverIds?)` returns connected MCP tools; `ensureMcpServersReady(serverIds)` connects them first; `getMcpServerConfigsForCli(serverIds)` returns CLI-friendly configs for the subprocess path. `callMcpTool()` executes a tool — needs an `autoApprove` flag added for the investigator.
- **CLI adapters**: `src/main/cli-adapters/claude.ts` — `adapter.send(window, req, onChunk, onEvent)` spawns the Claude CLI with MCP server configs and streams output. `isAvailable()` checks if CLI is installed.
- **safeHandle pattern**: always register new IPC with `safeHandle` from `src/main/safe-handle.ts`.
- **IPC type registration**: add channel + return type to `IpcReturnMap`/`IpcChannels` in `src/shared/types.ts`, typedInvoke/typedOn wrapper in `src/preload/index.ts`.

---

## Phase 1 — Error capture & in-app console

**Goal:** Surface errors inside the app so users can see them without the terminal. No LLM involvement yet.

### 1A — Main-process error log IPC

**New file:** `src/main/error-log-handlers.ts`

- `safeHandle('errors:get-log-path', ...)` — returns electron-log file path
- `safeHandle('errors:get-recent', ...)` — tail last N entries from the log file; returns `{ timestamp, level, message, stack? }[]`
- `safeHandle('errors:clear', ...)` — truncate the log file

Capture all renderer console errors via the existing `webContents.on('console-message')` event in `src/main/index.ts` (or wherever the BrowserWindow is created) and persist them to a ring buffer (max 200 entries) in memory, exposed via a separate `safeHandle('errors:get-renderer-console', ...)`.

Push new errors to the renderer in real time via `win.webContents.send('errors:new', entry)`.

**DB schema (migration):** Add `error_log` table: `id, source (main|renderer|unhandled), level, message, stack, timestamp`.

### 1B — In-app console panel (desktop)

Add a "Console" collapsible section to `DeveloperTab.tsx`:

- Toggle auto-scroll
- Level filter chips (error / warn / info / all)
- Colour-coded log entries (red error, yellow warn, grey info)
- Clear button
- "Copy all" button

Subscribes to `errors:new` push events and `errors:get-recent` on mount.

### 1C — Verification

- `npm run typecheck && npm test` green
- Open app, trigger a renderer console.error, confirm it appears in the panel
- Trigger a main-process throw, confirm it appears

---

## Phase 2 — Error report capture

**Goal:** One-click "Report this bug" that bundles context (screenshot, error stack, recent log) into a structured payload.

### 2A — Error boundary (renderer)

Add `src/renderer/components/ErrorBoundary.tsx` — standard React error boundary wrapping the entire app tree in `src/renderer/App.tsx`. On catch:
- Render a minimal fallback UI (not reliant on Zustand or any provider that might be broken)
- Show error message + stack
- "Report Bug" button that pre-fills the report form

### 2B — Report capture IPC

**New file:** `src/main/error-report-handlers.ts`

`safeHandle('error-report:capture', { title, description, includeScreenshot, includeLog })`:
- If `includeScreenshot`: call the existing `screen:capture` flow internally (or accept a pre-captured base64 from renderer)
- If `includeLog`: tail last 100 entries from error log
- Bundle: `{ id, timestamp, title, description, screenshot?: base64, logEntries, appVersion, platform, osVersion }`
- Store report in new DB table `error_reports`: `id, title, description, screenshot_path, log_snapshot, status (open|investigating|fixed|rejected), created_at`
- Returns `{ reportId: string }`

### 2C — "Report Bug" UI

- Floating button (bottom-right corner) in the main app, visible only when there are unacknowledged errors in the ring buffer OR triggered manually from the Help menu.
- Sheet/modal with: title field, description textarea, screenshot toggle (shows preview), log inclusion toggle.
- Submit calls `error-report:capture`.
- On submit: transitions to "investigating…" state and triggers Phase 3 flow.

### 2D — Android: report trigger

Add a "Report Bug" item to the Android settings screen (in `ActionsSection` or a new `DiagnosticsSection` extension). Taps send a WS command `'error-report:request-capture'`. Desktop receives, captures report, broadcasts `'error-report:captured'` with the report ID back to Android.

---

## Phase 3 — LLM investigation agent

**Goal:** Given a bug report, an agentic LLM investigates the codebase using tools and produces a structured report (Markdown). The investigator can read files, search for patterns, and navigate the source — not just receive a static prompt.

### 3A — Investigation runner (main process)

**New file:** `src/main/self-heal/investigator.ts`

`runInvestigation(report: ErrorReport, config: InvestigationConfig): AsyncGenerator<string>`:

**Backend selection** (configurable in Self-Heal settings, not per-report):
- `BYOK (tool loop)` — default. Calls `ensureMcpServersReady()` → `getAvailableMcpTools()` → builds `toolDefs`/`toolMap` (same assembly pattern as `chat-handlers.ts` lines 560–584) → calls `runProviderMcpToolLoop` with a stub `webContents` (`{ send: () => {}, isDestroyed: () => false }`). Tool call activity events are re-emitted as `self-heal:token` chunks for the streaming panel.
- `Claude CLI` — calls `getMcpServerConfigsForCli()` → `adapter.send(window, req, onChunk, onEvent)` via the existing `src/main/cli-adapters/claude.ts` adapter. Falls back to this if BYOK is also selected but no API key is configured.

**Investigation model**: a dedicated selector in Self-Heal settings (added in Phase 8C). Stored as `{ provider, model }` in the `settings` table. Defaults to whatever provider is active in chat. If a screenshot is attached, filters to vision-capable models only.

**MCP tool access** (per-report toggle in the report form, defaults on):
- **On**: investigator gets all connected MCP servers (via `getAvailableMcpTools()`). All tool calls are auto-approved — add `autoApprove?: boolean` parameter to `callMcpTool()` in `src/main/mcp.ts` which bypasses the `always-ask` gate. Pass this flag through `runProviderMcpToolLoop`.
- **Off**: investigator gets only three fixed inline handlers (no external MCP server required) implemented as inline handlers in the `inlineHandlers` map passed to `runProviderMcpToolLoop`:
  - `read_file(path)` — reads a workspace file
  - `list_directory(path)` — lists directory entries
  - `grep_pattern(pattern, path?)` — regex search across source files

**Context**: fresh only. System prompt = CLAUDE.md content + key file tree. User prompt = error title, stack trace, log entries, screenshot. No chat history, no wiki injection.

**Output format**: the investigation Markdown must begin with a structured YAML front-matter block:
```yaml
---
confidence: high | medium | low
affected_files:
  - src/main/foo.ts
  - src/renderer/bar.tsx
root_cause: one-line plain English summary
---
```
This is enforced via a prompt instruction. The UI uses `confidence` and `root_cause` on the report card before the user reads the full report.

**Rate-limit guard**: if an `error_reports` row is `status = 'investigating'` and `created_at > now - 5min`, block a new investigation from starting and show "Heal in progress" instead.

5. Write streamed response to `{userData}/self-heal/reports/{reportId}.md`

IPC: `safeHandle('self-heal:run-investigation', { reportId })` — streams tokens via `win.webContents.send('self-heal:token', chunk)`, activity events (tool calls) via `win.webContents.send('self-heal:activity', event)`, ends with `win.webContents.send('self-heal:investigation-done', { reportId, reportPath })`.

DB: update `error_reports.status = 'investigating'` → `'investigated'` on completion; store `report_md_path`, `investigation_model TEXT` (which model/backend was used), `investigation_rounds INTEGER` (how many tool-call rounds it took).

### 3B — Report viewer (desktop)

In the Self-Heal inner tab (Phase 9I), add a report list and viewer:

- Report list: title, **confidence badge** (from front-matter), status chip, timestamp
- Click report → opens Markdown rendered view inline
- Below the front-matter: full investigation body
- **Streaming panel**: while investigation is running, the tab shows live streamed output with tool-call activity cards (file reads, searches) — same visual pattern as the chat tool-call display
- "Accept Plan" / "Reject" / "**Revise Plan**" buttons at the bottom
  - **Revise**: opens a text area for the user to annotate the plan, sends `'self-heal:revise-plan'` → LLM produces a revised investigation with the feedback appended to context → user accepts the revision (loop max 3 rounds to prevent runaway spend)

### 3C — Report viewer (Android)

New WS event `'self-heal:report-ready'` broadcast when investigation completes, containing `{ reportId, title, confidence, rootCause, markdownSummary (first 500 chars) }`. Android shows a notification-style card with the confidence badge and root cause line. Tap opens a scrollable Markdown view with Accept/Reject/Revise actions that send `'self-heal:plan-decision'` back. Activity events during streaming broadcast as `'self-heal:activity'` so Android can show a live "Investigating…" indicator with the current tool name.

---

## Phase 4 — Fix application

**Goal:** The LLM applies the fix as actual file edits, guided by the accepted plan.

### 4A — Fix agent (main process)

**New file:** `src/main/self-heal/fix-agent.ts`

`runFix(report: ErrorReport, plan: string, providerKey: string, model: string): AsyncGenerator<FixEvent>`:

1. Parse the investigation Markdown front-matter to extract `affected_files`; use those as the file list (no guessing)
2. **Context window guard**: for each affected file, check token count before sending. Files over ~6000 tokens get truncated with a `[... truncated ...]` marker and a prompt note — same approach as `conversation-compression.ts`.
3. For each affected file: read current content, pass to LLM with instruction "apply the fix described in the plan to this file; output the complete new file content only"
4. Write the new content to a staging directory `{userData}/self-heal/staging/{reportId}/`
5. Emit `FixEvent` per file: `{ file, status: 'patched' | 'error', diff? }`
6. **Dry-run by default**: patched files remain in staging only. Workspace is NOT touched yet. The diff viewer (4B) shows the proposed changes and the user explicitly clicks **"Apply to workspace"** to copy staging → workspace (with backup of originals to `{userData}/self-heal/backups/{reportId}/`).

IPC: `safeHandle('self-heal:apply-fix', { reportId, approvedPlan })` — streams `win.webContents.send('self-heal:fix-event', event)`. Separate `safeHandle('self-heal:commit-to-workspace', { reportId })` performs the actual staging→workspace copy.

DB: `error_reports.status = 'fixing'` → `'fix-staged'` (staging only) → `'fix-applied'` (after workspace copy); store `{ patchedFiles, backupPaths }` in a JSON column.

### 4B — File diff viewer (desktop)

After staging, show a diff view per changed file in the Self-Heal tab:
- Lightweight in-app diff (split before/after) — highlight added/removed lines in a `<pre>` block. No full Monaco diff required.
- "Revert this file" button per file (removes staging copy for that file only).
- **"Apply to workspace"** button at the bottom — copies all staged files. Disabled until user has reviewed all diffs.

Ask the user: "Would you like to refactor any of the changed files?" — if yes, opens the relevant file path in the chat composer with the file pre-attached as context.

### 4C — Android: fix status

Broadcast `'self-heal:fix-applied'` with `{ reportId, patchedFiles: string[] }`. Android shows the list of changed files (read-only). A "View diff" button sends `'self-heal:get-diff'` to desktop which responds with per-file before/after text.

---

## Phase 5 — Verification (lint/typecheck/build)

**Goal:** Run the existing build pipeline against the patched workspace and surface results.

### 5A — Verification runner

**New file:** `src/main/self-heal/verifier.ts`

`runVerification(workspacePath: string): Promise<VerificationResult>`:

Reuse the existing `build:start-command` spawn pattern for:
1. `typecheck` — `npx tsc --noEmit -p tsconfig.typecheck.json`
2. `lint` — `npx eslint src/ --max-warnings 0` (new command, not currently in build-handlers)
3. `build` — `npm run build`
4. `tests` — `npm test` (already wired in `build-handlers.ts`)

Stream logs back via `win.webContents.send('self-heal:verify-log', chunk)`.

If all pass → `status: 'verified'`. If any fail → `status: 'verify-failed'` with which step failed and the relevant log lines. On failure: offer the user "retry investigation with these errors added to context" — loops back to Phase 3 with the compiler/test errors appended to the report. **Retry cap: max 2 re-investigation rounds** to prevent runaway LLM spend. After 2 failed verifications, the UI shows "Auto-fix limit reached — manual intervention required" and exposes the raw error log.

### 5B — Verification UI

In the Self-Heal tab: four status rows (Typecheck / Lint / Build / Tests) each with a spinner → green check → red X. Expandable log per step. CTA buttons at the bottom only enabled when all four are green.

---

## Phase 6 — Git commit & push

**Goal:** Commit and optionally push the fix, user controls each step.

### 6A — Git IPC handlers

**New file:** `src/main/self-heal/git-ops.ts`

Reuse `execSync`/`spawn` pattern from `build-handlers.ts`:

- `gitBranch(name: string, cwd: string)` — `git checkout -b <name>` (optional, see below)
- `gitStage(files: string[], cwd: string)` — `git add <files>`
- `gitCommit(message: string, cwd: string)` — `git commit -m <message>`
- `gitPush(cwd: string)` — `git push`
- `gitStatus(cwd: string)` — `git status --short`

IPC channels: `safeHandle('self-heal:git-branch', ...)`, `safeHandle('self-heal:git-stage', ...)`, `safeHandle('self-heal:git-commit', ...)`, `safeHandle('self-heal:git-push', ...)`.

The LLM suggests a short commit message (derived from the fix plan title + `root_cause` front-matter field); user can edit it in the UI before confirming. The handler **strips any line matching `/co.author/i`** before executing the commit — commit messages must be short, concise, and attribution-free.

### 6B — Git step UI

Sequential prompt cards shown after verification passes:

1. **"Create branch?"** — pre-fills `self-heal/{reportId-short}`. Skip button available (commits to current branch). Confirm → calls `self-heal:git-branch`.
2. **"Commit changes?"** — shows staged files, editable commit message field. Confirm → calls `self-heal:git-stage` + `self-heal:git-commit`.
3. **"Push to remote?"** — Confirm → calls `self-heal:git-push`. Skip button available.

Each card collapses with a success/skip indicator before the next appears.

### 6C — Android: git step relay

Broadcast `'self-heal:git-step'` events so Android shows the same sequential prompts. Commands sent back via WS: `'self-heal:git-confirm'` / `'self-heal:git-skip'`.

---

## Phase 7 — Reload & rollback

**Goal:** Rebuild and reload the app with the fix; safe rollback if it fails.

### 7A — Reload orchestration

After commit (or after verification-only if user skips git steps), the user is asked: "Reload app with fix?"

On confirm:
1. Run `npm run package` via the existing `build:start-command` path
2. If package succeeds: publish to local feed via existing `build:publish-update`
3. Trigger `app:download-update` + `app:install-update` via electron-updater
4. Before quit: write a `{userData}/self-heal/last-heal.json` record: `{ reportId, timestamp, patchedFiles, backupPaths, previousVersion }` — used by rollback

If the app comes back up successfully: the Self-Heal tab shows "Fix applied ✓" on next open.

### 7B — Startup rollback check

In `src/main/index.ts` app `ready` handler: check if `last-heal.json` exists and `status !== 'confirmed'`. If the app is starting up with an unconfirmed heal:
- Check if there are any startup errors (give the app 5 seconds to fully initialize)
- If errors detected OR user triggers rollback manually: execute rollback

`rollbackHeal()`:
- Copy backup files from `{userData}/self-heal/backups/{reportId}/` back to workspace
- Run package → publish → install (same as forward path but from backups)
- If rollback package also fails: show a **failsafe UI** — a minimal BrowserWindow that loads a static HTML file (not the Vite/React bundle) with: "Build failed. Choose a version to restore." + list of previous `build_records` artifacts. This failsafe window must not depend on the renderer bundle.

### 7C — Failsafe version selector

**New file:** `resources/failsafe.html` — standalone static HTML page (no framework dependencies).

Electron main opens this as a new `BrowserWindow` if the renderer fails to load within a timeout. It communicates back via `ipcRenderer` (a separate minimal preload) with:
- `failsafe:list-versions` → returns published update history
- `failsafe:install-version` (path) → spawns the installer

### 7D — Android reconnect after reload

Before the app quits for reload, broadcast `'self-heal:reloading'` via WebSocket. Android companion:
- Shows "Desktop app is reloading…" banner
- Starts a reconnect poll (retry WS connection every 3 seconds for up to 2 minutes)
- On reconnect: resumes normal session, dismisses banner, shows "Reconnected" toast

### 7E — Android rollback interface

If the reload failed and the failsafe is active, broadcast `'self-heal:failsafe-active'` with `{ versions: [{ label, path }] }`. Android shows the same version list as the failsafe HTML, and `'self-heal:install-version'` command triggers the desktop install.

---

## Phase 8 — Polish & integration

### 8A — Self-Heal tab in Settings (desktop)

Move the self-heal UI out of DeveloperTab into its own "Self-Heal" tab in SettingsPanel (beside Developer). Contains:
- Error reports list (with status chips: open / investigating / fix-applied / verified / committed / pushed / reloaded)
- Active pipeline progress (current step indicator)
- Rollback history

### 8B — Android Self-Heal screen

New screen accessible from Android settings: "Self-Heal". Shows:
- Same report list (synced from desktop via WS)
- Active pipeline step with progress
- Confirm/skip actions for each step

### 8C — Investigation settings panel

A dedicated settings section within the Self-Heal tab:

- **Investigation backend** — `BYOK (tool loop)` | `Claude CLI`. BYOK is default. CLI option only shown if `isAvailable()` returns true for the Claude CLI adapter.
- **Investigation model** — a `SelectField` showing configured providers + their available models. Filtered to vision-capable models when a screenshot is attached (`CatalogModel.capabilities.vision`). Defaults to the active chat provider. Stored as `investigation_provider` + `investigation_model` in the `settings` table.
- **Max re-investigation rounds** — numeric input, default 2, max 5. Controls the Phase 5 retry cap.

### 8D — Audit trail

Add `self_heal_history` DB table (migration): `id, report_id, status, investigation_model, investigation_backend, investigation_rounds, fix_applied_at, verification_passed, committed, pushed, reloaded, rolled_back, created_at`. This mirrors the `build_records` table pattern.

The Self-Heal tab history list (Phase 9I bottom section) reads from this table. Rollback entries are included — you can see what was fixed, which model investigated it, how many rounds it took, and whether it was eventually rolled back.

### 8E — Notifications

When investigation completes or a verification step fails, send:
- Desktop: system notification via `Notification` API
- Android: FCM push via existing `src/main/android-handlers.ts` FCM integration

---

## Critical files per phase

| Phase | New files | Modified files |
|---|---|---|
| 1 | `src/main/error-log-handlers.ts` | `src/main/index.ts`, `src/main/ipc-handlers.ts`, `src/main/database-migrations.ts`, `src/renderer/components/settings/DeveloperTab.tsx`, `src/shared/types.ts`, `src/preload/index.ts` |
| 2 | `src/main/error-report-handlers.ts`, `src/renderer/components/ErrorBoundary.tsx` | `src/renderer/App.tsx`, `src/renderer/components/settings/DeveloperTab.tsx`, `src/shared/types.ts`, `src/preload/index.ts`, Android `SettingsScreen.kt` |
| 3 | `src/main/self-heal/investigator.ts` | `src/main/mcp.ts` (add `autoApprove` param to `callMcpTool`), `src/main/tool-loop.ts` (thread `autoApprove`), `src/shared/types.ts`, `src/preload/index.ts`, `src/main/ipc-handlers.ts`, `src/renderer/components/settings/DeveloperTab.tsx` (or new SelfHealTab), Android `SettingsScreen.kt` |
| 4 | `src/main/self-heal/fix-agent.ts` | Same as Phase 3 UI files |
| 5 | `src/main/self-heal/verifier.ts` | `src/main/build-handlers.ts` (extract shared spawn util), UI files |
| 6 | `src/main/self-heal/git-ops.ts` | `src/shared/types.ts`, `src/preload/index.ts`, UI, Android WS handlers |
| 7 | `resources/failsafe.html`, `src/main/self-heal/rollback.ts` | `src/main/index.ts`, `src/main/build-handlers.ts`, Android `WsRepository.kt`, Android `SettingsScreen.kt` |
| 8 | `src/renderer/components/settings/SelfHealTab.tsx`, Android `SelfHealScreen.kt` | `src/renderer/components/SettingsPanel.tsx`, Android `SettingsScreen.kt`, `src/main/database-migrations.ts` (self_heal_history table) |

---

## Verification per phase

Each phase: `npm run typecheck && npm test` must stay green before moving on.

- **Phase 1**: trigger a renderer `console.error`, see it in the panel; trigger main-process throw, see it.
- **Phase 2**: click Report Bug, check DB row created, screenshot saved.
- **Phase 3**: submit report with MCP toggle on, watch streaming panel show tool-call activity (file reads, searches), confirm report MD written with YAML front-matter including `confidence` and `root_cause`. Test revise loop: annotate and re-submit, confirm revised report replaces the first. Test rate-limit: submit a second report while one is investigating, confirm it's blocked.
- **Phase 4**: accept plan, confirm files patched, diff shown, backup written.
- **Phase 5**: verify typecheck/lint/build all show correct pass/fail in UI.
- **Phase 6**: commit a test fix, confirm commit message has no co-author lines; push, confirm remote updated.
- **Phase 7**: trigger reload, confirm app restarts; inject a bad patch, confirm rollback executes and failsafe appears if needed; confirm Android reconnects.
- **Phase 8**: full end-to-end run from error capture to reloaded app, controlled entirely from the Android companion. Confirm `self_heal_history` row written with correct model/backend/rounds. Confirm investigation settings save and reload correctly. Test CLI backend path if Claude CLI is installed.

---

## Phase 9 — Developer UI redesign

**Goal:** Transform the Developer tab from a long, dense, vertical scroll into a structured, navigable workspace. The self-heal pipeline from Phases 1–8 should feel like a first-class citizen alongside the existing build tools.

### Problems with the current UI

- **Single infinite scroll**: all 9 sections (desktop + Android) live on one vertical axis, ~590 lines of TSX, no internal navigation. Finding anything requires scrolling past unrelated sections.
- **Plain `<pre>` logs**: no ANSI colour stripping, no copy-line, no auto-scroll toggle, no timestamps.
- **`<details>` collapsibles** used for FCM, Distribution Options, and Published History — inconsistent with the rest of the settings modal which uses no `<details>` elements. Closed state hides important status info.
- **Android build is co-located with desktop build**: different concerns, different workflows, same panel. Mentally heavy.
- **Build history is list-only**: no way to see a previous log, no expand-on-click.
- **Preflight checks fire in isolation**: the "Run checks" button has no relationship to the build flow. Results disappear on re-render.
- **Status text is transient**: "✓ Completed successfully" vanishes on next refresh; there is no persistent visual state.
- **No pipeline sense**: the workflow is Preflight → Build → Publish → Launch, but the UI presents them as four unrelated sections.

### 9A — Internal tab bar within Developer

Replace the single-scroll layout with a horizontal segmented tab bar at the top of DeveloperTab, using the existing `SegmentedTabs` primitive from `src/renderer/components/ui/primitives.tsx`.

**Tabs:**

| Tab | Contents |
|---|---|
| **Desktop** | Workspace, Build commands, Preflight, Log, History, Feed, Launch |
| **Android** | Android workspace, Build commands, Log, History, Signing, ADB, Feed, FCM |
| **Self-Heal** | Error reports list, active pipeline steps (Phases 1–8 UI surfaces here) |
| **Console** | In-app error/log console (Phase 1B) |

The `category` state in `DeveloperTab.tsx` drives which panel is rendered. Only the active panel is mounted (no `hidden` div trick — actual conditional render to avoid rendering all four simultaneously).

### 9B — Desktop build tab: pipeline layout

The four steps (Preflight → Build → Publish → Launch) are now presented as a **vertical pipeline** within the Desktop tab:

```
[ Step 1: Preflight    ] [Run] → status indicators inline
[ Step 2: Build        ] [typecheck] [test] [build] [package]
[ Step 3: Publish feed ] [Publish] → version badge + server URL
[ Step 4: Launch       ] [Launch dev] (only enabled after successful build)
```

Each step is a card. Cards have a left-edge colour bar: gray (idle) → blue (running) → green (done) → red (failed). Cards collapse to a single summary line when done and not active, showing the outcome badge.

Workspace info (branch, commit, dirty, version) moves into a compact header strip above the pipeline, always visible.

### 9C — Build log upgrade

Replace the plain `<pre>` block with a proper terminal-style component `src/renderer/components/BuildLog.tsx`:

- **ANSI escape code stripping** — remove `\x1b[...m` sequences so colour codes from tsc/eslint/npm don't appear as raw characters (or optionally render them as actual colours — basic 16-colour ANSI map)
- **Timestamps** — prepend each line with a faint `HH:MM:SS` stamp
- **Auto-scroll with override** — scrolls to bottom automatically; if the user scrolls up, auto-scroll pauses and a "↓ Jump to bottom" button appears at the bottom-right
- **Copy-all button** — copies raw log text to clipboard
- **Line count** — shows `N lines` in the header bar
- **Resizable height** — use the existing `ResizeHandle` pattern (pointer-capture, same as other resizable panels) to let the user drag the log panel taller

The `BuildLog` component is reused identically in both Desktop and Android tabs and in the Self-Heal verification step (Phase 5).

### 9D — Build history: expandable rows

Clicking a history row expands it inline to show:
- The stored `log_tail` (last 4096 chars) in the same `BuildLog` component (read-only, no timestamps, no resize)
- Artifact paths (for Android records) as copyable monospace links
- A "Re-run" button that starts the same command again

Collapsed row keeps the current single-line layout. Only one row can be expanded at a time.

### 9E — Preflight: persistent results + auto-run

Preflight results are persisted in component state (not cleared on re-render). A subtle badge next to the "Desktop" tab label shows the worst preflight status (green dot / yellow dot / red dot) at all times so the user can see problems without navigating in.

Optionally: run preflight automatically when the tab is first opened (debounced, not on every render) and surface any failures as a banner above the pipeline.

### 9F — Android tab: signing config as a modal

Move the signing config inputs (keystore path, passwords, key alias) out of the inline tab flow and into a small modal opened by a "Configure signing…" button. The inline Android tab shows only the signing status (✓ Configured / ✗ Not configured) with the button to edit.

This removes ~25 lines of inputs from the main scroll and keeps the Android tab focused on the build/deploy workflow.

### 9G — Feed & Published History: unified version shelf

Replace the `<details>` collapsibles for Published History (both desktop and Android) with a persistent "Version shelf" — a compact scrollable list always visible at the bottom of the Feed section. Each row: version badge + date + status (current / backup) + Reinstall/Restore button. The shelf has a fixed max-height (4 rows visible, scrollable).

This makes previously published versions immediately visible without an extra click to expand.

### 9H — FCM config: move to Mobile tab

The FCM service account JSON textarea has no relationship to the Android build workflow — it is a connection/notification setting. Move it to `MobileTab.tsx` alongside the WebSocket server config. Remove it from DeveloperTab entirely.

### 9I — Self-Heal tab (inside Developer)

The "Self-Heal" inner tab is where the Phase 1–8 pipeline surfaces. Layout:

**Top section — Active pipeline** (only visible when a heal is in progress):
- Horizontal step indicator: Error Captured → Investigating → Plan Accepted → Fixing → Verified → Committed → Reloaded
- Current step highlighted; completed steps show a green tick; failed steps show a red X
- Below the step indicator: the current step's detail card (e.g. streaming investigation output, diff view, git commit form, verification rows)

**Bottom section — Report history**:
- Same list-style as build history: title, status chip, date, "Resume" button (if in-progress), "View report" button (if investigated)
- Clicking "View report" opens the Markdown investigation report inline (same `BuildLog`-style scrollable area, rendered as Markdown)

### 9J — Console tab (inside Developer)

The in-app console from Phase 1B gets its own inner tab rather than a collapsible section. Layout:

- Level filter pill row at the top (All / Error / Warn / Info)
- Log list: each entry is a single row — timestamp (monospace, faint), level badge (coloured pill), message, expandable stack trace (click to expand)
- "Clear" button top-right, "Copy all" button
- Unread error count badge on the "Console" tab label (resets to zero when tab is visited)

### Critical files

- `src/renderer/components/settings/DeveloperTab.tsx` — structural rewrite into tabbed layout; existing logic stays, layout refactored
- `src/renderer/components/BuildLog.tsx` — new reusable terminal-style log component
- `src/renderer/components/settings/MobileTab.tsx` — receives FCM config section moved from DeveloperTab
- `src/renderer/components/ui/primitives.tsx` — `SegmentedTabs` already exists; verify it supports icon badges for unread counts (extend if needed)

### Verification

- All four inner tabs render without errors; `npm run typecheck` clean
- Build log: run a typecheck, confirm ANSI codes are stripped, timestamps appear, auto-scroll works, resize handle works
- History: click a row, confirm it expands and shows log_tail
- Signing config modal: opens and saves correctly
- FCM config: confirm it still saves from MobileTab
- Self-Heal tab: visible and matches Phase 8 pipeline
- Console tab: unread badge increments on new error, clears on tab visit

---

## Phase 10 — Project Generator

**Goal:** An AI-assisted wizard that walks the user through creating a fully configured project — instructions, scope, milestones, variables — and automatically assembles a specialist agent team with the most capable agent set as orchestrator leader. The entire flow is available on both desktop and Android.

### Feasibility

Fully feasible with existing infrastructure. The complete IPC chain already exists:
- `project:create(name, color)` → `ProjectRow`
- `agent:create(config)` × N → `AgentConfig` with generated ID
- `project:add-agent(projectId, agentId)` × N
- `project:set-primary-agent(projectId, leaderAgentId)`
- `project:update-config(projectId, partialConfig)` — covers instructions, variables, scope rules, milestones, orchestrationEnabled

No new backend IPC handlers are required for the core creation flow. The main new backend work is the AI generation logic itself.

---

### 10A — Entry point: replace New Project button

The existing "New Project" button in `src/renderer/components/section-pane/ProjectsPane.tsx` is replaced with a click that opens the Project Generator wizard modal. No quick-create shortcut is retained — the wizard is the only path.

The modal is a full-screen overlay (same visual weight as the existing `ProjectSettingsPanel` modal) with a **two-column layout**:
- **Left column** (40%): live draft preview — project name, colour swatch, instructions excerpt, scope rule count, milestone count, agent team list with role badges. Updates in real time as the AI fills in values.
- **Right column** (60%): the chat conversation panel.

Nothing is written to the database until the user confirms at the final step. All generated state is held in a local `draftProject` + `draftAgents[]` object in component state. If the modal is closed at any point before confirmation, everything is discarded.

---

### 10B — Wizard conversation flow (main process)

**New file:** `src/main/project-generator.ts`

`runProjectGeneration(conversationHistory: ProviderMessage[], existingAgents: AgentConfig[], onChunk: (chunk: string) => void): Promise<ProjectGeneratorOutput>`

The AI is given a structured system prompt that:
1. Describes its role: a project setup assistant that produces a structured JSON output
2. Lists all of the user's **existing agents** (id, name, icon, systemPrompt excerpt) so it can match roles to real agents
3. Describes every field in `ProjectConfig` it can populate (instructions, variables, inScope/outOfScope, milestones)
4. Instructs it to respond conversationally until it has enough information, then emit a final `<project-spec>` JSON block

The conversation loop:
1. First turn: AI asks what the project is about and what kind of work it involves (2–3 open questions max)
2. Subsequent turns: AI follows up on specifics (root directory? milestones? tools needed? any scope restrictions?)
3. Final turn: when confident it has enough context, AI emits a structured `<project-spec>` block alongside a plain-text summary

The `<project-spec>` JSON shape:
```typescript
{
  name: string
  color: string   // one of the 8 allowed colours
  instructions: string
  variables: { key: string; value: string }[]
  inScope: { description: string; pathGlob?: string }[]
  outOfScope: { description: string; pathGlob?: string }[]
  milestones: { title: string; description?: string; status: 'active' | 'upcoming' }[]
  orchestrationEnabled: boolean
  defaultModel?: string
  agents: {
    role: string          // e.g. "Lead Architect", "Code Reviewer", "Test Engineer"
    description: string   // what this specialist does in the project
    existingAgentId?: string  // set if an existing agent is a good match
    newAgent?: {          // set if a new agent should be created
      name: string
      icon: string        // emoji
      systemPrompt: string
      temperature: number
      responseFormat: 'default' | 'concise' | 'detailed' | 'code-only'
    }
    isLeader: boolean     // exactly one agent has this true
  }[]
}
```

**Matching logic**: for each role the AI identifies, it checks existing agents by comparing the role description against agent `systemPrompt` and `name`. Cosine similarity is overkill — a simple keyword/semantic prompt comparison via the same LLM pass works (the AI is already reasoning about the project and has all agent summaries in context).

IPC: `safeHandle('project-generator:chat', { messages: ProviderMessage[] })` — streams tokens via `win.webContents.send('project-generator:token', chunk)`, ends with `win.webContents.send('project-generator:spec-ready', projectSpec)` when the `<project-spec>` block is detected in the stream.

Uses the active chat provider + model. No separate model setting — this is a one-shot generation, not a long-running investigation.

---

### 10C — Live draft preview (desktop)

As the conversation progresses, the left-column draft preview updates in real time:

- **Before `<project-spec>`**: the AI's conversational responses are shown in the chat panel; the draft preview shows only what's been confirmed so far (name from first mention, colour guessed from domain, etc.). Fields not yet determined show greyed placeholder text.
- **When `<project-spec>` arrives**: the draft preview fully populates. The chat panel shows the AI's summary text. A **"Looks good — Create project"** button and an **"Edit before creating"** button appear at the bottom.

**"Looks good — Create project"**: executes the IPC chain (10E) and transitions to the project.

**"Edit before creating"**: switches the modal to a standard form view (same fields as the existing `ProjectSettingsPanel` tabs but pre-populated from the spec). User can tweak anything before confirming. Editing agents shows a list with name/icon/role/prompt fields, a "Remove" button per agent, and an "Add another" button.

---

### 10D — Agent team preview

The draft preview's agent section shows each identified role as a card:
- Role badge (e.g. "Lead Architect ★" for the leader)
- Agent name + icon
- "New" chip if the AI is proposing to create a new agent, or the agent's existing icon if reusing
- System prompt excerpt (first 80 chars)

The leader is visually distinguished with a crown/star indicator — same visual language as the existing `TeamTab` primary agent display.

---

### 10E — Confirmation & creation chain

On confirm, a loading overlay runs the following sequence, showing progress per step:

```
1. Creating project…          → project:create(name, color)
2. Updating project config…   → project:update-config(id, { instructions, variables, ... })
3. Creating agent: [name]…    → agent:create(config)  [repeated for each new agent]
4. Adding agents to project…  → project:add-agent(projectId, agentId)  [×N]
5. Setting lead agent…        → project:set-primary-agent(projectId, leaderId)
6. Enabling orchestration…    → project:update-config(id, { orchestrationEnabled: true })
```

If any step fails, the entire creation is rolled back:
- If `project:create` succeeded but a later step fails: call `project:delete(id)` to clean up
- Agent records created before the failure are deleted via `agent:delete(id)` (add this handler if it doesn't exist — check first)
- The modal stays open and shows the error with a "Try again" button

On success: modal closes, the new project is selected in `useAppStore`, a new conversation is opened immediately (same flow as clicking "New Chat" in a project context).

---

### 10F — Android: project generator via WebSocket

The Android companion gets a "Generate Project" screen accessible from the main menu or the projects list empty state.

**WS event flow:**

1. Android sends `'project-generator:start'` — desktop opens a headless generation session (no modal, generation runs server-side)
2. Desktop relays AI tokens back via `'project-generator:token'` WS broadcasts — Android shows the streaming conversation
3. Android sends `'project-generator:message'` with the user's reply text — desktop appends to conversation history and continues
4. When `<project-spec>` is detected, desktop broadcasts `'project-generator:spec-ready'` with the full spec — Android shows the draft summary (name, agent list, milestone count)
5. Android sends `'project-generator:confirm'` or `'project-generator:cancel'`
6. On confirm: desktop runs the creation chain (10E) and broadcasts `'project-generator:created'` with `{ projectId, name }` — Android navigates to the project's chat screen

The Android UI is a chat-style screen with the AI conversation in the message list and a text input at the bottom — the same `ChatScreen` layout repurposed as a wizard session.

---

### 10G — Suggested agent roles by domain

The system prompt for the generator includes a soft catalogue of common specialist archetypes keyed by domain, to help the LLM make sensible suggestions even when the user's description is vague:

| Domain | Typical specialist roles |
|---|---|
| Software project | Lead Architect, Code Reviewer, Test Engineer, Documentation Writer |
| Research project | Research Lead, Literature Reviewer, Data Analyst, Report Writer |
| Content / writing | Editor-in-Chief, Content Writer, SEO Specialist, Proofreader |
| Data pipeline | Pipeline Architect, Data Engineer, Quality Checker, Reporting Analyst |
| Generic | Project Manager (leader), General Specialist × 2 |

These are prompt hints only — the LLM adapts based on the user's actual description.

---

### Critical files

| Layer | New files | Modified files |
|---|---|---|
| Main | `src/main/project-generator.ts` | `src/main/ipc-handlers.ts`, `src/shared/types.ts`, `src/preload/index.ts`, `src/main/project-handlers.ts` (add `project:delete` if missing) |
| Renderer | `src/renderer/components/ProjectGeneratorModal.tsx`, `src/renderer/components/project-generator/DraftPreview.tsx`, `src/renderer/components/project-generator/AgentCard.tsx` | `src/renderer/components/section-pane/ProjectsPane.tsx` (replace New Project button) |
| Android | `android/.../ui/screens/ProjectGeneratorScreen.kt` | Android `WsRepository.kt` (handle new WS events), Android `HomeScreen.kt` (add entry point) |

---

### Verification

- Open app, click "New Project" — wizard modal opens
- Have a conversation describing a software project — confirm draft preview updates in real time as AI fills in fields
- Confirm `<project-spec>` block is detected and edit view populates correctly
- Click "Create project" — confirm all 6 creation steps complete, no orphaned records
- Cancel mid-conversation — confirm no DB records were created
- Abandon after `<project-spec>` shown but before confirm — confirm no DB records created
- Check created project in settings: instructions, scope, milestones, agent team all match the generated spec
- Check agent team tab: leader has `is_primary = 1`, orchestration is enabled
- Start a chat in the new project — confirm orchestration routes to leader agent
- Android: start generator from companion, complete conversation, confirm project appears on both desktop and Android

---

## Phase 11 — Feature Generator

**Goal:** Let a developer evolve Nexy through the app interface itself. The feature starts from a guided prompt flow, turns the request into an approved implementation plan, creates a task-specific specialist team, then uses the same staged diff, verification, commit, and reload pipeline planned for self-heal.

Unlike self-heal, this flow is not error-driven. It is developer-intent-driven: "add this feature", "change this behavior", "refactor this area", or "build this artifact".

### 11A — Developer entry point

Add a dedicated **Feature Generator** inner tab under Developer options, separate from Self-Heal and Project Generator.

Initial layout:

- Left: feature run history and current run status
- Center: guided prompt conversation
- Right: live spec preview and specialist team panel

The tab should make the autonomy level explicit. The target end state is **Plan + apply + verify + commit + reload**, but each major step requires approval:

1. Approve generated feature spec
2. Approve implementation plan
3. Approve staged diffs before workspace writes
4. Approve commit
5. Approve reload

### 11B — Guided discovery prompt

The first pass is a structured conversation. The assistant asks targeted questions before generating a plan:

- What should be added or changed?
- Is this a feature, bug fix, refactor, UI change, integration, documentation task, or developer tooling task?
- Which surfaces are involved: desktop main process, renderer UI, Android, shared protocol, database, build/release tooling, docs, or settings?
- What should remain out of scope?
- What are the acceptance criteria?
- Are DB migrations, Android changes, dependency changes, or public API/protocol changes allowed?
- Should the result be implemented now, or should this run only create a spec/roadmap item?
- Does this target the Nexy repo, or a user-selected workspace/artifact project?

The conversation should prefer asking a small number of high-signal questions per turn. It should not generate a plan until the requested change, target surfaces, constraints, and acceptance criteria are clear enough for review.

### 11C — Structured feature spec

The model emits a final `<feature-spec>` JSON block:

```ts
{
  title: string
  type: 'feature' | 'bugfix' | 'refactor' | 'ui' | 'integration' | 'docs' | 'tooling'
  targetWorkspace: {
    kind: 'nexy-repo' | 'user-workspace'
    path?: string
  }
  targetAreas: ('desktop-main' | 'desktop-renderer' | 'android' | 'shared' | 'database' | 'build' | 'docs')[]
  userStory: string
  acceptanceCriteria: string[]
  constraints: string[]
  outOfScope: string[]
  risks: string[]
  likelyAffectedFiles: string[]
  verificationPlan: string[]
  autonomy: 'plan-only' | 'staged-diffs' | 'apply-verify-commit-reload'
}
```

The UI validates the spec before showing approval actions. Invalid specs stay in draft mode and ask the model to repair the JSON.

### 11D — Specialist team generation

After the spec is approved, the system proposes a task-specific team:

- **Lead implementer** — owns the implementation plan and final integration
- **Domain specialist(s)** — selected based on target areas, such as Renderer UI, Android, IPC/Protocol, Database, Build/Release, or Testing
- **Reviewer** — checks regressions, scope control, and missing tests
- **Verifier** — owns typecheck/test/build interpretation and retry recommendations

Specialists should be **temporary per feature run by default**. This avoids polluting the user's persistent agent list with one-off roles. At the end of a successful run, the UI can offer **Promote to persistent agent** for any specialist whose instructions are broadly useful.

Existing agents can still be reused when a strong match exists. The team proposal should show whether each specialist is temporary or mapped to an existing agent.

### 11E — Specialist activity panel

The Feature Generator tab includes a specialist work panel:

- Compact card per specialist: role, status, current task, files inspected, and last activity
- Click to expand: streaming output, tool calls, reviewed files, proposed changes, concerns, and handoff notes
- Lead view: combined plan, dependency ordering, and current pipeline step

This keeps multi-agent work inspectable without forcing all specialist output into one chat transcript.

### 11F — Implementation plan approval

The lead agent converts the approved feature spec into an implementation plan:

- Files likely to change
- Ordered implementation steps
- DB migrations, IPC/WS channels, preload changes, and Android protocol changes if needed
- Test and verification commands
- Rollback considerations
- User-visible behavior changes

The developer must approve this plan before any code-generation or file-edit staging begins.

### 11G — Code application through staged diffs

Once approved, the Feature Generator uses the same staged diff workflow as self-heal:

1. Read affected files and gather context
2. Generate patched complete-file content into a staging directory
3. Produce diffs
4. Let the developer inspect and approve diffs
5. Apply approved diffs to the workspace with backups
6. Run verification

No generated code is written directly to the workspace before explicit diff approval.

### 11H — Verification, commit, and reload

After workspace application, the flow reuses the self-heal pipeline:

- Typecheck
- Lint
- Build
- Tests
- Optional Android verification when Android files changed
- Commit with editable generated commit message
- Optional push
- Reload app after explicit approval
- Rollback if startup fails

The target autonomy is **Plan + apply + verify + commit + reload**, but every irreversible step remains gated.

### 11I — Artifact workspace mode

Design the feature generator so it can later target user-selected workspaces. This enables a future mode where users can create and evolve their own artifacts, apps, docs, or project outputs through the same guided interface.

Initial implementation can restrict writes to the Nexy repo. The data model and spec should still include `targetWorkspace` so the workflow does not need to be redesigned later.

### 11J — Persistence

Add a feature-run history table, or generalize the self-heal history table if that proves cleaner:

```sql
feature_generator_runs(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  target_workspace_kind TEXT NOT NULL,
  target_workspace_path TEXT,
  spec_json TEXT NOT NULL,
  team_json TEXT,
  plan_markdown_path TEXT,
  staged_files_json TEXT,
  applied_files_json TEXT,
  verification_json TEXT,
  commit_sha TEXT,
  reloaded INTEGER DEFAULT 0,
  rolled_back INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

Run statuses should include: `drafting`, `spec-ready`, `plan-ready`, `staging`, `diff-ready`, `applied`, `verifying`, `verified`, `committed`, `reloaded`, `failed`, `rolled-back`, `cancelled`.

### 11K — Critical files

| Layer | New files | Modified files |
|---|---|---|
| Main | `src/main/feature-generator.ts`, `src/main/feature-generator/team.ts`, `src/main/feature-generator/spec.ts` | `src/main/ipc-handlers.ts`, `src/main/database-migrations.ts`, `src/shared/types.ts`, `src/preload/index.ts` |
| Renderer | `src/renderer/components/settings/FeatureGeneratorTab.tsx`, `src/renderer/components/feature-generator/SpecPreview.tsx`, `src/renderer/components/feature-generator/SpecialistPanel.tsx`, `src/renderer/components/feature-generator/RunHistory.tsx` | `src/renderer/components/settings/DeveloperTab.tsx` |
| Shared pipeline | none initially | self-heal staging, verification, git, and reload modules should expose reusable functions rather than UI-only handlers |

### Verification

- Open Developer options and confirm Feature Generator is its own tab
- Start a run and confirm the assistant asks clarifying questions before producing a spec
- Confirm invalid `<feature-spec>` JSON is rejected and repaired
- Approve a spec and confirm a specialist team is proposed
- Expand specialist cards and confirm individual activity streams are visible
- Approve an implementation plan and confirm code is staged, not written directly
- Review diffs and apply to workspace only after approval
- Run verification and confirm failures can loop back into planning
- Commit with editable message and skip/push options
- Reload app after approval and confirm rollback path still works
- Confirm run history stores spec, team, plan, changed files, verification result, commit SHA, and reload status

---

## Phase 12 — Artifact Generator

**Goal:** Let users generate any kind of deliverable through Nexy: documents, code files, UI assets, reports, prompt packs, agent configs, project plans, data files, or small app/workspace outputs. Artifacts can be global or attached to a project, are saved to a defined storage location, are versioned, and can be exported.

Working definition:

> An artifact is a global-or-project-scoped, versioned deliverable made of one or more files plus metadata, generated through a guided prompt and review flow, saved to a configured workspace/storage location, and optionally referenced from the chat where it was created.

### 12A — Scope and ownership model

Artifacts support two scopes:

- **Project artifact** — belongs to a project, appears in that project's Artifacts tab, and can be referenced in project chats.
- **Global artifact** — not tied to a project, stored in the global artifact library and available from a global Artifacts view.

Project artifacts generated from a chat should also insert a chat-visible reference card so the conversation retains context:

- Artifact title
- Artifact kind
- Version number
- Primary file path or preview
- Open artifact action
- Export action

### 12B — Artifact kinds

Artifacts are intentionally broad. Initial kinds:

- `document` — PRDs, briefs, reports, plans, articles, specs
- `code` — scripts, components, config files, small libraries
- `ui` — page mockups, screen specs, component sets, HTML/CSS prototypes
- `data` — JSON, CSV, transformed datasets, analysis outputs
- `prompt` — prompt packs, system prompts, agent instructions
- `agent-config` — generated agent/team configuration files
- `plan` — milestone plans, test plans, launch plans
- `bundle` — multi-file deliverables that do not fit one category
- `other` — fallback for user-defined deliverables

The generator should not assume artifacts are documents. It asks for the desired format and file outputs before generation.

### 12C — Storage location

Add a configurable artifact storage root in settings. Default options:

- App-managed user data path, for users who do not care where files live
- User-selected global folder, for users who want direct filesystem access
- Project workspace subfolder, for project-scoped artifacts when the project has a workspace path

Suggested folder layout:

```text
artifacts/
  global/
    {artifactSlug}/
      v001/
      v002/
  projects/
    {projectId}/
      {artifactSlug}/
        v001/
        v002/
```

Every version writes a manifest file next to the generated files:

```json
{
  "artifactId": "string",
  "versionId": "string",
  "version": 1,
  "title": "string",
  "kind": "document",
  "createdAt": 0,
  "sourceConversationId": "optional",
  "files": [
    {
      "path": "relative/path.md",
      "mediaType": "text/markdown",
      "role": "primary"
    }
  ]
}
```

### 12D — Database model

Add artifact persistence with enough structure to browse without reading the filesystem on every render:

```sql
artifacts(
  id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  description TEXT,
  storage_root TEXT NOT NULL,
  current_version_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)

artifact_versions(
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  spec_json TEXT,
  manifest_json TEXT NOT NULL,
  source_conversation_id TEXT,
  source_message_id TEXT,
  created_by_agent_ids TEXT,
  created_at INTEGER NOT NULL
)

artifact_files(
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  absolute_path TEXT NOT NULL,
  media_type TEXT NOT NULL,
  role TEXT NOT NULL,
  size_bytes INTEGER,
  checksum TEXT
)

artifact_chat_refs(
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  project_id TEXT,
  conversation_id TEXT NOT NULL,
  message_id TEXT,
  created_at INTEGER NOT NULL
)
```

Artifact statuses should include: `draft`, `generating`, `ready`, `exported`, `archived`, `failed`.

### 12E — Guided generation flow

The artifact generator asks:

- What deliverable do you want to create?
- Should it be global or attached to the current project?
- What format and files should be produced?
- Who is the audience?
- What constraints, style, or source material should it follow?
- Should existing project wiki/context/chat history be used?
- What export formats should be prepared?
- What should count as done?

The model emits an approved `<artifact-spec>` before writing files:

```ts
{
  title: string
  kind: 'document' | 'code' | 'ui' | 'data' | 'prompt' | 'agent-config' | 'plan' | 'bundle' | 'other'
  scope: {
    type: 'global' | 'project'
    projectId?: string
  }
  intendedUse: string
  audience?: string
  outputFiles: {
    path: string
    mediaType: string
    role: 'primary' | 'supporting' | 'preview' | 'source'
    description?: string
  }[]
  sourceContext: {
    useProjectInstructions: boolean
    useProjectWiki: boolean
    useConversationContext: boolean
    referencedFiles: string[]
  }
  acceptanceCriteria: string[]
  exportFormats: ('markdown' | 'pdf' | 'html' | 'json' | 'zip' | 'raw-files')[]
}
```

The user approves the spec before generation starts.

### 12F — Agent/team usage

Project artifacts use the project's existing agent team. The primary/project lead agent coordinates the generation, and specialist agents contribute according to their configured roles.

Global artifacts can use:

- The currently selected/default agent
- A user-selected agent
- A temporary small team proposed by the generator if no project team exists

The first implementation should prioritize project artifacts using existing project teams, because that matches the current project model and avoids inventing a second team system too early.

### 12G — Project Artifacts tab

Add an **Artifacts** tab to project settings or the project workspace surface. It should support:

- List artifacts by title, kind, status, updated date, and current version
- Filter by kind/status
- Open current version
- Browse version history
- Show generated file manifest
- Reveal/copy file path
- Export current version
- Archive artifact

The chat window should render artifact reference cards inline when a generation run completes from a project chat.

### 12H — Versioning

Every generation or revision creates a new immutable version. Version metadata includes:

- Version number
- Source prompt/spec
- Source conversation/message, if any
- Agent IDs involved
- File manifest
- Revision notes
- Checksums

The artifact's `current_version_id` points to the latest accepted version. Older versions remain available for export and comparison.

### 12I — Export

Export should operate on a specific artifact version:

- `raw-files` — copies the version folder or selected files
- `zip` — packages the version folder
- `markdown` — exports primary Markdown-compatible files
- `html` — renders document/UI artifacts where applicable
- `json` — exports manifest and structured outputs
- `pdf` — renders supported document/HTML artifacts to PDF

Not every artifact kind supports every export format. The UI should show only valid exports based on files/media types.

### 12J — Critical files

| Layer | New files | Modified files |
|---|---|---|
| Main | `src/main/artifacts.ts`, `src/main/artifact-generator.ts`, `src/main/artifact-export.ts` | `src/main/ipc-handlers.ts`, `src/main/database-migrations.ts`, `src/shared/types.ts`, `src/preload/index.ts`, `src/main/project-handlers.ts` |
| Renderer | `src/renderer/components/ArtifactGeneratorModal.tsx`, `src/renderer/components/artifacts/ArtifactList.tsx`, `src/renderer/components/artifacts/ArtifactCard.tsx`, `src/renderer/components/artifacts/ArtifactVersionHistory.tsx`, `src/renderer/components/artifacts/ArtifactReferenceCard.tsx` | `src/renderer/components/ProjectSettingsPanel.tsx`, project chat rendering components, project section panes |
| Android | TBD after desktop MVP | Android project detail/chat screens can later show artifact reference cards and artifact lists |

### Verification

- Create a global artifact and confirm files are written under the configured global storage root
- Create a project artifact and confirm it appears in the project's Artifacts tab
- Generate an artifact from project chat and confirm a chat reference card is inserted
- Revise an artifact and confirm a new immutable version is created
- Confirm older versions remain readable/exportable
- Export supported formats and confirm files are valid
- Confirm unsupported export formats are hidden or disabled
- Confirm project agent team is used for project artifacts
- Confirm storage paths are validated and cannot escape the configured artifact root/workspace
