# Roadmap: Chat UI Revamp — Desktop & Android

## Context

The current chat UI uses basic Tailwind animation utilities (animate-pulse, animate-bounce, animate-spin) on the desktop and simple Compose transitions (AnimatedVisibility with expandVertically/shrinkVertically, infiniteRepeatable keyframes) on Android. Neither platform has a cohesive visual language, fluid streaming animations, or smart content formatting. This roadmap defines a phased overhaul covering visual design, animation quality, content formatting, and the new-conversation onboarding experience.

---

## Phase 1 — Desktop: Visual & Layout Revamp

### Checklist
- [x] 1.1 Chat window top treatment (extra padding + blurred horizontal lines above first message)
- [x] 1.2 LLM response layout — full-width, no bubble
- [x] 1.3 Rich content formatting (code, tables, blockquotes, math)
- [x] 1.4 Streaming animation — constant drain rate, no catch-up
- [x] 1.5 Thinking block & tool call — auto-expand while live
- [x] 1.6 General animation polish (message entrance, skeleton shimmer, memoization)

---

### 1.1 Chat Window Top Treatment
**Files:** `src/renderer/components/chat/ChatMessages.tsx`, `src/renderer/styles/global.css`

At the very top of the chat column, before the first user message, render a decorative "conversation start" element:
- Extra vertical padding (~32–40px) acting as breathing room
- Two thin horizontal lines (1px, full-width) separated by ~8px of space
- A vertical blur/fade mask applied to this zone so the lines softly dissolve into the background — implemented with a gradient mask using `mask-image: linear-gradient(to bottom, transparent, black 60%)` on a pseudo-element
- Subtle, not prominent — the effect signals "this is the start" without distracting from the conversation
- This element only renders once, above the first message in the list
- Desktop: a `ChatStartDivider` component inserted at the top of the message array render in `ChatMessages.tsx`

### 1.2 LLM Response Layout
**Files:** `src/renderer/components/chat/ChatMessages.tsx`, `src/renderer/components/MessageBubble.tsx`

- Remove the bubble container (rounded card, max-w constraint) for `role === 'assistant'` messages
- Assistant content fills the full column width — no `max-w-*`, no `bg-*` bubble background
- User messages retain a right-aligned bubble (existing pill style, possibly refined)
- Model label and timestamp shift to a subtle line below the content rather than inside a bubble header
- Add a thin left-border accent line (e.g., `border-l-2 border-gray-200 dark:border-gray-700`) as a minimal visual separator for assistant turns

### 1.3 Rich Content Formatting
**Files:** `src/renderer/components/MessageBubble.tsx`, `src/renderer/styles/global.css`, `tailwind.config.js`

Content type → display rules:
- **Code blocks:** Syntax-highlighted, full-width, with a language badge, line numbers, and a one-click copy button. Currently uses Catppuccin Mocha — keep and enhance.
- **Tables:** Render with horizontal scroll wrapper, alternating row shading, sticky first column where sensible.
- **Numbered/bulleted lists:** Generous line-height, subtle indent guides.
- **Inline code:** Pill-shaped with a distinct mono background.
- **Blockquotes:** Left-border accent in muted color, italic text.
- **Math (LaTeX):** Add KaTeX rendering via the `katex` package if not already handled.
- Applied via Tailwind `prose` class extensions in `tailwind.config.js` and overrides in `global.css`.

### 1.4 Streaming Animation — No Catch-Up
**Files:** `src/renderer/hooks/useChat.ts`, `src/renderer/hooks/useStreamingQueue.ts` (new), `src/renderer/components/MessageBubble.tsx`, `src/renderer/components/chat/ChatMessages.tsx`

Current: tokens appended directly to `streamingContent` on every IPC chunk; MarkdownRenderer re-renders the whole string each time.

Plan:
- New `useStreamingQueue` hook: IPC chunks go into a FIFO buffer; a `requestAnimationFrame` loop drains at a fixed character rate (~60 chars/frame). The hook exposes `displayedContent` and `isQueueEmpty`.
- When the stream ends (chunk === null), the remaining buffer drains at the same rate — no instant flush.
- `useChat.ts` adopts the hook; `ChatMessages.tsx` reads `displayedContent` instead of `streamingContent` directly.
- Replace the blinking block cursor (`▊ animate-pulse`) with a subtle fade-in on the last word.

### 1.5 Thinking Block & Tool Call — Auto-Expand While Live
**Files:** `src/renderer/components/chat/ThinkingBlock.tsx`, `src/renderer/components/chat/ToolCallBlock.tsx`

Current: both blocks are collapsed by default; no auto-expansion during live execution.

