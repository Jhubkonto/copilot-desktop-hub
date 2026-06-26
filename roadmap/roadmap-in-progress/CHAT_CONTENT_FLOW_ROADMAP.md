# Chat Content Flow Unification Roadmap

## Summary

Current chat flow is not ideal. Desktop and Android both work, but incoming provider content is handled through many parallel states: stream chunks, persisted history reloads, activity events, thinking deltas, tool-call events, CLI-only events, background conversation guards, and platform-specific recovery paths. The result is hard to reason about and easy to break.

Major refactoring is needed, but it should be phased. Keep existing IPC and WebSocket contracts working at first, then introduce a single normalized chat turn event model and one reducer per platform.

## Key Changes

- [x] Add a shared normalized chat turn event model:
  - [x] `turn_started`
  - [x] `user_message_committed`
  - [x] `assistant_text_delta`
  - [x] `thinking_delta`
  - [x] `thinking_done`
  - [x] `tool_started`
  - [x] `tool_finished`
  - [x] `activity_changed`
  - [x] `cost_updated`
  - [x] `turn_completed`
  - [x] `turn_failed`
  - [x] `history_snapshot_received`
- [x] Create a main-process `ChatTurnEmitter` that owns event ordering and emits to both Electron IPC and Android WebSocket from the same source.
- [x] Keep current event names initially, but generate them from the normalized emitter so desktop and Android receive equivalent lifecycle events.
- [x] Add a monotonically increasing `sequence` per conversation turn to make out-of-order delivery detectable.
- [x] Add a `turnId` to live stream events so UI reducers can distinguish late events from previous turns.

## Desktop Findings And Fix Plan

- `chat-handlers.ts` currently emits chunks, stream end, errors, activity, thinking, CLI tool events, and persisted DB messages from multiple branches. Refactor this into one turn lifecycle layer used by BYOK providers, tool loops, orchestration, and CLI adapters.
- `dispatchToProvider` partially normalizes providers, but CLI flow bypasses much of that normalization. Wrap CLI adapters and BYOK providers behind the same `ProviderTurnDriver` interface.
- `useChat.ts` is too broad: it handles history loading, optimistic messages, streaming, smoothing, thinking, tool calls, regeneration, edit rollback, model tracking, cost, background streams, and reload reconciliation. Split into `useConversationHistory`, `useChatTurnReducer`, `useChatActions`, and `useChatLiveEvents`.
- Replace ad hoc refs like `ignoreRemoteStreamRef`, `streamEndedRef`, `streamClosedRef`, and `pendingThinkingEndsRef` with a reducer state machine.
- Fix the smoothing mismatch: `ChatMessages.tsx` should render the drained/displayed content, not raw `streamingContent`, or remove the queue if instant display is desired.
- Move tool-call grouping out of render-time heuristics and into the reducer. The message list should already be ordered before it reaches `ChatMessages`.

## Android Findings And Fix Plan

- `WsRepository` and `ChatViewModel` both reduce live chat state. Consolidate active turn state into one reducer owned by `ChatViewModel` or a new `ChatTurnStore`; keep `WsRepository` focused on transport, connection, and broad app-level lists.
- Preserve existing recovery behavior: active snapshots, completed-while-away tracking, and active history polling are useful, but they should become explicit reducer events rather than side effects spread across two classes.
- Replace `streamCompleted`, `isStreamEnded`, `_isAwaitingResponse`, `_isStreaming`, `_liveThinkingBlocks`, and `streamBuffer` coordination with a single `ChatTurnState`.
- Keep the Android typewriter buffer, but make finalization depend on reducer state plus drain completion, not separate booleans.
- Ensure `ConversationMessages` reconciliation cannot overwrite a live turn unless the snapshot is authoritative for the same `turnId` or represents a completed persisted assistant response.
- Make tool calls, team activity, reasoning, streamed text, and cost part of one ordered turn model before rendering in Compose.

## Refactoring Phases

### Phase 1: Baseline Tests And Diagnostics

- [x] Add event-order regression tests for desktop:
  - [x] provider text-only stream
  - [x] provider thinking plus text stream
  - [x] provider tool loop with text before and after tool call
  - [x] CLI tool start/end interleaved with text
  - [x] error after partial thinking
  - [x] stream end before final history reload
- [ ] Add Android tests for:
  - [x] `ChatStreamEnd` before final chunk drain completes
  - [x] `ChatActivity(complete)` without chunks
  - [x] history snapshot arriving during active stream
  - [x] late thinking/tool events after turn completion
  - [x] re-entering an active background conversation
