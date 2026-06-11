# Nexy — Active Roadmap

Last updated: 2026-06-11 (v0.14 complete; desktop release readiness in progress)

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
- ✅ **Android unit tests** — `ChatViewModelTest` covers history loading, stream handling, optimistic send, stop command, activity events, attachment sends, and draft context; `HomeViewModelTest` covers approval handling
- ✅ **Desktop WebSocket tests** — cover targeted request replies
- ✅ **Manual device test checklist** — pairing, reconnect, chat send/stream, attachments, approval dialog, notification actions

---

## v0.8 — Chat Feedback ✅

- ✅ **Assistant thinking state** — show an animated "Assistant is thinking" bubble after sending from Android and before the first response chunk arrives
- ✅ **Busy-state stop action** — keep Stop available while awaiting the first assistant chunk and during active streaming (currently only shown during active streaming, not during pre-stream wait)
- ✅ **Desktop activity events** — desktop emits "preparing context", "contacting model", "running command", and "waiting for approval" status events to connected mobile clients
- ✅ **Android activity display** — Android receives and surfaces desktop activity status in the chat UI

---

## v0.9 — Android Chat Parity ✅

- ✅ **Draft chats** — opening a new Android chat no longer creates an empty desktop conversation before the first message is sent (currently creates conversation immediately on new-chat button press)
- ✅ **Draft context** — selected agent/project metadata is sent with the first Android message so desktop can create the conversation with the intended context
- ✅ **New-chat empty state** — Android chat windows show useful starter content before the first message
- ✅ **Message actions** — long-press message bubbles to copy, edit, or resend user messages
- ✅ **Pull-down refresh** — swipe down in conversation list, projects, or agents to refresh
- ✅ **Chromium/Playwright MCP diagnostic** — desktop now reconnects assigned MCP servers before tool discovery and fails loudly when no tools are available

---

## v0.10 — Android Attachments ✅

- ✅ **ATT.1 Android picker and pending chips** — verified Android can select files/images, show removable pending attachment chips, and allow attachment-only sends
- ✅ **ATT.2 Image payloads from phone gallery** — verified Android converts selected images to data URLs and sends them as `images` on `chat:send-message`
- ✅ **ATT.3 Desktop WebSocket forwarding** — verified desktop accepts mobile image payloads and forwards them to `dispatchChatSend`
- ✅ **ATT.4 Live desktop echo for mobile images** — desktop `chat:remote-message` now includes mobile image data so the open desktop chat can display the sent image
- ✅ **ATT.5 Desktop coverage** — desktop WebSocket tests cover mobile image forwarding
- ✅ **ATT.5 Android coverage** — `ChatViewModelTest.sendMessageIncludesImageAttachments()` covers image attachment sends end-to-end
- ✅ **ATT.6 Persisted attachment metadata after history reload** — mobile image sends now store lightweight attachment metadata in message history and Android restores attachment names after refresh without persisting base64 image data
- 🔲 **ATT.7 Full persisted image previews** — optional follow-up if thumbnail persistence is worth the DB/storage tradeoff

---

## v0.11 — Server Profiles ✅

- ✅ **SP.1 Profile-capable secure pairing store** — `PairedServerProfile` store with multiple endpoint/token pairs, active profile tracking, and migration from single-server installs
- ✅ **SP.2 Pairing saves profiles** — QR/manual pairing adds or updates a profile and makes it active through the existing connection success path
- ✅ **SP.3 Settings profile switcher** — Settings Connection section lists all saved servers with active status badge and a Use button to switch without re-pairing
- ✅ **SP.4 Forget active profile** — disconnect/forget falls back to another saved profile when available
- ✅ **SP.5 Unit coverage** — `PairedServerConfigTest` covers deterministic profile IDs, display names, and profile conversion
- ✅ **SP.6 Delete inactive profiles** — Settings shows a Delete button for each inactive profile without affecting the active connection

---

## v0.12 — Android Start Dashboard ✅

- ✅ **SD.1 First-run start screen** — `PairingStartScreen` routes disconnected users to a calm setup dashboard with header and connection instructions
- ✅ **SD.2 Explicit pairing actions** — Scan QR Code and Enter URL Manually buttons on the start screen
- ✅ **SD.3 Saved profile quick connect** — start screen shows all saved server profiles with a Connect button to reconnect without re-pairing
- ✅ **SD.4 Pairing route split** — `pairing/scan` and `pairing/manual` are focused screens behind explicit navigation from the start screen
- ✅ **SD.5 Verification** — NavGraph routes to `PairingStartScreen` as the disconnected landing; existing pairing config tests pass

