# Nexy Android — Desktop Parity Roadmap

Last updated: 2026-06-17

This document tracks the work needed to bring the Android companion app to close feature parity with the Electron desktop app. Work items are grouped into phased milestones by priority and logical dependency. Each item notes which side(s) need work and carries a rough effort estimate (S = a few hours, M = half to full day, L = multiple days).

---

## What Android Already Has (no work needed)

- Chat (send/receive/stream/stop), conversation list, create conversation
- Agent list, project list, scoped chat history by agent or project
- Tool approvals (notification + in-app dialog)
- Self-heal (investigation / fix / verification / git ops) — fully wired
- App updates (OTA via local feed server)
- Bug report capture request
- Theme selection (light / dark / system)
- Multi-profile (multiple paired servers)
- Model selection per conversation

---

## Phase 1 — Conversation Management (Quick Wins)

**Theme:** Fix the most obvious day-to-day gaps. All required WS handlers already exist on desktop (`conversation:rename`, `conversation:delete`, `conversation:search` are live in `conversation-handlers.ts`). This is almost entirely Android UI work.

| Feature | Description | Sides | Effort |
|---------|-------------|-------|--------|
| Rename conversation | Long-press or swipe action on conversation list item; sends `conversation:rename` | Android UI | S |
| Delete conversation | Swipe-to-delete or context menu; sends `conversation:delete`; add `WsEvent.ConversationDeleted` broadcast | Android UI + Desktop WS (event) | S |
| Search conversations | Search bar on HomeScreen Chats tab; sends `conversation:search`; add `WsEvent.ConversationSearchResults` reply | Android UI + Desktop WS (event) | M |
| Delete individual message | Long-press on message bubble → delete; need WS bridge for `message:delete` IPC | Android UI + Desktop WS handler | M |
| Self-Heal report list | Dedicated screen listing error reports by status; sends `self-heal:get-reports`; add `WsEvent.SelfHealReports` | Android UI + WsEvent.kt variant | M |
| Self-Heal report detail | View investigation markdown, fix status for a selected report; reuses existing self-heal WS commands | Android UI | M |

**New protocol additions:**
- `WsEvent.ConversationDeleted(id)` — desktop broadcasts when a conversation is deleted
- `WsEvent.ConversationSearchResults(conversations)` — reply to `conversation:search`
- `WsEvent.SelfHealReports(reports)` — reply to `self-heal:get-reports`

---

## Phase 2 — Projects & Agents CRUD

**Theme:** Android can read projects and agents but cannot create or configure them. Desktop IPC handlers for create/rename/delete all exist — new WS command handlers bridge them.

### 2a — Projects

| Feature | Description | Sides | Effort |
|---------|-------------|-------|--------|
| Create project | FAB or bottom sheet on Projects tab; sends `project:create`; add WS handler wrapping existing IPC | Android UI + Desktop WS handler | M |
| Rename project | Edit action from project detail; sends `project:rename` | Android UI + Desktop WS handler | S |
| Delete project | Delete action with confirmation dialog; sends `project:delete` | Android UI + Desktop WS handler | S |
| Edit ProjectConfig | Basic settings sheet (instructions, rootDir, scope rules, variables, milestones, orchestration toggles); sends `project:update-config` | Android UI + Desktop WS handler | L |
| Manage project agents | Agent picker within project settings; add/remove/set-primary; sends `project:set-agents` | Android UI + Desktop WS handler | M |
| Project generator wizard | Conversational project creation; `project-generator:start/message/confirm/cancel` WS commands already exist on desktop | Android UI | L |

**New WS handlers needed:** `project:create`, `project:rename`, `project:delete`, `project:update-config`, `project:set-agents`

### 2b — Agents

| Feature | Description | Sides | Effort |
|---------|-------------|-------|--------|
| Create agent | New agent sheet (name, icon, system prompt); sends `agent:create` | Android UI + Desktop WS handler | M |
| Edit agent (basic fields) | Name, icon, system prompt, temperature, maxTokens; sends `agent:update` | Android UI + Desktop WS handler | M |
| Edit agent tools & MCP | Toggle fileEdit / terminal / webFetch and select MCP servers; part of `agent:update` payload | Android UI | M |
| Delete agent | Confirmation dialog; sends `agent:delete` | Android UI + Desktop WS handler | S |
| Agent memory field | View/edit `memory` string; part of `agent:update` | Android UI | S |

**New WS handlers needed:** `agent:create`, `agent:update`, `agent:delete`

**Note:** Agent CLI model editing requires Phase 3 CLI status first; can ship without that field initially.

---

## Phase 3 — Settings & Providers

**Theme:** BYOK API key management and global settings. The WS bridge must never transmit raw key values — use masked display and a write-only set flow.