Plan:
- When `done === false` (thinking) or `inProgress === true` (tool call): automatically expand the block so the user sees live content without clicking.
- When the block completes: keep expanded for 2 seconds, then auto-collapse to the compact summary line.
- If the user manually collapses a live block, track with a `userCollapsed` ref — do not re-expand that block.
- Animate expand/collapse with a CSS `max-height` transition (`transition-[max-height] duration-300 ease-in-out`).

### 1.6 General Animation Polish
**Files:** `src/renderer/components/chat/ChatMessages.tsx`, `src/renderer/components/MessageBubble.tsx`, `src/renderer/styles/global.css`

- New assistant message entrance: fade-in + 8px upward slide (`translateY(8px) → translateY(0)`, opacity 0→1, ~200ms ease-out). Add `@keyframes message-enter` to `global.css`.
- Skeleton loading: gradient-sweep shimmer instead of flat `animate-pulse`.
- Auto-scroll guard: only auto-scroll during streaming when the user is already near the bottom.
- Memoize unchanged message rows with `React.memo` to prevent layout jank during streaming re-renders.

---

## Phase 2 — Android: Visual & Layout Revamp

### Checklist
- [x] 2.1 Chat window top treatment (extra padding + blurred horizontal lines above first message)
- [x] 2.2 LLM response layout — full-width, no bubble
- [x] 2.3 Rich content formatting (Markwon plugins: syntax highlight, tables)
- [x] 2.4 Streaming animation — constant drain rate coroutine, no catch-up
- [x] 2.5 Thinking block & tool call — auto-expand while live
- [x] 2.6 New conversation entrance animation (FAB → screen transition, sequenced empty state)
- [x] 2.7 General animation polish (animateItemPlacement, crossfade icons, scroll guard)

---

### 2.1 Chat Window Top Treatment
**Files:** `android/app/src/main/java/io/nexy/android/ui/chat/ChatScreen.kt`, `ChatScreenBubbles.kt`

- At the top of the `LazyColumn`, as the first `item {}`, render a `ChatStartHeader` composable:
  - Extra top padding (32dp)
  - Two `Divider()` composables (1dp height, full width) with 8dp between them, in a muted color (`MaterialTheme.colorScheme.outlineVariant` at low alpha)
  - A vertical fade applied by wrapping the header in a `Box` with a `Modifier.drawWithContent` or `graphicsLayer` that applies a gradient alpha mask from transparent at the top to opaque at the bottom
- This composable renders only once, above all messages

### 2.2 LLM Response Layout
**Files:** `android/app/src/main/java/io/nexy/android/ui/chat/ChatScreenBubbles.kt`, `ChatScreen.kt`

- In `MessageBubble()`, when `message.role == "assistant"`: remove the `Surface` bubble container, let content fill the column width with no background card.
- User messages: retain `Surface` bubble, right-aligned, refined corner radii.
- Model label / timestamp shown below assistant content as small muted `Text`.
- Increase `verticalArrangement` in `LazyColumn` to 12dp.

### 2.3 Rich Content Formatting
**Files:** `ChatScreenBubbles.kt`, Markwon initialization (DI module or utility)

- Add Markwon plugins: `SyntaxHighlightPlugin` (Prism4j or similar), `TablePlugin`, `LinkifyPlugin`
- Code blocks: monospace font, dark background card, language label, copy button
- Tables: horizontal scroll if overflow
- Inline code: distinct background span

### 2.4 Streaming Animation — No Catch-Up
**Files:** `android/app/src/main/java/io/nexy/android/ui/chat/ChatViewModel.kt`

Current: `WsEvent.ChatStreamChunk` directly updates `_messages` StateFlow on every chunk.

Plan:
- In `ChatViewModel`, add a `streamBuffer = Channel<String>(UNLIMITED)` and a drain coroutine (launched in `viewModelScope`) that reads from the channel and writes to `_messages` at a fixed character rate.
- WS chunk events send to the channel, not directly to `_messages`.
- When stream ends: drain remaining buffer at the same rate, then set `isStreaming = false`.

### 2.5 Thinking Block & Tool Call — Auto-Expand While Live
**Files:** `ChatScreenBubbles.kt`, `ChatViewModel.kt`

- `ThinkingHistoryBubble()`: auto-expand when the block is the most recent and `done == false`; auto-collapse 2 seconds after `done == true`.
- `ToolCallBubble()`: auto-expand when `inProgress`, collapse when complete.
- Replace bare `expandVertically()` with combined `expandVertically() + fadeIn()` spec in `AnimatedVisibility`.
- Track user-collapsed override with `remember { mutableStateOf(false) }` per block.

### 2.6 New Conversation Entrance Animation
**Files:** `android/app/src/main/java/io/nexy/android/ui/home/HomeScreen.kt`, `android/app/src/main/java/io/nexy/android/ui/chat/ChatScreen.kt`

Current: FAB → ModalBottomSheet → navigate to static empty chat screen with no animation.