---

## v0.13 — Secure WebSocket Connections 🔶

- ✅ **WSS.1 Android URL parsing** — Android accepts `wss://...?...token=...` pairing URLs and stores them as secure server profiles
- ✅ **WSS.2 Desktop secure pairing URL** — desktop Mobile settings can store an optional external `wss://` URL and use it for QR pairing
- ✅ **WSS.3 Token injection** — QR generation injects the current pairing token into the configured secure URL, replacing stale tokens
- ✅ **WSS.4 LAN fallback** — leaving the secure URL blank keeps local `ws://<lan-ip>:<port>` pairing behavior unchanged
- ✅ **WSS.5 Setup documentation** — documented local LAN behavior versus TLS/Tailscale/reverse-proxy behavior
- 🔲 **WSS.6 Native TLS listener** — optional future work if in-app certificate/key management becomes worth the complexity

---

## v0.14 — Android Model & Settings Parity ✅

- ✅ **MSP.1 Desktop model source metadata** — desktop `model:list` WS response includes a `source` object with type, label, and backend fields
- ✅ **MSP.1 Android model source display** — Android receives and displays model source in the chat model picker
- ✅ **MSP.2 Mobile settings audit** — compared Android Settings against Desktop Settings and folded follow-up controls into this roadmap
- ✅ **MSP.3 Model backend diagnostics** — Settings Models section shows source title, backend detail, available model preview with count, and empty-backend guidance via `modelSourceTitle`/`modelSourceDetail`/`emptyModelListDetail`
- ✅ **MSP.4 Notification controls** — Settings Notifications section shows approval readiness, runtime permission state, app notification state, Tool Approvals channel state, Refresh, and Open Android settings
- ✅ **MSP.5 Appearance controls** — Settings Appearance section has a persisted System/Light/Dark theme override via `ThemePreference`
- ✅ **MSP.6 Connection diagnostics** — Settings Diagnostics section shows active profile, endpoint, URL scheme, connection state, client version, server version, and last error
- ✅ **MSP.7 Settings polish pass** — Settings organized into Connection, Models, Notifications, Appearance, Updates, Diagnostics, and Actions sections with consistent `SettingsSectionHeader` chrome

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

## Desktop UI Reuse ✅

- ✅ **UIR.1 Shared primitives** — added reusable modal shell, action button, stat card, and info row primitives
- ✅ **UIR.2 Context inspector migration** — replaced local modal, stat card, and info row implementations with shared primitives
- ✅ **UIR.3 Prompt library shell migration** — moved prompt library modal shell and primary/footer actions onto shared primitives
- ✅ **UIR.4 Broader modal cleanup** — Settings, delete dialogs, Save to Wiki, Wiki Extraction, and MCP panel migrated; Onboarding intentionally keeps its no-close flow for now
- ✅ **UIR.5 Shared form fields and tabs** — text field, textarea, select, and segmented tab primitives added; Prompt Library, Context Inspector, and Settings prompt editor migrated

---

## Backlog (larger scope)

- **Persisted mobile image thumbnails** — optional thumbnail cache for history reloads if attachment-name chips are not enough
- **Push notifications** — replace heads-up notification with proper FCM push for when phone is truly backgrounded / screen off
- **Android in-app theme override** — Android currently follows the system theme; add a persisted in-app System/Light/Dark override (desktop already has this)

---

## Future — Build, Run, and Update Integration 🔲

Goal: support the workflow where Nexy changes its own source workspace, desktop builds both apps, and installed desktop/Android apps can consume those builds as explicit user-approved updates.

**Android constraints:**
- Android cannot silently patch its installed APK from inside the app.
- Updates must use the system package installer, ADB for developer devices, or an app-store/internal distribution channel.
- Release artifacts must be signed and versionCode must increase.