| Feature | Description | Sides | Effort |
|---------|-------------|-------|--------|
| Provider list (configured status) | List providers (OpenAI, Anthropic, Azure, Gemini, Mistral, Groq, xAI, OpenRouter) with configured badge; sends `provider:get-configured` | Android UI + Desktop WS handler | M |
| Set API key (write-only) | Input sheet per provider; sends `provider:set-key`; key is encrypted by desktop, never echoed back | Android UI + Desktop WS handler | M |
| Remove API key | Remove action per provider; sends `provider:remove-key` | Android UI + Desktop WS handler | S |
| Global default model | Picker; sends `app:set-setting` with key `default_model`; desktop handler exists | Android UI | S |
| Global temperature / max tokens | Numeric inputs; sends `app:set-setting` for `default_temperature` / `default_max_tokens` | Android UI | S |
| Auto-start toggle | Toggle; sends `app:set-setting` for `auto_start` | Android UI | S |
| Auto-clipboard toggle | Toggle; sends `app:set-setting` for `auto_clipboard` | Android UI | S |
| MCP server list (read-only) | List configured MCP servers with status; sends `mcp:list` | Android UI + Desktop WS handler | M |
| CLI status | Installed/version indicators for Claude CLI and Codex CLI; sends `app:cli-status`; returns `CliInstallStatus` | Android UI + Desktop WS handler | S |

**New WS handlers needed:** `provider:get-configured`, `provider:set-key`, `provider:remove-key`, `mcp:list`, `app:cli-status`

**Security:** `provider:set-key` must call `storeApiKey` from `src/main/provider-secrets.ts` and must never include raw key material in any WS reply event.

---

## Phase 4 — Artifacts

Desktop `artifacts.ts` has full CRUD. Start with read-only listing, then add create/export.

| Feature | Description | Sides | Effort |
|---------|-------------|-------|--------|
| Artifact list | List artifacts scoped to a project; `artifact:list` WS command | Android UI + Desktop WS handler | M |
| Artifact detail | View metadata, version history, file list; `artifact:get` | Android UI + Desktop WS handler | M |
| Artifact export | Trigger export (JSON/zip); receive file data or local URL; `artifact:export` | Android UI + Desktop WS handler | L |

**New WS handlers needed:** `artifact:list`, `artifact:get`, `artifact:export`

---

## Phase 5 — Wiki, Prompts & Advanced

**Theme:** Lower-priority completions. All require new WS handlers on desktop.

### 5a — Project Wiki

| Feature | Description | Sides | Effort |
|---------|-------------|-------|--------|
| Wiki entry list | List wiki entries for a project; `wiki:list` | Android UI + Desktop WS handler | M |
| Wiki entry detail | Read-only body + tags view | Android UI | S |
| Create / edit entry | Form sheet; `wiki:create` / `wiki:update` | Android UI + Desktop WS handlers | M |
| Delete entry | `wiki:delete` | Android UI + Desktop WS handler | S |

### 5b — Prompt Library

| Feature | Description | Sides | Effort |
|---------|-------------|-------|--------|
| Browse prompts | List global and project-scoped prompts; `prompt:list` | Android UI + Desktop WS handler | M |
| Insert prompt into chat | Tap to pre-fill chat composer; purely Android UI after list is fetched | Android UI | S |
| Create / edit prompt | Form sheet; `prompt:create` / `prompt:update` | Android UI + Desktop WS handlers | M |

### 5c — Advanced Conversation Operations

| Feature | Description | Sides | Effort |
|---------|-------------|-------|--------|
| Export conversation | JSON or markdown via Android share sheet; `conversation:export-json` WS bridge | Android UI + Desktop WS handler | M |
| Fork conversation | Fork at a selected message; `conversation:fork` WS bridge | Android UI + Desktop WS handler | M |
| Import conversation | File picker → send raw JSON payload; WS variant must accept JSON directly (not open a desktop dialog) | Android UI + Desktop WS handler | L |

---

## Protocol Work Pattern

Every new WS command follows the existing pattern in `src/main/ws-handlers.ts`:
1. Register in the `setWsCommandHandler` block
2. Call existing IPC handler logic or DB directly
3. `reply(...)` or `broadcastToMobile(...)` with a typed event

For each new reply event:
1. New `sealed class` entry in `android/app/src/main/java/io/nexy/android/data/model/WsEvent.kt`
2. New `when` branch in `android/app/src/main/java/io/nexy/android/data/WsEventParser.kt`
3. New `StateFlow` field in `android/app/src/main/java/io/nexy/android/data/WsRepository.kt` if data needs to persist across screen navigations

---

## Key Files

| File | Role |
|------|------|
| `src/main/ws-handlers.ts` | All new desktop WS command handlers land here |
| `android/.../data/model/WsEvent.kt` | New sealed class variant per new reply event |
| `android/.../data/WsEventParser.kt` | Updated in lockstep with WsEvent.kt |
| `android/.../data/WsRepository.kt` | New StateFlow fields for persistent list/detail data |
| `src/main/provider-secrets.ts` | `storeApiKey` / `removeApiKey` — used by Phase 3 handlers; must not leak key material |

---

## Effort at a Glance

| Phase | Est. calendar |
|-------|---------------|
| 1 — Conversation Management | 2–3 days |
| 2 — Projects & Agents CRUD | 5–7 days |
| 3 — Settings & Providers | 3–4 days |
| 4 — Artifacts | 2–3 days |
| 5 — Wiki, Prompts, Advanced | 4–5 days |

**~21–32 days total.** Phases 1–3 can proceed largely in parallel since they touch independent screens. Phase 4 depends on Phase 2a (projects). Phase 5 is independent of Phase 4 and can be interleaved.
