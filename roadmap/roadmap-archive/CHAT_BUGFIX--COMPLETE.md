# Roadmap: Chat Bug-Fix & Polish Pass

## Context

Follow-up to the completed CHAT_UI_REVAMP roadmap. After exercising both the desktop and Android chat UIs, 10 bugs and UX gaps were identified covering: tool call crash on Android, oversized bubbles, streaming animation completeness, thinking block timing, text size, and cross-platform activity state sync.

---

## Bug 1 — Android crash: tool call events never sent to Android

**Root cause:** `tool-loop.ts` emits `chat:tool-call-event` to the Electron renderer only. Android never receives it, so arriving tool calls from a CLI/BYOK chat with web_search cause unexpected state in `ChatViewModel`.

### Checklist
- [x] 1.1 In `src/main/tool-loop.ts`, import `broadcastToMobile` from `./ws-server` and add a `broadcastToMobile({ event: 'chat:tool-call-event', data: { conversationId, toolName, serverName, args, result, success } })` call immediately after each `webContents.send('chat:tool-call-event', ...)` (lines 158, 174, 192, 208, 240)
- [x] 1.2 Add `data class ChatToolCallEvent(val conversationId: String, val toolName: String, val serverName: String?, val args: String?, val result: String, val success: Boolean) : WsEvent()` to `android/.../data/model/WsEvent.kt`
- [x] 1.3 Add `"chat:tool-call-event"` parsing case in `android/.../data/WsEventParser.kt` → emit `ChatToolCallEvent`
- [x] 1.4 In `android/.../ui/chat/ChatViewModel.kt`, handle `WsEvent.ChatToolCallEvent` in the `wsClient.events.collect` block: append a tool-call `ChatMessage` to `_messages` (or update an existing in-progress one by matching `toolName`)

---

## Bug 2 + 5 + 6 — Android tool call and thinking blocks are constrained bubbles (should be full-width)

**Root cause:** Both `ToolCallBubble` and `ThinkingHistoryBubble` wrap their content in a `Surface` with `Modifier.widthIn(max = 320.dp)`. They should span the full chat width with a left-border accent, matching the assistant message style.

### Checklist
- [x] 2.1 In `ChatScreenBubbles.kt` `ToolCallBubble` (lines 505–604): remove `Modifier.widthIn(max = 320.dp)` from the `Surface`; replace the `Row(Arrangement.Start)` + `Surface` wrapper with a full-width `Column(Modifier.fillMaxWidth())` plus a 2dp `outlineVariant` left-border accent strip
- [x] 2.2 In `ChatScreenBubbles.kt` `ThinkingHistoryBubble` (lines 205–277): remove `Modifier.widthIn(max = 320.dp)` from the `Surface`; use `Modifier.fillMaxWidth()` on the outer wrapper; change the `Row(Arrangement.Start)` wrapper to `Column(Modifier.fillMaxWidth())`
- [x] 2.3 Desktop `ToolCallBlock.tsx`: reduce the header button padding from `py-2` to `py-1.5` to make each row feel slimmer

---

## Bug 3 + 10 — Thinking block should collapse immediately when response starts, not 2s after it finishes

**Root cause:** Both desktop `ThinkingBlock.tsx` and Android `ThinkingHistoryBubble` only schedule a collapse 2 seconds after the thinking block is `done`. They don't react to the response text beginning to stream.

### Checklist
- [x] 3.1 Desktop `ThinkingBlock.tsx`: add `isResponseStreaming?: boolean` prop; in the `useEffect`, when `isResponseStreaming === true`, immediately call `setExpanded(false)` and clear any pending collapse timer
- [x] 3.2 Identify where `ThinkingBlock` is rendered (in `ChatMessages.tsx` or `MessageBubble.tsx`) and pass `isStreaming` from the parent message as the `isResponseStreaming` prop
- [x] 3.3 Android `ThinkingHistoryBubble`: add `responseIsStreaming: Boolean = false` parameter; in `LaunchedEffect(isLive, totalChars, responseIsStreaming)`, when `responseIsStreaming && !isLive`, immediately set `expanded = false` (no delay)
- [x] 3.4 In `ChatScreen.kt`, update the `ThinkingHistoryBubble` call site (around lines 742–747) to pass `responseIsStreaming = msg.isStreaming`