| Task | Description | Status |
|---|---|---|
| AU.1 | Desktop build action creates debug/release Android artifacts and records versionCode, commit SHA, checksum, and build status | ✅ |
| AU.2 | Android update manifest served by paired desktop over the existing trusted connection | ✅ |
| AU.3 | Android home screen shows available update banner with version, changelog, and download/install action | ✅ |
| AU.4 | Tap "Install update" downloads the APK and opens Android's system package installer with clear user confirmation | ✅ |
| AU.5 | ADB install path for developer testing when the phone is connected to the desktop and the user explicitly approves | ✅ |
| AU.6 | Production/internal distribution path documented: Play Internal App Sharing, internal testing track, or private signed APK distribution | 🔲 |
| AU.7 | Rollback guidance: retain previous APK artifact and expose reinstall instructions/action where platform rules allow it | 🔲 |

**AU.1 implementation notes:**
- Desktop Android build commands run Gradle `test`, `assembleDebug`, `assembleRelease`, and `bundleRelease` from the configured Android workspace.
- Android build records now persist desktop-observed commit SHA, branch, versionName, versionCode, build status, artifact paths, and SHA-256 checksums.
- Settings build history surfaces versionCode and checksum previews for generated Android artifacts.

**AU.2 implementation notes:**
- Desktop now serves the published Android update manifest over the authenticated mobile WebSocket command `android:update-manifest`.
- The WebSocket response mirrors the desktop manifest shape: versionCode, versionName, commit SHA, changelog, checksum, artifact URL, and published timestamp; it returns `null` when no manifest is published.
- The existing Electron IPC manifest reader and WebSocket command share the same manifest-loading helper.

**AU.3 implementation notes:**
- Android Settings requests `android:update-manifest` from the paired desktop and tracks the latest manifest in `WsRepository`.
- Settings now includes an Updates section with availability status, version/build number, commit SHA, checksum preview, source desktop, artifact URL, published time, and version notes when present.
- Update status compares the published manifest versionCode against the installed Android app versionCode.

**AU.4 implementation notes:**
- Android Settings shows "Install update" only when the paired desktop manifest advertises a newer versionCode.
- The install flow downloads the APK from the manifest artifact URL, verifies its SHA-256 checksum, and opens Android's package installer through a FileProvider URI.
- On Android 8+, the flow routes users to the per-app "install unknown apps" permission screen when required, then asks them to retry installation.

**AU.5 implementation notes:**
- Desktop Settings lists connected ADB devices and requires an explicit "Install APK" click for each developer install.
- The ADB install path selects the latest successful `assembleDebug` or `assembleRelease` APK artifact and shows the selected artifact before install.
- The main process rejects non-APK artifacts and APK paths outside the configured Android workspace before invoking `adb install -r`.

---

## Desktop/Product Follow-ups 🔲

These were retained from the old desktop planning roadmap because they are still product-relevant but not part of the current Android settings sprint.

### Unified Model Source Detection ✅

Goal: replace split CLI/provider model pickers with one grouped model picker that detects installed CLIs and configured BYOK providers together.

| Task | Description | Status |
|---|---|---|
| MS.1 | Add a `model:list-available` IPC handler that returns connected CLI/provider model groups | ✅ |
| MS.2 | Add shared `AvailableModelEntry` and `AvailableModelGroup` types plus preload bridge support | ✅ |
| MS.3 | Refactor desktop chat model picker into one grouped dropdown with source badges | ✅ |
| MS.4 | Wire selection so CLI picks can set both backend and model when needed | ✅ |
| MS.5 | Cover no-source, CLI-only, provider-only, mixed-source, and Azure-prefix cases with tests | ✅ |

### Public Release Readiness

| Area | Requirement | Status |
|---|---|---|
| Packaging | Windows installer, macOS DMG, Linux packages; auto-update via GitHub Releases (`electron-builder.yml` publish provider set to `github/Jhubkonto/nexy`) | ✅ |
| Reliability | Local crash log via `electron-log`; `uncaughtException`/`unhandledRejection` handlers write to `{userData}/logs/main.log` | ✅ |
| Accessibility | WCAG 2.1 AA audit and keyboard/navigation fixes | 🔲 |
| Performance | Baseline and p95 targets for chat composer interaction | 🔲 |
| Security | CSP hardened (production: no unsafe-eval, strict origins); all 6 window-control IPC handlers now call `validateSender()` | ✅ |
| Documentation | Public docs, privacy policy, and terms | 🔲 |

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
