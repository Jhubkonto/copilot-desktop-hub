# Streaming Display Fix — Implementation Roadmap

## Context

Nexy streams LLM responses from four backends — Anthropic BYOK, OpenAI-compatible BYOK (including OpenRouter), Claude CLI, and Codex CLI — to both the Electron desktop renderer and the Android companion app over WebSocket. The display pipeline currently separates text, reasoning/thinking blocks, and tool calls into distinct UI elements, which is the correct model (Anthropic's API mandates it; OpenAI uses a distinct `delta.reasoning` field; CLI adapters emit structured events). However the implementation has concrete bugs:

- **Duplicate thinking blocks** briefly appear during the stream→save transition (both live and historical render simultaneously)
- **Thinking blocks freeze as "live"** (never marked done) when the stream ends with error or timing edge cases
- **Tool calls render out of order** relative to the streamed text they follow, because they update state mid-drain
- **Auto-scroll is broken** on both desktop and Android — new content does not pull the chat window down
- **Android display is disordered and unpolished** — thinking bubbles duplicate, stream→awaiting transition flashes, formatting is rough, jump-instead-of-flow layout

The question of whether separate-block rendering is the right approach: **yes**. The problem is not the concept but the event lifecycle, state management, and scroll coordination across providers and platforms.

---

## Architectural Summary

```
Provider (Anthropic/OpenAI/OpenRouter) or CLI (Claude/Codex)
    ↓ SSE stream / JSONL line events
Provider streaming layer (anthropic-provider.ts / openai-provider.ts)
    ↓ onChunk(text) / onThinkingChunk(blockId, chunk) / onThinkingEnd(blockId) callbacks
chat-provider-dispatch.ts
    ↓ webContents.send('chat:stream-response' | 'chat:thinking-delta' | 'chat:thinking-end')
    ↓ broadcastToMobile({ event: 'chat:stream-chunk' | 'chat:thinking-delta' | ... })
        ↓                                       ↓
[Electron IPC → useChat.ts]         [WebSocket → Android ChatViewModel.kt]
        ↓                                       ↓
useStreamingQueue (drain 60 chars/frame)   Channel<String?> drain coroutine
        ↓                                       ↓
ChatMessages.tsx → ThinkingBlock / ToolCallBlock / MessageBubble
                                        ChatScreen.kt → ThinkingBubble / ToolCallBubble / MessageBubble
```

---

## Bug Inventory

### Critical

| # | Bug | Location |
|---|-----|----------|
| C1 | Duplicate thinking blocks at stream→save transition — `frozenThinking` added to message and `setLiveThinkingBlocks(new Map())` are two separate state updates; a render between them shows both historical and live blocks | `useChat.ts` ~L302–323, `ChatMessages.tsx` ~L342–353 + L419–430 |
| C2 | Tool calls render before the text they follow — `onCliToolStart` calls `setMessages()` while text is still draining; grouping logic in ChatMessages can see the tool before the assistant message exists | `useChat.ts` ~L414–456, `ChatMessages.tsx` ~L115–133 |
| C3 | Auto-scroll broken on desktop — chat window does not scroll down as new content arrives | `ChatMessages.tsx` / `ChatWindow.tsx` scroll logic |
| C4 | Auto-scroll broken on Android — chat does not scroll down with new streaming content | `ChatScreen.kt` LazyColumn scroll state |

### High

| # | Bug | Location |
|---|-----|----------|
| H1 | Thinking blocks stay `done: false` after stream closes with error or when `thinking_end` arrives after the null sentinel | `useChat.ts` ~L486–495, stream-close path ~L299–323 |
| H2 | Android: `ChatActivity` error state does not close live thinking blocks | `ChatViewModel.kt` ~L228–231 |
| H3 | Android: 400 ms re-fetch gap — during the window between stream end and history re-fetch, the locally-held streaming message can disappear on navigation | `ChatViewModel.kt` ~L286–300 |
| H4 | Android: duplicate thinking bubbles during stream→awaiting transition (`hasStreamingMessage` guard in current diff covers part of this but not all paths) | `ChatScreen.kt` ~L816–818, L1007–1010 |
| H5 | OpenRouter + Claude thinking silent no-op — `thinkingCallbacks` registered but never fire because OpenRouter doesn't expose Anthropic thinking via the OpenAI-compatible endpoint; no warning shown | `chat-provider-dispatch.ts` |
| H6 | Thinking end before thinking chunk in Claude CLI batch mode — `thinking_end` fires in the same loop iteration as `thinking_chunk`; if IPC delivery reorders them, renderer drops the end event | `cli-adapters/claude.ts` ~L174–178 |

### Medium

| # | Bug | Location |
|---|-----|----------|
| M1 | Final buffer line lost in Claude CLI — if process exits with an unterminated JSON line in buffer, that content is silently dropped | `cli-adapters/claude.ts` ~L254–262 |
| M2 | Codex reasoning summary duplicate event variants — three distinct event-type strings all map to same blockId; risk of duplicate content if format changes | `cli-adapters/codex.ts` ~L123–134 |
| M3 | Android: unpolished formatting — thinking bubble, tool call bubble, and message bubble layout is disordered; content jumps instead of flowing | `ChatScreen.kt` composables |
| M4 | Thinking block auto-collapse timer may be scheduled multiple times if `done` and `content.length` both change rapidly | `ThinkingBlock.tsx` ~L30–45 |

---

## Phase 0 — Thinking Block Lifecycle Hardening (Desktop)

**Goal:** Guarantee that every thinking block is always marked `done: true` when the stream ends, regardless of timing. Fix the duplicate-block rendering flash.

### Checklist

- [x] **`useChat.ts` — mark all live thinking blocks done on stream close**: Before freezing `liveThinkingBlocksRef` into `frozenThinking`, iterate the Map and set `done: true` on every entry. This handles late or missing `thinking_end` events (bugs C1, H1).
- [x] **`useChat.ts` — ignore `thinking_end` after stream closes**: Add a `streamClosedRef = useRef(false)` flag. Set it `true` when the null sentinel arrives. Gate the `onThinkingEnd` handler: if `streamClosedRef.current`, return early.
- [x] **`useChat.ts` — batch thinking clear and message save**: Ensure `setMessages(...)` (adding the finalized assistant message with `thinkingBlocks`) and `setLiveThinkingBlocks(new Map())` execute in the same React batch. In React 19 (already in use) all state updates inside event handlers and async continuations batch automatically — verify both calls are in the same async continuation (not split across `setTimeout` or separate microtasks). If not, wrap with `React.startTransition` or restructure to a single `useReducer` dispatch (bug C1).
- [x] **`ChatMessages.tsx` — guard against simultaneous live + historical thinking**: If `liveThinkingBlocks` has a blockId that also exists in the most recent assistant message's `thinkingBlocks`, skip rendering the live block for that id. Prevents the flash even if the batch is imperfect.
- [x] **`cli-adapters/claude.ts` — fix batch-mode emit order**: In the batch path (lines ~174–178), emit `thinking_chunk` synchronously before `thinking_end` with no async boundary between them. Verify by adding a unit test that traces emission order (bug H6).
- [x] **`useChat.ts` — queue `thinking_end` received before matching blockId**: In `onThinkingEnd`, if the blockId is not yet in `liveThinkingBlocksRef`, store it in a `pendingThinkingEndsRef` set. In `onThinkingChunk`, after adding a new blockId, check `pendingThinkingEndsRef` and replay the end event immediately.
- [x] **Unit test**: Add `src/main/__tests__/cli-claude-thinking.test.ts` — simulate batch-mode assistant response with thinking block, assert `thinking_chunk` fires before `thinking_end`.
- [x] **Unit test**: Add renderer test in `src/renderer/__tests__/useChat-thinking.test.ts` — mock IPC events with `thinking_end` arriving before `thinking_chunk`; assert block ends up `done: true` after both arrive.

### Phase 0 Protocol Gate
```
npm run test
npm run typecheck
npm run lint
npm run build
```

---

## Phase 1 — Tool Call / Text Ordering Fix (Desktop)

**Goal:** Tool call messages always appear after the text that precedes them in the stream, and are correctly grouped with the subsequent assistant response.

### Checklist

- [x] **`useStreamingQueue.ts` — expose `flush()` and `pause()` / `resume()`**: Add a `flush(): Promise<void>` that drains all queued characters synchronously (or in a single flush frame) and a `isPaused` ref so callers can gate new character intake.
- [x] **`useChat.ts` `onCliToolStart` handler — flush drain queue first**: Before calling `setMessages()` to insert the tool-call message, call `await flushQueue()` so all pending streamed text is committed to the DOM first. Only then append the tool message.
- [x] **`useChat.ts` `onCliToolEnd` handler**: No queue pause needed here — just ensure the tool-result message is appended after flush resolves.
- [x] **`ChatMessages.tsx` — strengthen grouping guard**: The tool→assistant grouping (lines ~115–133) should verify the assistant message's timestamp is ≥ the tool call's timestamp before grouping. This handles edge cases where historical data arrives out of order.
- [x] **Manual smoke test**: Send a message that triggers an MCP tool call. Verify: text streamed before the tool call appears first, then tool block, then subsequent text — no jumbling.
- [x] **Renderer test**: Mock a sequence of `stream-response` chunks → `tool-start` event → more `stream-response` chunks; assert messages array order is `[assistant-text-1, tool-call, assistant-text-2]`.

### Phase 1 Protocol Gate
```
npm run test
npm run typecheck
npm run lint
npm run build
```

---

## Phase 2 — Auto-Scroll Fix (Desktop)

**Goal:** The chat window scrolls down automatically as new content (text, thinking blocks, tool calls) arrives during streaming, and after stream end.

### Checklist

- [x] **Audit current scroll mechanism**: Read `ChatMessages.tsx` and `ChatWindow.tsx` (or equivalent scroll container) — identify where scroll-to-bottom is currently attempted and why it fails during streaming.
- [x] **Implement scroll-to-bottom on new content**: In the streaming text container (wherever `streamingContentRef` or the drain output renders), add a `useEffect` that fires on each new character batch from the drain queue and calls `scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'instant' })`. Use `behavior: 'instant'` during active streaming to avoid lag; switch to `'smooth'` on stream end.
- [x] **Scroll on thinking block change**: When `liveThinkingBlocks` Map size increases (new block added) or content length increases, trigger the same scroll-to-bottom.
- [x] **Scroll on tool call appended**: When a tool-call message is inserted (after the flush in Phase 1), scroll to bottom.
- [x] **User scroll-up detection**: If the user has manually scrolled up during streaming, do not force-scroll them back down. Use an `isUserScrolledUp` ref — set `true` when `scrollTop < scrollHeight - clientHeight - threshold` (threshold ~100px). Resume auto-scroll when user scrolls back to bottom.
- [x] **Scroll on stream end**: When the null sentinel arrives, after the final message is committed, scroll to bottom unconditionally (user is likely reading the end of the response).
- [x] **Test**: In Electron dev mode, start a long streaming response. Verify: scroll follows content down automatically. Scroll up mid-stream: verify lock-off. Scroll back to bottom: verify auto-scroll resumes.

### Phase 2 Protocol Gate
```
npm run typecheck
npm run lint
npm run build
# Manual test: Electron dev — streaming auto-scroll golden path
```

---

## Phase 3 — OpenRouter Thinking Detection (Desktop)

**Goal:** No silent no-ops when thinking effort is requested but not supported by the selected provider/model combination.

### Checklist

- [x] **`chat-provider-dispatch.ts` — detect unsupported thinking**: Before dispatching, check: `provider === 'openrouter' && thinkingEffort is set && model starts with 'anthropic/'`. If true, log a warning and strip the `thinkingEffort` from options before dispatch. Optionally emit a `chat:activity-global` message with label `"Thinking not supported via OpenRouter for Claude models — effort ignored"`.
- [x] **`src/shared/types.ts` or a new `provider-capabilities.ts` — document thinking support per provider**: Add a `PROVIDER_THINKING_SUPPORT` const:
  ```typescript
  export const PROVIDER_THINKING_SUPPORT: Record<string, boolean | 'o-series-only'> = {
    anthropic: true,
    openai: 'o-series-only',
    azure: 'o-series-only',
    openrouter: false,
    groq: false,
    mistral: false,
    gemini: false,
    xai: false,
  }
  ```
- [x] **UI — suppress thinking-effort controls for unsupported providers**: In the model/agent settings panel where thinking effort is configured, look up `PROVIDER_THINKING_SUPPORT` and disable/hide the control when the selected provider is not `true` or does not match `o-series-only` for the selected model.
- [x] **`cli-adapters/claude.ts` — buffer flush on process close** (bug M1): On stream close, check if `buffer.trim()` is non-empty. Try `JSON.parse(buffer)` — if it succeeds, process the object. If it fails, call `onChunk(buffer)` as raw text fallback.
- [x] **`cli-adapters/codex.ts` — normalize reasoning event format** (bug M2): Collapse the three reasoning event-type checks into a single priority-ordered check with one emit path. Add a comment documenting which API versions emit each format.

### Phase 3 Protocol Gate
```
npm run test
npm run typecheck
npm run lint
npm run build
```

---

## Phase 4 — Android: Thinking Block + Stream Lifecycle Fixes

**Goal:** Android's thinking blocks and stream state are always consistent; no duplicates, no frozen-live blocks, no transition flashes.

### Checklist

- [x] **`ChatViewModel.kt` — mark all live thinking blocks done on error**: In `handleEvent(ChatActivity)`, when `event.data.state == "error"`, call `markAllLiveThinkingDone()` (sets `done = true` on every entry in `_liveThinkingBlocks`). (Bug H2.)
- [x] **`ChatViewModel.kt` — mark all live thinking blocks done on stream end**: In `handleEvent(ChatStreamEnd)`, before `transferThinkingToStreamingMessage()`, call `markAllLiveThinkingDone()` so all blocks are `done: true` when transferred. (Bug H1, Android side.)
- [x] **`ChatViewModel.kt` — eliminate 400 ms re-fetch gap** (bug H3): On `ChatStreamEnd`, immediately mark the local streaming message as `isStreaming = false` with the transferred thinking blocks (optimistic finalization). Issue the history re-fetch in the background and swap the optimistic message with the fetched row when it arrives. Remove the hardcoded 400ms delay.
- [x] **`ChatScreen.kt` — verify `hasStreamingMessage` guard covers all transition paths** (bug H4): Trace the `isAwaitingResponse` + `isStreaming` + `hasStreamingMessage` state machine through: (a) normal stream end, (b) stream end with error, (c) tool call mid-stream. Add comments documenting which guard prevents which duplicate render scenario.
- [x] **`ChatViewModel.kt` — guard against `ChatThinkingDelta` after stream end**: Add an `isStreamEnded` flag. Set it on `ChatStreamEnd`. In `handleEvent(ChatThinkingDelta)` and `handleEvent(ChatThinkingEnd)`, return early if `isStreamEnded`. Reset on next send.
- [x] **Android unit test**: Add a ViewModel test that sends `ChatThinkingDelta` → `ChatThinkingEnd` → `ChatStreamEnd` and asserts all blocks are `done = true` in the finalized message.
- [x] **Android unit test**: Send `ChatActivity(state="error")` mid-stream and assert live thinking blocks are all marked done.

### Phase 4 Protocol Gate
```
# Android
./gradlew :app:testDebugUnitTest
./gradlew :app:lint
./gradlew :app:assembleDebug
# Manual: connect Android companion, trigger streaming response with thinking — verify no frozen blocks
```

---

## Phase 5 — Android: Auto-Scroll and Layout Polish

**Goal:** Android chat scrolls down automatically with new content; display is ordered, polished, and smooth.

### Checklist

**Auto-scroll:**
- [x] **`ChatScreen.kt` — scroll-to-bottom during streaming**: In the `LazyColumn` composable that renders messages, obtain a `LazyListState`. Add a `LazyEffect` (or `SideEffect` / `LaunchedEffect`) that fires whenever `messages.size` changes OR `streamingText.length` changes — call `listState.animateScrollToItem(messages.size - 1)`.
- [x] **`ChatScreen.kt` — user scroll-up detection**: Track whether the user has manually scrolled up via `listState.isScrollInProgress` and `listState.firstVisibleItemIndex`. If the last visible item is not the last message, set `autoScrollEnabled = false`. Re-enable when user scrolls to bottom.
- [x] **`ChatScreen.kt` — scroll on tool call inserted**: When a tool-call message is added mid-stream, trigger scroll-to-bottom (unless user has scrolled up).
- [x] **`ChatScreen.kt` — scroll on stream end**: On `isAwaitingResponse` becoming false, scroll to bottom unconditionally.

**Layout polish:**
- [x] **`ChatScreen.kt` — thinking bubble placement**: Thinking bubbles should appear above the streaming text bubble for the same turn, not as separate items that jump around. Verify the composable nesting: `ThinkingBubble` should be a child of or visually adjacent to the message bubble container for the same turn.
- [x] **`ChatScreen.kt` — tool call bubble placement**: Tool call bubbles should appear inline with the turn they belong to. Verify grouping logic matches desktop (`ChatMessages.tsx` lines ~115–133).
- [x] **`ChatScreen.kt` — smooth content flow**: Replace any `text = streamingText` direct assignment that causes layout jumps with incremental append driven by the drain coroutine already in `ChatViewModel`. Ensure the `LazyColumn` item for the streaming message does not remeasure from zero on each chunk.
- [x] **`ChatScreen.kt` — awaiting/streaming transition**: Remove any visible flash between `isStreaming` and `isAwaitingResponse` states. The streaming bubble should fade out only after the history re-fetch (Phase 4 optimistic finalization) completes.
- [x] **`ChatScreen.kt` — thinking bubble collapse animation**: On `done = true`, collapse with a smooth `animateContentSize()` instead of an instant hide. Match desktop 2s auto-collapse behavior.
- [x] **`ChatScreen.kt` — message bubble typography**: Audit `MessageBubble` composable for consistent line spacing, code block formatting, and markdown rendering. Ensure code blocks do not overflow horizontally.
- [x] **Manual test**: Connect Android companion. Send a long response with thinking enabled. Verify: content flows smoothly, no jumps, scroll follows, thinking collapses gracefully after done.

### Phase 5 Protocol Gate
```
./gradlew :app:testDebugUnitTest
./gradlew :app:lint
./gradlew :app:assembleDebug
# Manual: Android — full golden path (thinking + tool call + long response)
```

---

## Phase 6 — Desktop: ThinkingBlock Polish + Regression Hardening

**Goal:** Desktop thinking and tool call blocks behave correctly across all edge cases; full regression suite passes.

### Checklist

- [x] **`ThinkingBlock.tsx` — fix auto-collapse timer stacking** (bug M4): In the `useEffect` that schedules auto-collapse, clear the previous timer before scheduling a new one (`return () => clearTimeout(timerId)`). Ensure the effect dependency array is minimal — only `done`, not `content` (content length change should not reschedule collapse).
- [x] **`ThinkingBlock.tsx` — consistent collapse on response**: When `isResponseStreaming` becomes `true`, collapse immediately regardless of `done` state.
- [x] **`ToolCallBlock.tsx` — auto-collapse timer audit**: Same pattern as ThinkingBlock — verify the 2s auto-collapse timer is not stacked on rapid `inProgress` → `done` transitions.
- [x] **Regenerate path**: When a message is regenerated, verify `liveThinkingBlocks` is fully cleared before the new stream starts. Add a renderer test: regenerate mid-thinking → assert no blocks from previous attempt remain.
- [x] **OpenAI / OpenRouter reasoning block single-instance**: Verify that `reasoning-0` block is properly closed when text content begins (openai-provider.ts `reasoningBlockOpen` flag). Test with an o-series model via BYOK and with a Gemini model via OpenRouter.
- [x] **`useChat.ts` — placeholder block cleanup on real chunk**: Verify line ~480 (`next.delete('restore-placeholder')`) fires correctly when the first real thinking chunk arrives after navigation. Add test.
- [x] **Full test run**: All existing tests must pass with no regressions.
- [x] **Lint**: `npm run lint` — zero errors.
- [x] **Typecheck**: `npm run typecheck` — zero errors.
- [x] **Build**: `npm run build` — clean build.

### Phase 6 Protocol Gate
```
npm run test          # all tests pass
npm run typecheck     # zero errors
npm run lint          # zero errors
npm run build         # clean build
# Manual: Electron dev — regenerate with thinking; OpenRouter Gemini with reasoning; MCP tool call
```

---

## End-to-End Verification Checklist

After all phases are complete, verify the following golden paths:

- [x] **Anthropic BYOK with thinking**: Long response, thinking effort `medium`. Desktop: thinking block auto-expands, streams, collapses 2s after done, does not duplicate at stream end. Auto-scroll follows throughout.
- [x] **Claude CLI with thinking**: Same flow via CLI adapter. Batch-mode thinking arrives correctly ordered.
- [x] **OpenAI o-series with reasoning**: `reasoning-0` block opens, content streams, closes when text begins. Auto-scroll active.
- [x] **OpenRouter (Gemini) with reasoning**: `delta.reasoning` arrives, shows in reasoning block, closes, text streams.
- [x] **OpenRouter + Claude model with thinking effort set**: Warning shown or effort silently stripped — no frozen live block.
- [x] **MCP tool call mid-stream**: Text before tool call renders first, tool block appears after flush, tool result shows, subsequent text continues. Desktop and Android both ordered correctly.
- [x] **Codex CLI**: Reasoning summary block appears and closes. Activity block does not remain live after stream end.
- [x] **Regenerate**: Regenerating a response clears all previous thinking blocks and starts fresh.
- [x] **Error during stream**: On provider error mid-stream, all live thinking blocks are closed. No orphaned live blocks on desktop or Android.
- [x] **Android companion**: All of the above scenarios verified on Android — auto-scroll active, no jumps, thinking collapses gracefully, tool calls in correct order.
- [x] **Android build**: `./gradlew :app:assembleDebug` completes cleanly.
- [x] **Desktop build**: `npm run build` completes cleanly.
- [x] **Typecheck**: `npm run typecheck` — zero errors.
- [x] **Lint**: `npm run lint` — zero errors.
- [x] **Tests**: `npm run test` — all pass.

---

## Files to be Modified

| File | Phase(s) |
|------|----------|
| `src/renderer/hooks/useChat.ts` | 0, 1, 2 |
| `src/renderer/hooks/useStreamingQueue.ts` | 1 |
| `src/renderer/components/chat/ChatMessages.tsx` | 0, 1, 2 |
| `src/renderer/components/chat/ThinkingBlock.tsx` | 6 |
| `src/renderer/components/chat/ToolCallBlock.tsx` | 6 |
| `src/main/cli-adapters/claude.ts` | 0, 3 |
| `src/main/cli-adapters/codex.ts` | 3 |
| `src/main/chat-provider-dispatch.ts` | 3 |
| `src/shared/types.ts` (or new `provider-capabilities.ts`) | 3 |
| Agent/model settings UI component | 3 |
| `android/app/src/main/java/io/nexy/android/ui/chat/ChatViewModel.kt` | 4 |
| `android/app/src/main/java/io/nexy/android/ui/chat/ChatScreen.kt` | 4, 5 |
| `src/main/__tests__/cli-claude-thinking.test.ts` | 0 (new) |
| `src/renderer/__tests__/useChat-thinking.test.ts` | 0 (new) |

---

## Key Reusable Code (do not rewrite)

- `broadcastToMobile()` — `src/main/ws-server.ts` — used by chat-handlers to relay events to Android; extend for new events rather than rewriting
- `safeHandle()` — `src/main/safe-handle.ts` — required for all IPC handlers
- `useStreamingQueue` — `src/renderer/hooks/useStreamingQueue.ts` — extend with `flush()`/`pause()` rather than replace
- `ActionButton` — `src/renderer/components/MessageBubble.tsx` — reuse for any new UI controls
- `initializeBaseSchema` + `runMigrations` — `src/main/database-migrations.ts` — used in tests for in-memory SQLite setup
