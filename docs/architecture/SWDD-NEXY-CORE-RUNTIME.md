---
document:
  title: "Nexy Core Runtime Software Detailed Design"
  code: "SWDD-NEXY-CORE-RUNTIME"
  controlled_document: true
template:
  source: "TEMP_SWDD_Software_Detailed_Design_v01"
project:
  number: "NEXY"
  name: "Nexy AI workspace"
release:
  date: "2026-08-19"
  baseline: "1.3.37"
  document_owner: "Nexy maintainers"
versions:
  - version: "1.0"
    change: "Initial detailed design record"
---

# 1. Purpose and scope

This detailed design describes the desktop chat/runtime path: request entry, context construction, backend routing, tool calls, streaming, cancellation, persistence, and renderer reconstruction. It covers the code behind the most important user action: sending a message and receiving useful work back.

It does not define provider wire formats in full, every UI component, or every database migration. Those remain implementation details in `src/main/providers/`, `src/renderer/`, and `src/main/database-migrations.ts`.

| Field | Entry |
| --- | --- |
| Software item | Core chat and agent runtime |
| Parent SWAD item | `NEXY-CHAT`, `NEXY-BACKENDS`, `NEXY-TOOLS`, `NEXY-DATA` |
| Main files | `chat-handlers.ts`, `chat-context-builder.ts`, `chat-provider-dispatch.ts`, `backend-routing.ts`, `chat-turn-emitter.ts`, `tool-loop.ts` |
| Main clients | Desktop renderer and paired Android WebSocket client |
| Verification | Chat, provider, tool-loop, emitter, reducer, and handler tests |

# 2. Component summary

The runtime is a coordinator. It does not try to be a model, a database UI, or a general shell. It gathers the right inputs, sends them through the selected execution backend, translates results into a stable Nexy event language, and commits the durable outcome.

```text
Chat handler
  ├── conversation loader
  ├── context builder
  ├── backend router
  │    ├── provider adapter
  │    ├── CLI adapter
  │    └── orchestrator
  ├── tool loop / approvals
  ├── turn emitter
  └── persistence + broadcast
```

Non-responsibilities:

- React does not decide which provider is authoritative.
- A provider adapter does not write the SQLite conversation directly.
- A tool does not decide whether the user approved it.
- Android does not execute desktop-only tools merely because it has a button for them.
- A historical message loader does not own live streaming state.

# 3. Provided and required interfaces

| Provided interface | Purpose | Inputs | Outputs |
| --- | --- | --- | --- |
| `chat:send-message` | Start a turn | conversation, text, model/backend, attachments, context, agent/project | immediate dispatch acknowledgment; live events |
| `chat:stop-generation` | Stop one active turn | conversation/turn identity | cancellation result and terminal state |
| `chat:turn-event` | Normalized live stream | `ChatTurnEvent` | renderer/Android reducer input |
| `chat:stream-response` and compatibility events | Legacy stream surface | provider/CLI-derived events | existing client compatibility |
| `chat:get-active-turn` | Restore active state | conversation | snapshot or null |
| `chat:respond-user-input` | Continue after an approval/question | request ID, user response | resumed tool/agent execution |

| Required dependency | Purpose | Constraint |
| --- | --- | --- |
| SQLite services | Load history and persist user/assistant/tool records | Writes must preserve conversation identity and ordering |
| Context builder | Resolve agent, project, attachments, summaries, wiki, skills, and knowledge | Respect explicit scope and token budget |
| Provider/CLI adapter | Execute model turn | Must report normalized chunks/errors and honor cancellation |
| Tool registry | Find allowed built-in/MCP/CLI tools | Must apply enabled/disabled/approval policy |
| Emitter | Broadcast ordered events | Monotonic sequence per `turnId` |
| WebSocket broadcaster | Deliver events to paired Android | Must not leak desktop-only paths or secrets |
| Credential vault | Supply provider/CLI auth | Credential values stay in privileged runtime |

# 4. Internal data structures

## 4.1 Context package

The context builder produces an ordered request made from:

1. system and product rules;
2. selected agent instructions;
3. project instructions and scope rules;
4. selected skills and knowledge files;
5. explicit `@` references and attachments;
6. wiki or memory results requested for this turn;
7. rolling conversation summary when older history was compressed;
8. recent conversation messages;
9. current user message.

The exact provider representation varies, but the semantic order and source identity must remain inspectable. The context inspector exists so a user can see what Nexy actually sent instead of guessing.

## 4.2 Turn events

The normalized event family in `src/shared/chat-turn-types.ts` includes:

| Event | Meaning |
| --- | --- |
| `turn_started` | A new live turn exists |
| `user_message_committed` | User text is durable |
| `activity_changed` | Current phase changed |
| `thinking_delta` / `thinking_done` | Thinking/reasoning display data |
| `tool_started` / `tool_finished` | Tool lifecycle |
| `cost_updated` | Usage/cost estimate changed |
| `model_changed` | Actual model became known |
| `assistant_text_delta` | More answer text arrived |
| `turn_completed` | Normal terminal state |
| `turn_failed` | Error terminal state |
| `history_snapshot_received` | Durable history was reloaded |

