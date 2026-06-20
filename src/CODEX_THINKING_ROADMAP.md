# Codex Thinking Roadmap

## Summary

Create a visible Codex "work log" in desktop and Android chat. This should not claim to expose private chain-of-thought. It should surface provider-exposed reasoning when available, and otherwise show parsed Codex CLI activity such as planning/status lines, tool starts/ends, errors, and completion metadata.

Current findings:

- Desktop already has `ThinkingBlock`, live `chat:thinking-delta/end` IPC events, and persisted `messages.thinking_blocks`.
- BYOK Anthropic/OpenAI-compatible paths can already persist provider-exposed thinking/reasoning.
- Codex CLI currently parses JSONL for final text, deltas, tools, cost, and errors, but does not emit thinking/work-log blocks.
- Android can render stored thinking blocks from history, but does not receive live thinking delta/end WebSocket events yet.

## Key Changes

- Add a Codex work-log parser in the Codex CLI adapter.
  - Parse safe JSONL telemetry from `codex exec --json`.
  - Emit `thinking_chunk`/`thinking_end` only for explicit reasoning/summary fields if Codex provides them.
  - Emit synthetic work-log lines for observable events: starting run, tool start/end, approval-related denial, command result, finalization, and errors.
  - Keep final assistant text parsing separate from work-log parsing.

- Bridge live thinking to Android.
  - Add WebSocket event `chat:thinking-delta` with `{ conversationId, blockId, chunk }`.
  - Add WebSocket event `chat:thinking-end` with `{ conversationId, blockId }`.
  - Broadcast these anywhere desktop currently sends `chat:thinking-delta/end`.
  - Keep existing desktop IPC payloads unchanged unless a small compatible `conversationId` addition is useful.

- Update Android chat state for live thinking.
  - Add `WsEvent.ChatThinkingDelta` and `WsEvent.ChatThinkingEnd`.
  - Track `liveThinkingBlocks` in `ChatViewModel`.
  - Render live thinking above the streaming assistant bubble using the existing `ThinkingHistoryBubble` style or a lightly adjusted live variant.
  - Clear live thinking on stream end/error/stop.
  - Preserve existing history behavior for persisted `thinking_blocks`.

- Improve persistence consistency.
  - Ensure Codex CLI thinking/work-log blocks are included in `cliThinkingBuffer` and saved to `messages.thinking_blocks`.
  - Keep provider thinking persistence unchanged.
  - On error, persist a final work-log block where possible so the user can see what failed.

- Add user-facing language.
  - Use labels like `Work log`, `Reasoning summary`, or `Codex activity`, not `private thinking`.
  - Desktop `ThinkingBlock` can keep its component name internally, but displayed copy should clarify whether content is provider reasoning or parsed activity.

## Roadmap Phases

### Phase 1: Documentation and Guardrails

- [x] Document the privacy boundary: do not fabricate hidden reasoning; only show exposed model reasoning or observable CLI telemetry.
- [x] Define event names and payloads for desktop IPC and Android WebSocket parity.
- [x] Decide final user-facing labels for desktop. Android labels remain for the Android implementation pass.

### Phase 2: Codex Adapter Parsing

- [x] Add a small parser for Codex JSONL activity events.
- [x] Reuse `CliStreamEvent.thinking_chunk/end` for visible work-log blocks.
- [x] Add tests for known Codex JSONL shapes covered by desktop adapter tests.

### Phase 3: Desktop Live and Persisted Display

- [x] Verify Codex-generated work-log blocks appear live in `ThinkingBlock`.
- [x] Verify blocks persist into `messages.thinking_blocks`.
- [x] Adjust copy/styling if needed so activity logs read as status/work-log output.

### Phase 4: Android Live Parity

- [ ] Add WebSocket parsing for live thinking delta/end.
- [ ] Add `ChatViewModel` state and tests.
- [ ] Render live blocks while awaiting/streaming, and stored blocks after history reload.

### Phase 5: QA and Failure States

- [x] Test Codex CLI normal response.
- [x] Test Codex CLI tool use.
- [x] Test rejected or blocked tool use.
- [x] Test stream stop.
- [x] Test CLI error.
- [x] Test BYOK provider thinking still works.
- [ ] Test Android reconnect/history reload shows persisted blocks even if live events were missed.

## Test Plan

- Main tests:
  - Codex adapter unit tests for JSONL parsing and emitted events.
  - `chat-handlers` test that Codex thinking/work-log blocks are persisted.
  - `ws-handlers` or chat dispatch test that live thinking events broadcast to mobile.
  - Android parser test for `chat:thinking-delta/end`.
  - Android `ChatViewModelTest` for live block accumulation, completion, clearing, and history loading.

- Manual scenarios:
  - Desktop Codex chat with no tools.
  - Desktop Codex chat with MCP/tool activity.
  - Android watches the same run live.
  - Android opens the conversation after a run and sees stored work-log blocks.
  - Stop generation mid-run and confirm no stuck thinking UI.

## Assumptions

- The feature should show transparent observable activity, not hidden chain-of-thought.
- Codex CLI JSONL event shapes may vary, so unknown events should be ignored safely.
- Existing `thinking_blocks` storage is sufficient for v1; no database migration is needed.
- Android live parity should use WebSocket events rather than polling conversation history.
