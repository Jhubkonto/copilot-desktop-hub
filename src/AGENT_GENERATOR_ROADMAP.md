# Agent Generator — Feature Roadmap

## What it is

A conversational wizard that helps users create a fully configured Nexy agent — name, icon, system prompt, tools, context rules, custom commands — through a 2–3 turn AI chat. Output is an `AgentGeneratorSpec` JSON applied atomically via the existing `agent:create` IPC handler.

Analogous to the Project Generator (see `PROJECT_GENERATOR_ROADMAP.md`) but for agents. Replaces the multi-tab `AgentPanel` setup with a guided chat, while keeping a "Set up manually" escape hatch for users who prefer a form.

Works with any LLM provider configured in Nexy (BYOK or CLI) because the spec is extracted client-side from the streamed text.

---

## Current State

| Capability | Status | Notes |
|---|---|---|
| Agent creation (manual) | ✅ Exists | `AgentPanel.tsx` — Settings / Skills / Knowledge / JSON tabs |
| Agent stored in DB | ✅ Exists | `agent:create` in `src/main/agents.ts` |
| Conversational project setup | ✅ Exists | `ProjectGeneratorModal.tsx` + `project-generator.ts` — pattern to replicate |
| Conversational agent setup | ❌ Missing | This feature |
| Android agent generator | ❌ Missing | Parity with desktop |

---

## Architecture

Mirrors the project generator 1:1:

```
AgentGeneratorModal (renderer, React)
  │  window.api.agentGeneratorChat(...)
Preload (src/preload/index.ts)
  │  IPC
src/main/agent-generator.ts
  ├── System prompt (~80 lines — agent design patterns, tool choices, tone calibration)
  ├── extractSpec()        — parses <agent-spec>…</agent-spec>
  ├── normalizeSpec()      — field-by-field coercion with defaults
  ├── createAgentFromSpec() — reuses agent:create DB logic from agents.ts
  └── CLI + BYOK dual-path (identical colon-prefix pattern to project-generator.ts)
```

---

## New Shared Types  (`src/shared/types.ts`)

```typescript
export interface AgentGeneratorSpec {
  name: string
  icon: string
  systemPrompt: string
  temperature: number
  responseFormat: 'default' | 'concise' | 'detailed' | 'code-only'
  agenticMode: boolean
  tools: { fileEdit: boolean; terminal: boolean; webFetch: boolean }
  rootDirectory?: string
  contextDirectories: string[]
  memory?: string
  customCommands?: { name: string; description: string; prompt: string }[]
}

export interface AgentGeneratorMessage {
  role: 'user' | 'assistant'
  content: string
}
```

Add corresponding entries to the `IpcChannels` union and `IpcReturnMap` in `src/shared/types.ts`.

---

## IPC Channels

| Channel | Direction | Purpose |
|---|---|---|
| `agent-generator:chat` | invoke | Send messages, start generation turn |
| `agent-generator:token` | main→renderer | Stream token chunks |
| `agent-generator:spec-ready` | main→renderer | Emit validated spec |
| `agent-generator:done` | main→renderer | Signal turn complete `{ hasSpec: boolean }` |
| `agent-generator:get-model` | invoke | Active generation model |
| `agent-generator:set-model` | invoke | Update model (renderer-only session state, never written to DB) |

---

## Files to Create / Modify

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `AgentGeneratorSpec`, `AgentGeneratorMessage`; new channel entries |
| `src/main/agent-generator.ts` *(new)* | System prompt, `buildProviderMessages`, `extractSpec`, `normalizeSpec`, `runAgentGeneratorChat`, `runAgentGeneratorChatForAndroid`, `createAgentFromSpec`, IPC handler registration |
| `src/main/ipc-handlers.ts` | Call `registerAgentGeneratorHandlers(win)` |
| `src/preload/index.ts` | Add `agentGeneratorChat`, `onAgentGeneratorToken`, `onAgentGeneratorSpecReady`, `onAgentGeneratorDone`, `agentGeneratorGetModel`, `agentGeneratorSetModel` |
| `src/renderer/components/AgentGeneratorModal.tsx` *(new)* | Chat panel + live draft preview + manual edit form + creation overlay |
| Sidebar / agents pane | Add `+ Generate` entry point button |
| `src/main/ws-handlers.ts` | Handle `agent-generator:start/message/confirm/cancel` WS commands |
| `android/.../WsEvent.kt` | Add 6 `AgentGenerator*` event data classes |
| `android/.../WsEventParser.kt` | Parse new events; add `parseAgentGeneratorSpec()` |
| `android/.../AgentGeneratorViewModel.kt` *(new)* | 3-phase state machine + WS dispatch |
| `android/.../AgentGeneratorScreen.kt` *(new)* | Compose UI — chat → review → done |
| Android nav graph | Wire `AgentGeneratorScreen` into navigation |