---

## Bug 4 + 9 — Thinking/reasoning text is too small (desktop) and uses `labelSmall` font (Android)

**Root cause:** Desktop uses `text-[11px]` in the `<pre>` block. Android uses `MaterialTheme.typography.labelSmall` for thinking content.

### Checklist
- [x] 4.1 Desktop `ThinkingBlock.tsx:79`: change `text-[11px]` → `text-[13px]`
- [x] 4.2 Android `ThinkingHistoryBubble`: change thinking content `Text` style from `typography.labelSmall` → `typography.bodySmall` (or `labelMedium`)

---

## Bug 7 — Streaming text clears the cursor / marks done before the drain queue empties

**Root cause:**
- Desktop: `useChat.ts` sets `isStreaming = false` immediately on the stream-end signal, before `useStreamingQueue` has finished draining buffered characters. The blinking cursor disappears too early.
- Android: `ChatViewModel.kt` sets `_isStreaming.value = false` as soon as the `null` sentinel is dequeued from `streamBuffer`, before the last chunk's characters have finished rendering.

### Checklist
- [x] 7.1 Desktop `useStreamingQueue.ts`: verify `isDraining` is already exported (it is, per `useChat.ts:44`); if not, add it as `true` while the RAF loop has pending characters
- [x] 7.2 Desktop `useChat.ts`: when the end-of-stream signal (`chunk === null`) arrives, set a `streamEndSignaled` ref to `true` but do NOT immediately set `isStreaming = false`; add a `useEffect` that watches `isDraining` — when `isDraining` becomes `false` and `streamEndSignaled` is `true`, then set `isStreaming = false` and clear the ref
- [x] 7.3 Android `ChatViewModel.kt` drain coroutine: when the `null` sentinel is received, set a local `var endOfStreamPending = true` flag and `continue` to the next iteration; after the last real chunk's `while (remaining.isNotEmpty())` loop finishes, check `endOfStreamPending` and only then set `_isStreaming.value = false` and send the final message update

---

## Bug 8 — No activity indicator on conversation list when LLM is active in a background chat

### Android (conversation rows on HomeScreen)
**Root cause:** `WsRepository` receives `ChatActivity` events but only `ChatViewModel` handles them. `HomeScreen` has no visibility into which conversations are active.

#### Checklist
- [x] 8A.1 In `android/.../data/WsRepository.kt`, add `val activeConversationIds: MutableStateFlow<Set<String>> = MutableStateFlow(emptySet())` (or in a companion object / singleton); in the event parsing loop, when a `ChatActivity` event arrives with `state` of `"active"`, `"thinking"`, or `"tool"`, add its `conversationId`; when `state` is `"complete"` or `"error"`, remove it
- [x] 8A.2 In `android/.../ui/home/HomeViewModel.kt`, expose `val activeConversationIds: StateFlow<Set<String>>` collected from `WsRepository.activeConversationIds`
- [x] 8A.3 In `HomeScreen.kt`, read `activeConversationIds` via `vm.activeConversationIds.collectAsState()` and for each conversation row where `conv.id` is in the set, render a pulsing dot (6–8dp, `MaterialTheme.colorScheme.primary`, `infiniteTransition` alpha between 0.3f and 1f at 800ms period) next to the title

### Desktop (sidebar showing Android-initiated or background chats)
**Root cause:** `markConversationGenerating` is only called from within a mounted `useChat` hook. If the chat window is closed, there is no hook instance, so background generation is invisible in the sidebar.

#### Checklist
- [x] 8B.1 In `src/main/chat-handlers.ts`, for the `chat:activity` event (line 119), also forward it to the renderer via `window.webContents.send('chat:activity-global', { conversationId, state, label })` (use a separate channel name to avoid collision with the existing `chat:activity` handler in `useChat`)
- [x] 8B.2 In `src/preload/index.ts`, expose `onActivityGlobal(cb)` subscribing to `chat:activity-global`
- [x] 8B.3 In `src/renderer/store/slices/uiSlice.ts` or `src/renderer/App.tsx` (wherever app-level IPC subscriptions live), subscribe to `onActivityGlobal`; when `state !== "complete" && state !== "error"`, call `markConversationGenerating(conversationId)`; when done, call `markConversationDoneGenerating(conversationId)`

