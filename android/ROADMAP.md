# Nexy Android — Roadmap

Last updated: 2026-06-10

---

## v0.1 — Initial Release ✅

**What works:**
- QR code pairing with desktop app
- Manual URL entry fallback
- WebSocket connection with LAN IP detection (prefers 192.168.x.x over WSL2 / Tailscale)
- Conversation list from desktop
- Sending messages from phone (received and processed on desktop)
- Stream response arriving on phone (data pathway confirmed)
- Tool approval dialog (UI built, not yet tested end-to-end)
- Heads-up notification for background approval requests

---

## v0.2 — Bug Fixes ✅

Critical bugs identified during live testing:

| # | Bug | File | Fix | Status |
|---|-----|------|-----|--------|
| 1 | **Empty assistant bubbles** — desktop sends `chunk` field in `chat:stream-chunk`, but Android reads `text` | `data/WsRepository.kt:128` | Change `optString("text")` → `optString("chunk")` | ✅ |
| 2 | **Wrong text color in assistant bubbles** — `textColor.hashCode()` is not an ARGB int | `ui/chat/ChatScreen.kt:151` | Change to `textColor.toArgb()` | ✅ |
| 3 | **No message history on open** — opening an existing conversation shows nothing; no history-fetch command is sent | `ui/chat/ChatViewModel.kt` | Send `conversation:get-messages` on init; desktop needs to handle this command and stream back message history | ✅ |
| 4 | **Sent message not echoed to phone** — phone sends a message, user message doesn't appear in the phone chat list | `ui/chat/ChatViewModel.kt` | Optimistically add user message to local list immediately on send, before waiting for any server acknowledgement | ✅ |

**Desktop-side fix also needed for bug #3:**
- ✅ Add `conversation:get-messages` handler in `src/main/ws-handlers.ts` that queries the DB and pushes a `conversation:messages` event back to the requesting client

---

## v0.3 — Conversation UX ✅

- ✅ **Conversation title in TopAppBar** — chat screen shows the conversation title when present
- ✅ **Conversation metadata in list** — show agent/project metadata alongside each conversation title
- ✅ **Relative timestamps** — format `updated_at` as "just now", "4h ago", etc.
- ✅ **Last message preview** — show a snippet of the last message under the title

---

## v0.4 — New Conversations ✅

- ✅ **New Chat button** on HomeScreen → opens the new-chat sheet
- ✅ **Agent picker** — allow selecting which agent to use when starting a new conversation
- ✅ **Project picker** — allow starting a new conversation scoped to a project
- ✅ **Conversation creation** — send `conversation:create`; desktop creates the conversation and returns the new `conversationId`

---

## v0.5 — Persistence & Settings ✅

- ✅ **Remember last server URL** — auto-attempt reconnect on app launch
- ✅ **Settings screen** — show current server endpoint, connected/disconnected state, disconnect button
- ✅ **Secure pairing storage** — store endpoint and token separately in encrypted preferences; migrate legacy plaintext URL storage
- ✅ **Reconnect on resume validation** — explicitly tested foreground resume after network/process interruptions

---

## v0.6 — Tool Approval Polish ✅

- ✅ **Notification permission handling** — request `POST_NOTIFICATIONS` on Android 13+ and skip posting if denied
- ✅ **Haptics** — 50ms approve and 100ms reject vibration patterns
- ✅ **Test end-to-end approval flow** — triggered a tool call from desktop; verified dialog appears on phone with correct tool name and args
- ✅ **Background notification test** — backgrounded the app, triggered tool call, verified heads-up notification fires with Approve/Reject actions

---

## v0.7 — Protocol & Test Hardening ✅

- ✅ **Targeted desktop replies** — request/response commands reply only to the requesting mobile client
- ✅ **Android unit tests** — URL parsing, history loading, stream handling, optimistic send, stop command, and approval event handling covered
- ✅ **Desktop WebSocket tests** — cover targeted request replies
- ✅ **Manual device test checklist** — pairing, reconnect, chat send/stream, attachments, approval dialog, notification actions

---

## v0.8 — Chat Feedback 🔶

- ✅ **Assistant thinking state** — show an animated "Assistant is thinking" bubble after sending from Android and before the first response chunk arrives
- ✅ **Busy-state stop action** — keep Stop available while awaiting the first assistant chunk and during active streaming
- ✅ **Desktop activity events** — stream richer status such as "preparing context", "contacting model", "running command", or "waiting for approval" from desktop to Android

---

## v0.9 — Android Chat Parity 🔶

- ✅ **Draft chats** — opening a new Android chat no longer creates an empty desktop conversation before the first message is sent
- ✅ **Draft context** — selected agent/project metadata is sent with the first Android message so desktop can create the conversation with the intended context
- ✅ **New-chat empty state** — Android chat windows show useful starter content before the first message
- ✅ **Message actions** — long-press message bubbles to copy, edit, or resend user messages
- ✅ **Pull-down refresh** — swipe down in chat, conversation list, projects, or agents to refresh
- ✅ **Chromium/Playwright MCP diagnostic** — desktop now reconnects assigned MCP servers before tool discovery and fails loudly when no tools are available