---

## Desktop UI Design

### Layout  (same 38/62 split as project generator)
- **Left panel** — live `DraftPreview`: agent name + icon, system prompt excerpt, tool badges (file-edit, terminal, web-fetch), agentic mode badge, root directory
- **Right panel** — chat messages + input bar with model picker + send button

### Phases
1. **Chat phase** — conversational turns; draft updates when spec arrives; amber missed-spec hint on failed turn
2. **Edit phase** — manual form for fine-tuning or fully manual setup: name, icon, system prompt, tool toggles, temperature, root directory, custom commands. Accessible via an **"Edit manually"** button in the chat toolbar (mirrors the project generator's "Manual setup" tab). When no spec has been generated yet, opens with a blank form so the user can skip the AI entirely.
3. **Creation phase** — progress overlay:
   - Creating agent…
   - Configuring tools…
   - Setting up context…
   - Done ✓

### Entry point
`+ Generate` secondary button alongside the existing `+ New Agent` button in the agents pane / sidebar.

### Session persistence
Module-level `_agentGenSession` var — survives modal close/reopen, cleared on agent creation or "Start over".

---

## Main Process — `agent-generator.ts`

### System prompt focus (~80 lines)
- Conversation style: 2–3 questions per turn — purpose, domain, output format, codebase access, restrictions
- Tool guidance: `fileEdit` only for code-editing agents, `terminal` only if running commands, `webFetch` for research
- Agentic mode: enable for long autonomous tasks; disable for single-turn Q&A
- Temperature: 0.3 for coding, 0.7 for general, 1.0 for creative/brainstorming
- System prompt writing: clear persona, explicit constraints, example output format when helpful
- Emit spec only when enough info gathered (usually turn 2–3)

### Spec tag
```
<agent-spec>{ ... }</agent-spec>
```

### `createAgentFromSpec()`
Calls the same DB logic as the existing `agent:create` IPC handler in `src/main/agents.ts` (scratchpad creation, `INSERT INTO agents`). Returns `{ agentId, name }`. Does not duplicate the handler — imports and calls the shared logic directly.

### Model state
Module-level `_agentGeneratorModel`. `getAgentGeneratorModel()` falls back to `getProjectGeneratorModel()` → `DEFAULT_PROVIDER_MODEL`. Never persisted to DB.

### CLI + BYOK dual-path
Identical colon-prefix pattern to `project-generator.ts` — `claude-cli:model` / `codex-cli:model` routes to `getAdapter(prefix).send()`; all others to `dispatchToProvider()`.

### Greeting (stripped before forwarding to provider)
Same pattern as project generator — first message seeded as assistant greeting in renderer state; `buildProviderMessages()` strips leading assistant message before forwarding to the LLM.

---

## Android Parity

### Phases
```
CHAT → SPEC_REVIEW → DONE
```

### ViewModel state
```kotlin
data class AgentGeneratorUiState(
    val phase: AgentGenPhase = AgentGenPhase.CHAT,
    val messages: List<AgentGenMessage> = listOf(AgentGenMessage("assistant", GREETING)),
    val streamingText: String = "",
    val pendingSpec: AgentGeneratorSpec? = null,
    val isLoading: Boolean = false,
    val missedSpec: Boolean = false,
    val error: String? = null,
    val createdAgentName: String? = null,
    val createdAgentId: String? = null,
    val activeSessionId: String = UUID.randomUUID().toString(),
)
```

### WebSocket commands (Android → Desktop)
```
agent-generator:start    { sessionId, messages }
agent-generator:message  { sessionId, messages }
agent-generator:confirm  { sessionId, spec }
agent-generator:cancel   { sessionId }
```

### WebSocket events (Desktop → Android)
```
agent-generator:token          { sessionId, chunk }
agent-generator:turn-complete  { sessionId, content, hasSpec }
agent-generator:spec-ready     { sessionId, spec }
agent-generator:created        { sessionId, agentId, name }
agent-generator:error          { sessionId, message }
agent-generator:cancelled      { sessionId }
```

### Android data classes (`WsEvent.kt`)
```kotlin
data class AgentGeneratorSpec(
    val name: String,
    val icon: String,
    val systemPrompt: String,
    val temperature: Double,
    val responseFormat: String,
    val agenticMode: Boolean,
    val tools: AgentGeneratorTools,
    val rootDirectory: String?,
    val contextDirectories: List<String>,
    val memory: String?,
)
data class AgentGeneratorTools(val fileEdit: Boolean, val terminal: Boolean, val webFetch: Boolean)
```

### Screen layout
- Top bar: "Agent Generator" + Reset button (visible after first user turn only)
- Phase stepper pills: Describe → Review → Done
- Chat phase: `LazyColumn` bubbles + input bar + amber missed-spec hint when `missedSpec = true` + **"Set up manually"** button that navigates to SPEC_REVIEW with a blank spec
- Spec review phase: scrollable editable form — name, icon field, system prompt, tool toggles, temperature, root directory, agentic mode toggle + "Create agent" / "Start over" buttons
- Done phase: "Agent Created!" + name + "Generate another" button

---

## Reused Utilities (Do Not Re-implement)

| What | Where |
|---|---|
| `safeHandle()` | `src/main/safe-handle.ts` |
| `dispatchToProvider()` | `src/main/chat-provider-dispatch.ts` |
| `getAdapter(prefix).send()` | `src/main/cli-adapters/registry.ts` |
| `getProviderForAgent()`, `getApiKey()` | `src/main/providers.ts` / `provider-registry.ts` |
| `broadcastToMobile()` | `src/main/ws-server.ts` |
| `ModelPicker` component | `src/renderer/components/chat/` |
| `agent:create` DB + scratchpad logic | `src/main/agents.ts` |
| `NexyTopAppBar`, `NexyConfirmDialog` | Android shared UI components |
| `parseProjectGeneratorSpec()` pattern | `android/.../WsEventParser.kt` |
| `ChatBubble`, streaming dots, amber hint | `ProjectGeneratorModal.tsx` patterns |

---

## Roadmap — Prioritised

### P0 — Core desktop feature

| # | Task | File(s) | Status |
|---|---|---|---|
| 1 | Add `AgentGeneratorSpec`, `AgentGeneratorMessage` + IPC channel entries | `src/shared/types.ts` | ❌ |
| 2 | Create `agent-generator.ts` — system prompt, spec extraction, `runAgentGeneratorChat`, `createAgentFromSpec`, IPC handlers | `src/main/agent-generator.ts` *(new)* | ❌ |
| 3 | Register handlers; wire preload channels | `src/main/ipc-handlers.ts`, `src/preload/index.ts` | ❌ |
| 4 | Build `AgentGeneratorModal.tsx` — chat + draft preview + manual edit form + creation overlay | `src/renderer/components/AgentGeneratorModal.tsx` *(new)* | ❌ |
| 5 | Add `+ Generate` entry point button in agents pane | Sidebar / agents pane | ❌ |

### P1 — Android parity

| # | Task | File(s) | Status |
|---|---|---|---|
| 6 | Add WsEvent types + parser for agent generator events | `android/.../WsEvent.kt`, `WsEventParser.kt` | ❌ |
| 7 | Handle `agent-generator:*` WS commands; add `runAgentGeneratorChatForAndroid` | `src/main/ws-handlers.ts`, `agent-generator.ts` | ❌ |
| 8 | Create `AgentGeneratorViewModel.kt` | Android new file | ❌ |
| 9 | Create `AgentGeneratorScreen.kt` + wire into nav graph | Android new files | ❌ |

### P2 — Polish

| # | Task | Notes | Status |
|---|---|---|---|
| 10 | "Add to project" option on creation | Offer to add the new agent to the currently open project | ❌ |
| 11 | Multi-modal input (paste screenshot) | Ctrl+V paste of UI screenshots to inform agent design | ❌ |
| 12 | Prompt library button in input bar | Same `BookOpen` button pattern as project generator | ❌ |

---

## Verification

1. Open agent generator modal → greeting bubble appears, model badge shown in header
2. Type "I need a coding assistant that can edit files and run tests" → tokens stream → assistant bubble appears
3. After 2–3 turns, spec is emitted → left draft panel shows name, icon, tool badges
4. Click "Create agent" → progress overlay → agent appears in agent list
5. Click "Edit manually" before any spec → blank form opens → fill in manually → Create agent → works
6. Repeat steps 2–4 with Claude CLI, Codex CLI, and BYOK (OpenRouter) models — all produce responses
7. Android: open Agent Generator screen → greeting shown → send message → spec arrives → spec review form → confirm → "Agent Created!" phase
8. Android "Set up manually" button → navigates to spec review with blank form → fill in → confirm → agent created
9. Android reset mid-flow → confirmation dialog → returns to greeting