Every event includes enough identity to discard stale messages from a previous turn. The renderer’s `chatTurnReducer` creates a deterministic live state; the render-item adapter merges that live state with historical messages.

# 5. Main behavior

## 5.1 Start a turn

```text
validate request
  → reject if emergency stop blocks new work
  → persist user message
  → create active-turn record/snapshot
  → emit turn_started and user_message_committed
  → load agent/project/conversation context
  → select execution target
  → dispatch backend
```

The user message is committed before execution so a crash, cancellation, or provider failure does not erase the user’s request.

## 5.2 Backend selection

`backend-routing.ts` and provider/CLI registries use the selected conversation/agent settings, model identity, readiness checks, and capability rules. The result is one of:

- native provider API;
- OpenAI-compatible provider API;
- Claude/Codex/Hermes CLI adapter;
- multi-agent orchestrator.

Routing must distinguish model naming from provider naming. For example, vendor-prefixed OpenRouter IDs route to OpenRouter while native bare Claude IDs route to Anthropic.

## 5.3 Agentic tool loop

```text
model request
  → text response? emit text
  → tool request? check tool policy
      → disabled: return refusal/error to model
      → approval needed: emit request and pause
      → approved/auto: invoke tool
  → emit tool result/activity
  → add result to next model request
  → repeat until final text, failure, stop, or iteration cap
```

Normal provider agentic execution is bounded at 20 tool-call iterations. Orchestration adds a separate delegation depth bound of five. Both bounds are defensive controls against loops and runaway cost.

## 5.4 Streaming and persistence

Provider and CLI adapters emit partial data. The emitter forwards it to desktop IPC and Android WebSocket. The assistant text and structured tool/thinking metadata are accumulated in memory and periodically checkpointed or committed at completion according to the active path.

On normal completion, the runtime writes the assistant message with model/provider, finish reason, usage, citations where available, thinking blocks, and tool references. On failure or cancellation it writes the recoverable state and emits `turn_failed` or the appropriate terminal event.

## 5.5 Stop and emergency stop

Per-conversation stop cancels the active backend/process and causes the runtime to stop accepting further chunks for that turn. The emergency stop is a broader application guard: it prevents or interrupts active work according to the emergency-stop service and broadcasts its state to both clients.

# 6. State model

```text
idle
  → starting
  → streaming
       ├── thinking
       ├── tool_waiting_for_approval
       ├── tool_running
       └── answering
  → completed
  → failed
  → cancelled/recoverable
```

State is split into three concerns:

1. **Durable history:** SQLite messages and related records.
2. **Active execution:** current turn snapshot, abort controller/process, activity, and partial accumulators.
3. **Presentation state:** renderer/Android reducer, typewriter drain, scroll position, panels, and toasts.

Keeping these separate lets the UI re-enter a conversation while a turn is active and lets the app recover after a dropped WebSocket event or renderer reload.

# 7. Error handling and defensive measures

| Failure | Expected behavior |
| --- | --- |
| Missing provider key or CLI | Reject before or at dispatch with actionable readiness error |
| Provider rate limit/auth error | Mark the turn failed/interrupted and show provider error in the conversation |
| Stream ends unexpectedly | Preserve partial answer/checkpoint and expose recoverable terminal state |
| Tool disabled | Return policy result to model; do not invoke the tool |
| Approval dismissed | Pause or terminate the pending action according to request type |
| Tool throws | Record tool failure and let the model decide whether to recover, subject to loop limits |
| Renderer reloads | Reload durable history and active-turn snapshot |
| Android event drops | Reconnect, request active snapshot/history, and continue rendering from authoritative state |
| Stale event arrives | Ignore by `turnId`/sequence ordering |
| Context too large | Compress/trim according to deterministic context-budget rules |
| Emergency stop active | Block new turns and stop eligible active execution |

Error messages should describe the user action and the next useful check. Raw provider details may remain in bounded debug logs, but secrets and synchronization payload bodies are excluded.

# 8. Verification references

| Verification area | Representative tests/files |
| --- | --- |
| Provider normalization and streaming | `src/main/__tests__/providers.test.ts`, provider resilience tests |
| Backend/CLI dispatch | `src/main/__tests__/hermes-acp.test.ts`, CLI detection and adapter tests |
| Tool loop and approvals | `src/main/__tests__/tool-loop.test.ts`, `tools.test.ts`, provider-tools tests |
| Context and token limits | context, token-counting, compression, and model-catalog tests |
| Turn sequencing | `src/renderer/__tests__/chat-turn-reducer.test.ts`, live-turn tests |
| UI rendering | chat messages, tool call, thinking, attachment, and composer tests |
| Cancellation/emergency stop | active-chat and emergency-stop tests |
| Mobile live behavior | Android `ChatTurnReducer`, `ChatTurnCoordinator`, `WsRepository` tests |