- [x] Add temporary structured debug logs with `conversationId`, `turnId`, `sequence`, event type, and platform target. (added and removed — covered by debugLog in chat-turn-emitter and tests)

### Phase 2: Main-Process Normalization

- [x] Add `ChatTurnEmitter` and normalized event types in shared/main code.
- [x] Route BYOK provider callbacks, tool-loop callbacks, CLI adapter callbacks, orchestration events, and error handling through the emitter.
- [x] Keep current IPC/WebSocket event names as compatibility output.
- [x] Persist assistant messages, thinking blocks, and tool calls from one final turn snapshot rather than duplicating persistence logic per provider path.
- [x] Add tests proving BYOK and CLI paths produce equivalent normalized event sequences.

### Phase 3: Desktop Reducer

- [x] Introduce `chatTurnReducer` for live desktop state.
- [x] Subscribe desktop chat state to normalized `chat:turn-event` through `useChatLiveTurn`.
- [x] Add ordered `ChatRenderItem` adapter for history plus live turn state.
- [x] Move historical tool-call grouping in `ChatMessages` onto the render-item adapter.
- [x] Use normalized live turn state as fallback for desktop live thinking, activity, and cost display.
- [x] Deduplicate repeated normalized `tool_finished` events by tool id in desktop and Android reducers.
- [x] Prevent duplicate normalized CLI `tool_finished` emissions at the source emitter path.
- [x] Render normalized live tool blocks as a desktop fallback with id/signature dedupe.
- [x] Migrate `useChat.ts` stream/thinking/tool/activity/cost handling into reducer actions.
- [x] Make `ChatMessages` receive ordered render items:
  - [x] historical message
  - [x] historical tool block grouping
  - [x] live thinking block fallback
  - [x] live tool block fallback
  - [x] live assistant text
  - [x] activity placeholder fallback
- [x] Render drained stream content consistently.
- [x] Keep edit/regenerate behavior, but express rollback as reducer actions.

### Phase 4: Android Reducer

- [x] Add Android `ChatTurnReducer` and `ChatTurnState`.
- [x] Subscribe `ChatViewModel` to normalized `ChatTurnEvent` as passive `liveTurnState`.
- [x] Move live stream, thinking, tool-call, activity, cost, and history reconciliation logic out of scattered `when` branches.
- [x] Keep `WsRepository.activeChatSnapshots` only if needed for home/sidebar indicators; otherwise derive active state from reducer snapshots.
- [x] Preserve active history polling as a recovery mechanism, but trigger it from explicit reducer states.
- [x] Update Compose rendering to consume ordered chat render items.

### Phase 5: Contract Cleanup

- [x] After desktop and Android consume normalized lifecycle state, remove obsolete compatibility branches where safe.
- [x] Standardize persisted `tool-call` and `thinking_blocks` serialization.
- [x] Document chat event lifecycle in `src/docs/ARCHITECTURE.md` or a new chat-flow doc.
- [x] Remove temporary logs after tests cover the event-order cases.

## Test Plan

- Desktop:
  - [x] `npm test` (23 pre-existing failures in unrelated test files; all chat/tool/emitter tests pass)
  - [x] targeted Vitest regression suite
  - [x] targeted `ChatTurnEmitter` regression tests
  - [x] targeted desktop `chatTurnReducer` tests
  - [x] targeted `ChatRenderItem` adapter tests
  - [x] targeted `ChatMessages` normalized live-turn fallback tests
  - [x] targeted `useChatLiveTurn` subscription coverage through `useChat` tests
  - [x] `npm run lint`
  - [x] `npm run typecheck`
  - [x] `npm run build`
- Android:
  - [x] targeted `ChatThinkingParserTest`
  - [x] targeted `ChatTurnReducerTest`
  - [x] targeted `ChatViewModelTest` normalized live-turn subscription coverage
  - [x] from `android/`: `./gradlew test`
  - [x] from `android/`: `./gradlew lintDebug`
  - [x] from `android/`: `./gradlew assembleDebug`
- Manual smoke tests:
  - [x] OpenAI/OpenRouter text-only response
  - [x] Anthropic/Codex/Claude reasoning response
  - [ ] CLI tool call with text before and after tool execution
  - [ ] provider MCP tool loop
  - [ ] stop generation mid-stream
  - [ ] regenerate last assistant response
  - [ ] switch away from active conversation and return
  - [ ] Android reconnect during active stream
  - [ ] Android history refresh while stream is active

## Assumptions

- The correct direction is phased refactoring, not a full rewrite.
- Existing IPC/WebSocket event names should remain compatible during migration.
- Provider-specific parsing can stay provider-specific, but provider output must be normalized before UI state receives it.
