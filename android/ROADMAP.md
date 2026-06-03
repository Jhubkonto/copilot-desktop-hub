# Nexy Android — Roadmap

Last updated: 2026-06-02

---

## v0.1 — Initial Release (current)

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

## v0.2 — Bug Fixes (next)

Critical bugs identified during live testing:

| # | Bug | File | Fix |
|---|-----|------|-----|
| 1 | **Empty assistant bubbles** — desktop sends `chunk` field in `chat:stream-chunk`, but Android reads `text` | `data/WsRepository.kt:128` | Change `optString("text")` → `optString("chunk")` |
| 2 | **Wrong text color in assistant bubbles** — `textColor.hashCode()` is not an ARGB int | `ui/chat/ChatScreen.kt:151` | Change to `textColor.toArgb()` |
| 3 | **No message history on open** — opening an existing conversation shows nothing; no history-fetch command is sent | `ui/chat/ChatViewModel.kt` | Send `conversation:get-messages` on init; desktop needs to handle this command and stream back message history |
| 4 | **Sent message not echoed to phone** — phone sends a message, user message doesn't appear in the phone chat list | `ui/chat/ChatViewModel.kt` | Optimistically add user message to local list immediately on send, before waiting for any server acknowledgement |

**Desktop-side fix also needed for bug #3:**
- Add `conversation:get-messages` handler in `src/main/ws-handlers.ts` that queries the DB and pushes a `conversation:messages` event back to the requesting client

---

## v0.3 — Conversation UX

- **Conversation title in TopAppBar** — chat screen shows "Chat" instead of the actual conversation title; pass title through navigation or fetch it from the list
- **Conversation metadata in list** — show agent name and relative timestamp (e.g. "Codex · 4h ago") alongside each conversation title; requires desktop to include agent display names in `conversation:list` payload or a separate `agent:list` event
- **Relative timestamps** — format `created_at` / `updated_at` as "just now", "4h ago", etc.
- **Last message preview** — show a snippet of the last message under the title (requires desktop to include it in the list payload)

---

## v0.4 — New Conversations

- **New Chat button** on HomeScreen → opens a blank ChatScreen
- **Agent picker** — allow selecting which agent to use when starting a new conversation (requires `agent:list` event from desktop)
- **Conversation creation** — send `conversation:create` command with chosen agent; desktop creates the conversation and returns the new `conversationId`

---

## v0.5 — Persistence & Settings

- **Remember last server URL** — store the last successfully connected URL in SharedPreferences / DataStore; auto-attempt reconnect on app launch
- **Settings screen** — show current server URL, connected/disconnected state, disconnect button, token info
- **Reconnect on resume** — when app comes to foreground after being backgrounded, attempt to reconnect if disconnected

---

## v0.6 — Tool Approval Polish

- **Test end-to-end approval flow** — trigger a tool call from desktop, verify dialog appears on phone with correct tool name and args
- **Background notification test** — background the app, trigger tool call, verify heads-up notification fires with Approve/Reject actions
- **Haptics** — verify 50ms (approve) and 100ms (reject) vibration patterns on device

---

## Backlog (larger scope)

- **Image/file attachments** — send images from phone gallery to desktop chat
- **Push notifications** — replace heads-up notification with proper FCM push for when phone is truly backgrounded / screen off
- **Multiple server profiles** — save and switch between multiple desktop connections
- **Dark/light theme toggle** — currently follows system theme; add in-app override
- **wss:// support** — TLS WebSocket for remote/Tailscale access without cleartext workaround

---

## Protocol additions needed from desktop

| Command (Android → Desktop) | Purpose |
|-----------------------------|---------|
| `conversation:get-messages` | Fetch message history for a conversation on open |
| `conversation:create` | Create a new conversation with optional agentId |
| `agent:list` | Get list of agents with display names for picker |

| Event (Desktop → Android) | Purpose |
|---------------------------|---------|
| `conversation:messages` | Response to `get-messages`; array of `{role, content, timestamp}` |
| `conversation:created` | Confirmation of new conversation with its UUID |
| `agent:list` | Array of `{id, name, description}` |
| `chat:message-echo` | Echo user message back to confirm persistence (or include in `conversation:messages`) |