---

## Bug 9 — Cross-platform conversation activity state sync

When a conversation is active on one platform, the other platform's conversation list should reflect it.

**Android → Desktop:** Covered by Bug 8 Desktop fix above (`chat:activity-global` → sidebar spinner).

**Desktop → Android:** Covered by Bug 8 Android fix above (`WsRepository.activeConversationIds` tracks all `ChatActivity` events regardless of origin; desktop-originated chats already broadcast `chat:activity` to Android).

**In-chat real-time:** Already works — streaming chunks are broadcast to both platforms in parallel in `chat-handlers.ts`. No change needed.

### Checklist
- [x] 9.1 Verify that after Bug 8A and 8B fixes, starting a chat on desktop causes a pulsing dot to appear on the Android HomeScreen for that conversation
- [x] 9.2 Verify that starting a chat on Android causes the desktop sidebar to show a generating spinner for that conversation (even if the desktop chat window is closed)
- [x] 9.3 Verify both indicators clear correctly when the response completes

---

## Files Changed

| File | Bugs |
|------|------|
| `src/main/tool-loop.ts` | 1 |
| `src/main/chat-handlers.ts` | 8B |
| `src/preload/index.ts` | 8B |
| `src/renderer/store/slices/uiSlice.ts` or `App.tsx` | 8B |
| `src/renderer/components/chat/ThinkingBlock.tsx` | 3, 4 |
| `src/renderer/components/chat/ChatMessages.tsx` or `MessageBubble.tsx` | 3 |
| `src/renderer/components/chat/ToolCallBlock.tsx` | 2 |
| `src/renderer/hooks/useStreamingQueue.ts` | 7 |
| `src/renderer/hooks/useChat.ts` | 7 |
| `android/.../data/model/WsEvent.kt` | 1 |
| `android/.../data/WsEventParser.kt` | 1 |
| `android/.../data/WsRepository.kt` | 8A |
| `android/.../ui/chat/ChatViewModel.kt` | 1, 7 |
| `android/.../ui/chat/ChatScreenBubbles.kt` | 2, 3, 4 |
| `android/.../ui/chat/ChatScreen.kt` | 3 |
| `android/.../ui/home/HomeViewModel.kt` | 8A |
| `android/.../ui/home/HomeScreen.kt` | 8A |

---

## Verification

1. **Tool call crash (Bug 1)** — Start a regular (non-agent) chat using Claude CLI / Haiku and ask it to search online. Confirm tool calls appear on both desktop and Android without crashing.
2. **Tool call + thinking width (Bugs 2, 4, 6)** — Confirm Android shows both tool call rows and thinking blocks spanning the full chat width with a left-border accent, not constrained cards.
3. **Thinking collapse timing (Bugs 3, 10)** — Trigger extended thinking; confirm the thinking block collapses *immediately* when the response text begins streaming, not 2 seconds after it finishes.
4. **Thinking text size (Bug 4, 9)** — Confirm desktop thinking content is visibly larger (`text-[13px]`); Android uses `bodySmall` or `labelMedium`.
5. **Streaming cursor (Bug 7)** — Ask for a long response; confirm the blinking cursor stays visible until the last character has rendered, not just until the WS stream-end event fires.
6. **Background activity — Android (Bug 8A)** — Start a long desktop query, switch to Android HomeScreen; confirm pulsing dot on the conversation row; confirm it disappears on completion.
7. **Background activity — Desktop (Bug 8B)** — Start a long Android query, look at the desktop sidebar with the chat window closed; confirm generating spinner appears; confirm it clears on completion.
8. **Cross-platform sync (Bug 9)** — Confirm both directions of the above; confirm in-chat simultaneous streaming still works.
9. **No regressions** — Run `npm test`. Manually verify user bubbles, tool call expand/collapse, thinking expand/collapse, scroll guard, and sidebar unread indicators.
