# Codex CLI Chat Timeline Ordering Investigation and Fix

**Status:** Complete — stable timeline ordering shipped; the current cross-platform behavior is documented in [`docs/resumable-chat-animation.md`](../../docs/resumable-chat-animation.md).

## Summary

Create `roadmap/roadmap-new/CODEX_CLI_CHAT_TIMELINE_ORDERING_ROADMAP.md` and a matching Nexy artifact titled **“Codex CLI Chat Timeline Ordering”**. Both copies must contain this roadmap unchanged.

The defect is Android-first: narration is correctly interleaved with commands/tool calls while streaming, but can become grouped incorrectly after completion or history reload. Desktop must be checked for the same persistence issue.

## Investigation and Implementation

- Reproduce a Codex CLI turn shaped as `text → command/tool → text → command/tool → final text`, then capture:
  - Codex adapter callbacks.
  - Normalized chat-turn event sequence.
  - Persisted assistant `text_segments` and tool-call rows.
  - WebSocket `conversation:messages` payload.
  - Android live, completion-handoff, and reopened-history render order.
  - Desktop live and historical render order.
- Confirm the likely normalization gap: ordinary `codex exec` currently emits response chunks without segment IDs or `text_end`, while the Codex plan/app-server path supplies both. This prevents completed responses from retaining the segment boundaries needed for historical interleaving.
- Update the ordinary Codex adapter so every contiguous agent-message burst has a stable text block ID:
  - Reuse the Codex item ID when available; otherwise allocate a deterministic per-turn ID.
  - Reuse the same ID for deltas belonging to one item.
  - Emit `text_end` when that item completes or before a tool/reasoning item interrupts it.
  - Keep synthetic paragraph spacing in the aggregate assistant content without adding unwanted leading whitespace to separately rendered segments.
- Use a per-turn monotonic occurrence timestamp in chat handling for the first chunk of each thinking/text segment and the start of each tool call. This preserves strict ordering even when multiple events occur within the same millisecond.
- Preserve the existing backward-compatible persistence format: assistant text remains the complete response, while multi-segment metadata remains in `text_segments`; no database migration is required.
- Ensure Android’s terminal reconciliation retains the canonical live timeline until the authoritative assistant history row is available, then replaces it without moving, duplicating, or dropping text/tool items.
- Verify desktop’s historical renderer consumes the corrected metadata. Change desktop rendering only if the reproduction shows a remaining ordering defect.

## Interfaces and Compatibility

- No breaking IPC, WebSocket, database, or UI API changes.
- Codex CLI adapter callbacks gain consistent use of the existing optional text `blockId` and existing `text_end` event.
- Existing conversations without segment metadata retain their current full-text fallback.
- Standalone Android and non-Codex providers remain unchanged unless shared regression tests expose a defect.

## Test Plan

- Adapter test: multiple Codex agent-message items separated by command, file-change, and MCP tool items receive distinct stable block IDs and matching `text_end` events.
- Persistence test: `text → tool → text → tool → text` produces ordered segment metadata and tool timestamps, including same-millisecond inputs.
- WebSocket/parser round-trip test: `text_segments`, timestamps, block IDs, and tool-call data survive desktop-to-Android history transport.
- Android reducer/render tests:
  - Live events render in canonical event order.
  - Completion handoff preserves the same order.
  - Reopening the conversation produces the same order.
  - Reconnect/snapshot restoration does not duplicate items.
  - Final text appears exactly once.
- Desktop renderer regression test for the identical persisted timeline.
- Run focused Vitest suites, Android unit tests, TypeScript typecheck/lint, and Android lint/build checks available in the environment.

## Acceptance Criteria and Assumptions

- Android displays text, reasoning, commands, and tool calls in their original chronological order during generation, immediately after completion, after reconnect, and after reopening the chat.
- Desktop exhibits the same ordering for the same persisted response.
- Copy/share/export still use the complete assistant response in reading order.
- No segment or tool call is duplicated, omitted, or moved during live-to-history reconciliation.
- Existing unrelated worktree changes are preserved.
- Scope is limited to timeline normalization, persistence, reconciliation, rendering, tests, and the roadmap/artifact deliverables; no broader chat UI redesign is included.
