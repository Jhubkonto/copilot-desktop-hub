# Roadmap: Round 8 — Workflow Modes, Sync, Android Polish, Per-Chat Modes

Drafted 2026-07-08.

## Summary

Round 8 closes the workflow-mode gap between desktop and Android, makes manual workflows a real synced/persisted feature instead of an inert desktop-only concept, adds status indicators and guided UX in chat, and clears UI polish debt in the Android project/agent settings screens plus a new per-chat thinking/approval-mode selector.

Key findings from the current codebase that shape this roadmap:

- Desktop already has a real tri-state `workflowMode: 'single-agent' | 'manual-delegation' | 'orchestrated'` (`src/shared/types.ts:180-185`), a segmented-control UI in `TeamTab.tsx`, and full manual-workflow persistence (`manual_workflow_runs` / `manual_workflow_run_steps` tables, migration v62, CRUD IPC in `manual-workflow-runs.ts`, generator in `manual-workflow-generator.ts`, viewer UI in `WorkflowTab.tsx`).
- **Android has no `workflowMode` concept at all** — only a boolean `orchestrationEnabled` (`WsEvent.kt:793`, `ProjectConfigPayload.kt`). It cannot see or set "manual" mode.
- **`manual-delegation` is inert at chat-send time** — `chat-handlers.ts:368` only branches on `workflowMode === 'orchestrated'`. Manual mode currently has zero runtime effect beyond unlocking the Workflow tab's generator UI and a manual "Start in chat" button.
- **Manual workflow runs are desktop-only persisted state** — no WS command exposes `manual-workflow-runs:*` CRUD to Android, and Android's `ManualWorkflowScreen.kt` is a stateless, non-persisted chat generator ("isn't saved — copy each step's prompt before leaving").
- Desktop's `project:update-config` (both Electron IPC and WS paths) never calls `broadcastToMobile` — config changes don't proactively push to connected Android clients.
- No chat window (desktop or Android) shows any persistent workflow-mode or auto-approve indicator today. `TeamActivityBlock.tsx` is message-timeline UI, not a mode badge.
- Desktop's Danger Zone pattern (`SettingsTab.tsx:428-497`: red divider, `AlertTriangle` icon, uppercase label, confirm-gated toggle) is a clean template Android only partially replicates today (ad-hoc red card, no "Danger Zone" label).
- Android's "+ New chat" sheet (`HomeScreen.kt`, `NexySearchField` + sectioned `LazyColumn` of `NewChatItem`) is materially nicer than `AddAgentToProjectSheetContent`'s flat list.
- Thinking effort and tool-approval mode exist only at the agent-config level on both platforms (`AgentConfig.thinkingEffort`, `AgentConfig.fullAutoApprove`, plus Android's per-tool `approvalOptions`) — there is no per-conversation override anywhere.
- No tap-to-reveal info popover component exists on Android (`NexyInfoDialog` is a full modal — the closest fallback).

## Sequencing rationale

Phases are dependency-ordered: sync/data-model foundation first (Phases 1–2), then chat UX built on top of it (Phases 3–4), then independent Android UI polish and the per-chat mode selector last (Phases 5–7), which don't depend on the earlier phases and could ship in parallel with them if resourcing allows.

## Issue → Phase map

| # | Issue | Phase |
|---|---|---|
| 1 | Workflow mode ("single"/"manual"/"orchestrated") not viewable/settable on Android | Phase 1 |
| 2 | Manual workflow generated on Android doesn't appear on desktop | Phase 2 |
| 3 | No indication of active workflow mode in the chat window | Phase 3 |
| 4 | Manual workflow mode is unhandled/inert in chat — needs guided UX | Phase 4 (depends on 1, 2) |
| 5 | Android project settings UI polish (+Add agent, tool placement, sticky save, delete) | Phase 5 |
| 6 | Android agent settings UI polish (sticky save, info icons, Danger Zone, auto-approve indicator) | Phase 6 (indicator → Phase 3) |
| 7 | Per-chat thinking effort + tool approval mode selector | Phase 7 |

---

## Phase 1 — Workflow Mode Parity on Android

**Addresses:** Issue #1

**Goal:** Android can view and set the same `single-agent` / `manual-delegation` / `orchestrated` workflow mode as desktop, and config changes propagate live between the two.

**Key changes:**
- Add a `workflowMode` string field to Android's `ProjectSettingsConfig` (`android/.../data/model/WsEvent.kt:793`) and to the outbound `ProjectConfigPayload.kt`, parsed in `WsEventParser.kt`. Mirror desktop's back-compat derivation from the `orchestrationEnabled` boolean, the same way `parseProjectConfig()` does (`src/main/project-handlers.ts:140-201`), so older clients/servers degrade gracefully.
- Replace `ProjectConfigScreen.kt`'s boolean "Orchestration" switch with a 3-option segmented control matching `src/renderer/components/project-settings/TeamTab.tsx:110-202` (Single / Manual / Orchestrated), including the `canOrchestrate` rule that disables Orchestrated when the project has fewer than 2 agents.
- Close the live-sync gap: `project-handlers.ts`'s `project:update-config` (Electron IPC path) and the WS-path handler (`src/main/ws-handlers.ts:891-919`) currently never call `broadcastToMobile`. Add that push so a workflow-mode change made on either desktop or Android reaches the other without a manual refetch.

**Acceptance criteria:**
- Setting workflow mode on desktop is reflected in Android's `ProjectConfigScreen` without restarting the app, and vice versa.
- Orchestrated mode is correctly disabled on Android when the project has under 2 agents, matching desktop's rule.

---

## Phase 2 — Manual Workflow Bidirectional Persistence

**Addresses:** Issue #2

**Goal:** A manual workflow created on Android is the same durable entity as one created on desktop — visible, editable, and trackable from either app.

**Key changes:**
- Add WS command handlers in `ws-handlers.ts` mirroring desktop's existing `manual-workflow-runs.ts` IPC surface: `list`, `get`, `save-spec`, `update-step-status`, `discard`.
- Add Android data models (`ManualWorkflowRun`, `ManualWorkflowRunStep`), `WsRepository` methods, and a saved-workflow viewer screen — ready/waiting/completed step cards, mirroring `WorkflowTab.tsx`'s step list — so the output of Android's existing AI generator chat (`ManualWorkflowScreen.kt`) can be persisted via `save-spec` instead of being ephemeral/copy-only as it is today.
- Broadcast run/step changes to connected mobile clients, and push live updates into desktop's `WorkflowTab.tsx` (reuse the `webContents.send` pattern already used to stream chat tokens).

**Acceptance criteria:**
- A workflow saved on Android appears in desktop's Workflow tab without an app restart.
- Marking a step done on either desktop or Android is reflected on the other within the same session.

---

## Phase 3 — Chat Window Status Indicators

**Addresses:** Issue #3, and the auto-approve-indicator bullet of Issue #6

**Goal:** Opening any project chat makes the active workflow mode and any auto-approve risk immediately visible, on both platforms.

**Key changes:**
- Desktop: add a small badge in the chat header/metadata row showing the project's workflow mode (icon + label, reusing `TeamTab.tsx`'s labels for consistency), plus a separate warning icon (hover tooltip) shown when the active agent has `fullAutoApprove` enabled.
- Android: add the same two indicators to `ChatScreen.kt`'s `NexyTopAppBar` `titleContent`, next to the existing `agentLabel · projectLabel` subtitle, alongside the slot currently used for `ChatCompletedBadge()`.