---

## Desktop Context Compression ✅

- ✅ **CCMP.1 Rolling compression** — long conversations can persist a rolling deterministic summary plus recent turns
- ✅ **CCMP.2 Structured summaries** — compression summaries preserve goals, decisions, constraints, files, commands, questions, next actions, and recent notes
- ❌ **CCMP.3 Memory promotion** — removed to avoid duplicating project wiki, agent memory, prompt library, and project instructions
- ✅ **CCMP.4 Context inspector preview** — context inspector shows summarized, retained, and omitted message counts plus summary sections
- ✅ **CCMP.5 Manual compress now** — context inspector can prepare an editable structured summary and save it into the rolling summary store
- ✅ **CCMP.6 Provider-aware compression targets** — `resolveContextWindow()` looks up the active model in the catalog DB snapshot and falls back to per-family heuristics (Claude 200k, GPT-4/5 128k, local 16k); `targetBudget` is sized as 55% of the resolved context window, giving a 12k budget for large models and a 4k floor for small ones
- ✅ **CCMP.7 Restore path wiki injection** — after rolling compression, relevant project wiki entries are appended to the summary message so the model has current reference material alongside the compressed history

---

## Desktop UI Reuse 🔶

- ✅ **UIR.1 Shared primitives** — added reusable modal shell, action button, stat card, and info row primitives
- ✅ **UIR.2 Context inspector migration** — replaced local modal, stat card, and info row implementations with shared primitives
- ✅ **UIR.3 Prompt library shell migration** — moved prompt library modal shell and primary/footer actions onto shared primitives
- ✅ **UIR.4 Broader modal cleanup** — Settings, delete dialogs, Save to Wiki, Wiki Extraction, and MCP panel migrated; Onboarding intentionally keeps its no-close flow for now
- ✅ **UIR.5 Shared form fields and tabs** — text field, textarea, select, and segmented tab primitives added; Prompt Library, Context Inspector, and Settings prompt editor migrated

---

## Backlog (larger scope)

- **Reusable desktop UI components** — continue refactoring repeated modal shells, headers, buttons, stat cards, tabs, and form fields into shared Tailwind components to reduce duplicate code and keep future UI polish consistent
- **Image/file attachments** — send images from phone gallery to desktop chat
- **Push notifications** — replace heads-up notification with proper FCM push for when phone is truly backgrounded / screen off
- **Multiple server profiles** — save and switch between multiple desktop connections
- **Dark/light theme toggle** — currently follows system theme; add in-app override
- **wss:// support** — TLS WebSocket for remote/Tailscale access without cleartext workaround
- **Desktop-served Android updates** — Android checks the paired desktop for update metadata, then opens the system package installer or internal distribution link for approved updates

---

## Future — Build, Run, and Update Integration 🔲

Goal: support the workflow where Nexy changes its own source workspace, desktop builds both apps, and installed desktop/Android apps can consume those builds as explicit user-approved updates.

**Android constraints:**
- Android cannot silently patch its installed APK from inside the app.
- Updates must use the system package installer, ADB for developer devices, or an app-store/internal distribution channel.
- Release artifacts must be signed and versionCode must increase.

| Task | Description | Status |
|---|---|---|
| AU.1 | Desktop build action creates debug/release Android artifacts and records versionCode, commit SHA, checksum, and build status | 🔲 |
| AU.2 | Android update manifest served by paired desktop over the existing trusted connection | 🔲 |
| AU.3 | Android Settings screen shows available update, version notes, checksum, and source desktop | 🔲 |
| AU.4 | Tap "Install update" downloads the APK and opens Android's system package installer with clear user confirmation | 🔲 |
| AU.5 | ADB install path for developer testing when the phone is connected to the desktop and the user explicitly approves | 🔲 |
| AU.6 | Production/internal distribution path documented: Play Internal App Sharing, internal testing track, or private signed APK distribution | 🔲 |
| AU.7 | Rollback guidance: retain previous APK artifact and expose reinstall instructions/action where platform rules allow it | 🔲 |

---

## Protocol additions needed from desktop

| Command (Android → Desktop) | Purpose | Status |
|-----------------------------|---------|--------|
| `conversation:get-messages` | Fetch message history for a conversation on open | ✅ |
| `conversation:create` | Create a new conversation with optional agentId/projectId | ✅ |
| `agent:list` | Get list of agents with display names for picker | ✅ |
| `project:list` | Get list of projects for filtering and new-chat scoping | ✅ |

| Event (Desktop → Android) | Purpose | Status |
|---------------------------|---------|--------|
| `conversation:messages` | Response to `get-messages`; array of `{role, content, timestamp}` | ✅ |
| `conversation:created` | Confirmation of new conversation with its UUID | ✅ |
| `agent:list` | Array of `{id, name, icon}` | ✅ |
| `project:list` | Array of `{id, name, color, chat_count, agent_icons}` | ✅ |
| `chat:message-echo` | Echo user message back to confirm persistence (or include in `conversation:messages`) | Deferred — optimistic local echo is used |