Plan:
- **Screen enter transition**: crossfade or slide-up from sheet position using Compose Navigation's `AnimatedContent` transition spec on the nav graph entry.
- **Empty state entrance** (sequenced, using `LaunchedEffect` + `animateFloatAsState`):
  1. Icon/logo fades in (0ms delay, 300ms duration)
  2. Greeting text slides up from +16dp (300ms delay, 250ms duration)
  3. Input bar rises from bottom (450ms delay, 250ms duration)
- **First message send**: empty state elements animate out (fade + slide up) as the first message bubble fades/slides in from the bottom.
- State trigger: `messages.isEmpty()` → `messages.size == 1` transition in the `ChatViewModel`.

### 2.7 General Animation Polish
**Files:** `ChatScreen.kt`, `ChatScreenBubbles.kt`

- Add `Modifier.animateItemPlacement()` to each message item in the `LazyColumn` so new messages slide into position instead of snapping.
- `ThinkingBubble` typing dots: increase dot size to 8dp; replace alpha-only animation with `Spring`-based scale + alpha for a more physical feel.
- `ToolCallBubble` status icon: `Crossfade(targetState = inProgress)` between the spinner and the result icon (CheckCircle / Error).
- Scroll guard: only `animateScrollToItem` when the user is within 2 items of the bottom.

---

## Phase 3 — Shared / Cross-Platform Polish

### Checklist
- [x] 3.1 Design tokens agreed and documented
- [x] 3.2 Content type detection utility (`src/shared/content-classifier.ts`)

---

### 3.1 Design Tokens

| Token | Value |
|---|---|
| Entrance duration | 200ms |
| Expand/collapse duration | 300ms |
| Auto-collapse delay | 2000ms |
| Entrance easing | ease-out |
| Expand/collapse easing | ease-in-out |
| Assistant content padding | 0 (full-width) |
| User bubble max-width | 80% |
| Stream drain rate | ~60 chars/frame |
| Auto-scroll guard | within 2 items of bottom |

### 3.2 Content Type Detection Utility
**File:** `src/shared/content-classifier.ts` (new)

A lightweight classifier that inspects LLM response text and returns hints: `hasCode`, `hasTable`, `hasMath`, `dominantType`. Used by `MessageBubble.tsx` (desktop) and mirrored in Android's Markwon config to apply the right rendering path early.

---

## Critical Files

### Desktop
| File | Change |
|---|---|
| `src/renderer/components/chat/ChatMessages.tsx` | `ChatStartDivider`, message entrance, auto-scroll guard, memoization |
| `src/renderer/components/MessageBubble.tsx` | Remove assistant bubble, full-width layout, rich content |
| `src/renderer/components/chat/ThinkingBlock.tsx` | Auto-expand logic, max-height transition |
| `src/renderer/components/chat/ToolCallBlock.tsx` | Auto-expand logic, crossfade icon |
| `src/renderer/hooks/useChat.ts` | Adopt `useStreamingQueue` |
| `src/renderer/hooks/useStreamingQueue.ts` | New hook — token drain queue |
| `src/renderer/styles/global.css` | `@keyframes message-enter`, shimmer, `ChatStartDivider` styles |
| `tailwind.config.js` | Extended prose config, custom keyframes |

### Android
| File | Change |
|---|---|
| `android/.../ui/chat/ChatScreenBubbles.kt` | Full-width assistant layout, `ChatStartHeader`, auto-expand, crossfades |
| `android/.../ui/chat/ChatScreen.kt` | `ChatStartHeader` as first item, `animateItemPlacement`, scroll guard |
| `android/.../ui/chat/ChatViewModel.kt` | Stream buffer/drain coroutine |
| `android/.../ui/home/HomeScreen.kt` | New conversation entrance animation |

---

## Verification

1. **Chat start treatment**: Open any existing conversation and a new empty one — confirm the blurred horizontal lines and padding appear above the first message on both desktop and Android.
2. **Streaming rate**: Start a long response; visually confirm tokens appear at a steady, readable rate — not slow then sprinting. Stop generation mid-stream and confirm the queue drains at the same rate.
3. **Auto-expand**: Trigger a response that uses tool calls and/or thinking. Confirm blocks expand automatically on start, stay open, then collapse 2 seconds after completion. Manually collapse a live block and confirm it stays collapsed.
4. **Full-width layout**: Confirm assistant messages span the full content column on both platforms; user messages remain in right-aligned bubbles.
5. **New conversation (Android)**: Create a new chat and observe the sequenced entrance (icon → text → input bar); send the first message and observe the transition out of the empty state.
6. **No regressions**: Run `npm test` after desktop changes. Manually verify user message bubbles, error states, team-activity blocks, thinking history, and the sticky request-reference header.
7. **Performance**: In Electron DevTools, confirm no dropped frames during streaming (target 60fps). On Android, use the Compose layout inspector to confirm `animateItemPlacement` does not cause excessive recomposition.