**Acceptance criteria:**
- Every project chat header shows the current workflow mode at a glance, on both apps.
- Chatting with an auto-approve-all agent shows a visible warning indicator, on both apps.

---

## Phase 4 — Guided Manual Workflow UX (Contextual Banner)

**Addresses:** Issue #4

**Goal:** When a project is in manual mode with an active workflow, the chat window actively guides the user toward the next step — without blocking normal free-form chat.

**Design decision:** a non-blocking contextual banner, not a stricter step-locking wizard. The composer stays fully usable at all times; the banner is a shortcut, not a gate.

**Key changes:**
- When a project's workflow mode is `manual-delegation` and it has an active `manual_workflow_run` with at least one step not yet done, show a dismissible banner in the chat window: run title, "Step N of M: `<step title>`", a "Start this step" call-to-action, and a "View workflow" link.
- Desktop: extend the existing `handleStartWorkflowStep` (`src/renderer/components/ProjectSettingsPanel.tsx:348-360`), which already opens a new conversation pre-filled with the step's prompt.
- Android: build the equivalent using Phase 2's newly-persisted step data.
- The banner advances automatically as steps are marked done, using the existing "Mark done" action on desktop and its new Android counterpart from Phase 2.

**Dependencies:** Phase 1 (Android must know it's in manual mode) and Phase 2 (Android must have persisted step data to show).

**Acceptance criteria:**
- Creating a manual workflow, setting the project to manual mode, and opening the project chat shows a banner reflecting the current step.
- Tapping "Start this step" opens the right agent's chat pre-filled with the step prompt, on both platforms.
- The banner advances to the next step as prior steps are completed, and can be dismissed without blocking chat.

---

## Phase 5 — Android Project Settings UI Polish

**Addresses:** Issue #5

**Goal:** Bring `ProjectConfigScreen.kt` up to the same polish level as the rest of the app.

**Key changes:**
- Promote `NewChatItem` and the `NexySearchField`-driven sectioned list (currently local to `HomeScreen.kt` / `HomeScreenComponents.kt`, used for the "+ New chat" sheet) into a reusable `ui/components/` composable, and use it to replace `AddAgentToProjectSheetContent`'s current flat, search-less list.
- Move the "Project Tools" `SettingsNavRow` block (Project changes / wiki / artifacts / manual workflow generator) up near the top of the screen, right after Core Settings — currently it sits at the very bottom, below Save.
- Make "Save settings" a sticky `Scaffold.bottomBar` (mirroring `ChatInputBar`'s existing sticky-bottom pattern) instead of sitting mid-scroll; the rest of the sections then scroll independently above it.
- Add a "Delete project" action directly inside `ProjectConfigScreen.kt` (e.g. as part of a Danger Zone, or an app-bar overflow item), reusing the existing `WsRepository.deleteProject()` call and `NexyConfirmDialog` guard that today are only reachable via long-press on the project list.

**Acceptance criteria:**
- Add-agent flow matches the visual quality and searchability of the "+ New chat" sheet.
- Project Tools are visible without scrolling past Save.
- Save settings is always reachable without scrolling.
- A project can be deleted from within its own settings screen.

---

## Phase 6 — Android Agent Settings UI Polish

**Addresses:** Issue #6 (minus the chat-window indicator, covered by Phase 3)

**Goal:** Bring `AgentConfigScreen.kt` up to the same polish level, and give dangerous settings the same weight they have on desktop.

**Key changes:**
- Sticky bottom "Save changes" bar in `AgentConfigScreen.kt`, same `Scaffold.bottomBar` treatment as Phase 5 — currently it's the last element in the scroll content.
- Build a new reusable info-icon-with-tap-to-reveal-popover component (e.g. `NexyInfoIcon` in `NexyUx.kt`; fall back to reusing `NexyInfoDialog`'s content presentation if a true anchored popover proves awkward in Compose). Replace the always-visible description text scattered throughout `AgentConfigScreen.kt` and `ProjectConfigScreen.kt` (via `supportingText` and standalone `Text` blocks) with this icon next to each field label.
- Restructure the existing ad-hoc red "Auto-approve all actions" card into a labeled "Danger Zone" section at the very bottom of the screen, mirroring desktop's pattern (`src/renderer/components/agent-panel/SettingsTab.tsx:428-497`: red hairline divider, `AlertTriangle` icon, uppercase red label, bordered card), keeping the existing confirm-dialog guard on enabling.

**Acceptance criteria:**
- Save changes is always reachable without scrolling.
- Field descriptions are hidden behind (i) icons and no longer dominate the screen; tapping one shows the description until the user taps elsewhere.
- Auto-approve lives in a clearly labeled Danger Zone at the bottom of the screen, matching desktop's visual language.

---

## Phase 7 — Per-Chat Thinking Effort and Tool Approval Overrides

**Addresses:** Issue #7

**Goal:** Let the user override thinking effort and tool approval mode for a single conversation, without changing the agent's saved defaults.

**Key changes:**
- Add nullable per-conversation override columns via an append-only migration in `database-migrations.ts` (e.g. `thinking_effort_override`, `approval_mode_override` on `conversations`), falling back to `AgentConfig.thinkingEffort` / `fullAutoApprove` when unset. Extend `SendMessageOptions` and related shared types accordingly.
- Desktop: new composer control beside `ModelPicker` in `ChatComposer.tsx`, using the existing `DropdownPanel` pattern (already reused for the model picker and in `WorkflowTab.tsx`).
- Android: new bottom sheet parallel to the existing `ModelPickerSheet`, triggered from a new icon in `ChatScreen.kt`'s actions row.
- New IPC channel via `safeHandle` on desktop, plus a matching WS command in `ws-handlers.ts`, to read/update the per-conversation override from either client.

**Acceptance criteria:**
- A user can change thinking effort and/or tool approval mode for the current chat only, on both platforms.
- The override persists across app restarts for that conversation, and doesn't affect the agent's default configuration or other conversations.

---

## Open items for a future round

- Manual mode currently has no automatic sequencing/hand-off engine — Phase 4's banner is a guided shortcut, not automation. If future feedback asks for hands-off execution of a manual workflow, that's a materially larger scope (an execution engine consuming `manual_workflow_runs`) and should be scoped separately.
- The per-tool approval granularity that exists on Android (`auto` / `always-ask` / `disabled` per File Edit / Terminal / Web Fetch) is currently more granular than desktop's single `fullAutoApprove` boolean. Phase 7's per-chat override should decide whether to expose that same granularity or collapse to a simpler on/off — worth a explicit design pass when Phase 7 is scoped in detail.
