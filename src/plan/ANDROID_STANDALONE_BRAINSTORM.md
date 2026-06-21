# Nexy Android — Standalone Mode Architecture Brainstorm

> **Document type:** Architecture exploration / brainstorm. Not a committed implementation plan.
> **Goal:** Think through what it would take to make Nexy Android fully standalone, with the current WebSocket connection becoming an optional "Remote Desktop Mode."
> **Based on:** Full source audit of both the Android app and the Electron desktop codebase.

---

## The Core Idea

Today the Android app is a thin UI shell. Every action — loading conversations, sending a message, creating an agent — is a JSON command sent over WebSocket to a paired Electron desktop, which does all the work and sends events back.

The transformation: the app should work *first* without a desktop. When a desktop is paired and reachable, it unlocks additional capabilities (file system tools, MCP servers, CLI adapters, build dashboards) that only make sense with a desktop present — essentially a "Remote Desktop Mode."

**Guiding principle:** Seamless standalone is the default. Remote Desktop Mode is an opt-in power feature surfaced under Settings → Connection, not a prerequisite for using the app.

---

## Current Architecture (What We're Working With)

```
Android (today)
  └── WsRepository (singleton, the entire data layer)
        ├── ConnectionState, lastError, reconnectExhausted
        ├── ~15 StateFlow caches (conversations, agents, projects, models, ...)
        └── sendOrQueue(command, data) → everything goes over WebSocket

WsEventParser (1657 lines)
  └── Receives JSON events → updates WsRepository flows + emits to SharedFlow

ViewModels
  └── Observe WsRepository flows directly (no abstraction layer)
```

Zero local persistence. Zero LLM calls from Android. Zero business logic on Android.

---

## What Needs to Happen (The Big Picture)

Four major layers need to be built or abstracted:

1. **Local Persistence** — Room database replacing the desktop SQLite
2. **LLM Provider Layer** — Android calls APIs directly (Anthropic, OpenAI, etc.)
3. **Repository Abstraction** — ViewModels decouple from WsRepository
4. **Mode Switching** — Runtime selection of local vs. remote backends

---

## Layer 1: Local Persistence (Room Database)

The desktop has a rich SQLite schema. Android needs a subset:

| Table | Purpose | Priority |
|-------|---------|---------|
| `conversations` | Chat sessions with title, agent, project, model | Must-have |
| `messages` | Message history with role, content, attachments, thinking_blocks | Must-have |
| `agents` | Agent configs (system prompt, model, tools config) | Must-have |
| `settings` | Key-value: default model, theme, API keys (encrypted) | Must-have |
| `projects` | Project grouping with name, color | Should-have |
| `project_agents` | Many-to-many link table | Should-have |
| `conversation_summaries` | Rolling compression records | Nice-to-have |
| `skills` | Reusable skill definitions | Nice-to-have |
| `prompts` | Prompt library | Nice-to-have |
| `wiki_entries` | Project knowledge | Nice-to-have |
| `artifacts` | Generated code artifacts | Nice-to-have (desktop-managed anyway) |

**Key considerations:**
- API keys must be encrypted at rest — extend the existing `PairedServerStore` AES-256 pattern or use `EncryptedSharedPreferences` (Jetpack Security)
- Schema migrations must be append-only (same discipline as desktop's `MIGRATIONS` array in `database-migrations.ts`)
- `conversation_id` and `agent_id` must be globally unique UUIDs so they don't clash if/when syncing with a desktop later
- Message `thinking_blocks` and `attachments` stored as JSON columns (matching desktop schema)

---

## Layer 2: LLM Provider Layer

The desktop's `providers.ts` is the reference implementation. It supports: Anthropic, OpenAI, Azure, OpenRouter, Gemini, Mistral, Groq, xAI.

### What Android needs to implement

**Streaming chat dispatch:**
```kotlin
fun sendMessage(
    conversationId: String,
    content: String,
    attachments: List<AttachmentMeta>,
    agent: AgentConfig,
    history: List<Message>,
): Flow<ChatEvent>
```

Where `ChatEvent` maps to the existing `WsEvent` sealed subclasses already used by the UI: `ChatStreamChunk`, `ChatStreamEnd`, `ChatActivity`, `ChatCost`, `ChatThinkingDelta`, `ChatThinkingEnd`.

**Provider implementation options:**

| Option | Trade-offs |
|--------|-----------|
| Anthropic SDK (official) | First-class streaming, thinking blocks, tool use |
| OpenAI SDK | GPT-4o, o1, o3 family; also covers OpenRouter (same API shape) |
| Raw OkHttp + SSE | Full control, no extra dependency — app already uses OkHttp for WebSocket |
| Ktor | Kotlin-native HTTP, good SSE support; larger dependency |

**Recommendation:** Raw OkHttp SSE first — the app already uses OkHttp for WebSocket. Later wrap each provider in a `LlmProvider` interface the same way the desktop does. Each provider has a different SSE format that must be normalised:
- Anthropic: `data: { type: "content_block_delta", delta: { text: "..." } }`
- OpenAI / OpenRouter: `data: { choices: [{ delta: { content: "..." } }] }`

**Context building (simplified for standalone):**
The desktop's `chat-context-builder.ts` injects: file trees, git diffs, wiki entries, MCP tool definitions. For standalone mobile, context building is much simpler:
- System prompt from agent config
- Conversation history (filtered to user/assistant roles)
- User-attached files/images (already implemented in the attachment system)
- Skip: file trees, git diffs, MCP tools (desktop-only — see breakdown below)

**Token budget / context compression:**
The desktop applies rolling compression when history exceeds a model's context window. This logic needs to move to Android eventually, but can be deferred — most mobile conversations are shorter, and modern models have 128k–200k windows.

---

## Layer 3: Repository Abstraction

This is the biggest structural change. Today ViewModels talk directly to `WsRepository`. They need to talk to interfaces instead.

### Proposed interface hierarchy

```kotlin
interface ConversationRepository {
    val conversations: StateFlow<List<Conversation>>
    suspend fun create(agentId: String?, projectId: String?): String
    suspend fun rename(id: String, title: String)
    suspend fun delete(id: String)
    suspend fun search(query: String): List<Conversation>
    suspend fun pin(id: String, pinned: Boolean)
}

interface MessageRepository {
    fun getMessages(conversationId: String): Flow<List<Message>>
    suspend fun insert(conversationId: String, role: String, content: String, ...): Message
    suspend fun delete(id: String)
    suspend fun deleteAfter(conversationId: String, messageId: String)
}

interface AgentRepository {
    val agents: StateFlow<List<Agent>>
    suspend fun getFullConfig(id: String): AgentFullConfig
    suspend fun create(config: AgentFullConfig): String
    suspend fun update(id: String, config: AgentFullConfig)
    suspend fun delete(id: String)
}

interface ChatRepository {
    fun sendMessage(request: ChatRequest): Flow<ChatEvent>
    suspend fun stop(conversationId: String)
}

interface ModelRepository {
    suspend fun listAvailable(): List<ModelOption>
}
```

### Remote vs. Local implementations

For each interface there are two implementations:

| Interface | Local implementation | Remote implementation |
|-----------|--------------------|--------------------|
| `ConversationRepository` | `LocalConversationRepository` (Room DAO) | `RemoteConversationRepository` (WsRepository delegate) |
| `MessageRepository` | `LocalMessageRepository` (Room DAO) | `RemoteMessageRepository` (WsRepository delegate) |
| `AgentRepository` | `LocalAgentRepository` (Room DAO) | `RemoteAgentRepository` (WsRepository delegate) |
| `ChatRepository` | `LocalChatRepository` (direct LLM SSE) | `RemoteChatRepository` (WsRepository delegate) |
| `ModelRepository` | `LocalModelRepository` (hard-coded catalog) | `RemoteModelRepository` (WsRepository `model:list`) |

### Dependency injection

`ChatViewModel` already accepts an optional `WsClient` constructor param — good for testing but not for real mode switching. With proper DI (Hilt or a manual factory):

```kotlin
@HiltViewModel
class ChatViewModel @Inject constructor(
    private val chat: ChatRepository,
    private val messages: MessageRepository,
    private val agents: AgentRepository,
) : ViewModel()
```

At app startup, a `RepositoryModule` decides which implementations to provide based on connection mode.

---

## Layer 4: Mode Switching

### Connection modes

```kotlin
enum class AppMode {
    STANDALONE,       // No desktop; all local + direct LLM APIs
    REMOTE_DESKTOP,   // Paired to desktop; all commands go over WebSocket
}
```

**When does the mode change?**
- Default on first install: `STANDALONE`
- User connects a desktop from Settings → Connection → mode becomes `REMOTE_DESKTOP`
- User disconnects / desktop unreachable → back to `STANDALONE`
- User can force a mode in Settings (e.g. "Always use standalone even when desktop is available")

**Hybrid mode (future consideration):**
- Chat and data go local/standalone
- Remote Desktop Mode activated only for desktop-exclusive features (MCP tools, file tools, build dashboard)
- Most powerful UX but the most complex to implement

---

## Feature Matrix: What Lives Where

| Feature | Standalone | Remote Desktop | Notes |
|---------|-----------|---------------|-------|
| Chat (send/stream/stop) | ✅ Direct LLM API | ✅ Via WebSocket | Core feature — works both ways |
| Conversation CRUD | ✅ Room DB | ✅ Via WebSocket | |
| Agent CRUD | ✅ Room DB | ✅ Via WebSocket | |
| Project CRUD | ✅ Room DB | ✅ Via WebSocket | |
| BYOK API keys | ✅ Android Keystore | ✅ Via desktop | Different storage paths |
| Model picker | ✅ Hard-coded catalog | ✅ Via `model:list` | |
| Prompt library | ✅ Room DB | ✅ Via WebSocket | |
| Skills | ✅ Room DB | ✅ Via WebSocket | |
| Wiki | ⚠️ Local only, no extraction | ✅ Via WebSocket | Extraction needs desktop git/filesystem |
| Artifacts (view) | ❌ Not available | ✅ Via WebSocket | Desktop-managed workspace |
| Artifact generator | ❌ Not available | ✅ Via WebSocket | Writes to desktop workspace |
| File read/write tools | ❌ Not available | ✅ Via WebSocket | Node.js `fs` — no Android equivalent |
| Shell execution tools | ❌ Not available | ✅ Via WebSocket | No `child_process` on Android |
| MCP tool use | ❌ Not available | ✅ Via WebSocket | Needs desktop MCP server processes |
| Tool approval dialogs | ❌ Not available | ✅ Via WebSocket | Only relevant with MCP |
| Multi-agent orchestration | ❌ Not available | ✅ Via WebSocket | Electron IPC streaming; complex session management |
| Self-heal (investigate + fix) | ❌ Not available | ✅ Via WebSocket | Needs git CLI, npm, app.relaunch() |
| Git operations | ❌ Not available | ✅ Via WebSocket | No git binary on Android |
| Build dashboard (desktop) | ❌ Not available | ✅ Via WebSocket | npm build, Electron packaging |
| Build dashboard (Android) | ❌ Not available | ✅ Via WebSocket | Gradle, ADB, signing — desktop-only |
| Local HTTP feed server | ❌ Not available | ✅ On desktop | Node.js `http` module |
| WebSocket pairing server | ❌ Not available | ✅ On desktop | Android cannot bind ports as a server |
| Push notifications (FCM) | ✅ Works standalone | ✅ Works with desktop | Already Android-native |
| Screen capture (latest screenshot) | ✅ Via MediaStore query | ✅ Via desktop | Different implementation paths |
| Context injection (file trees, git diff) | ❌ Not available | ✅ Via desktop | Desktop reads filesystem and git |
| Agent knowledge files | ⚠️ Manual file attach only | ✅ Via desktop filesystem | Desktop reads arbitrary paths |
| Thinking blocks (extended thinking) | ✅ Parse from Anthropic SSE | ✅ Via WebSocket | Different producer, same UI |
| Context compression | ⚠️ Simplified (last N messages) | ✅ Via desktop | Desktop has full model catalog |
| Generators (project/agent/skill) | ✅ Local LLM, no workspace write | ✅ Via WebSocket + workspace | Standalone version won't scaffold files |

---

## Desktop Features: Why They Cannot Run on Android

This section documents the specific technical reasons each desktop feature is impossible in standalone mode, referencing the actual implementation files.

---

### File Read / Write Tools (`src/main/tools.ts`)

**What it does:** Implements `fileRead`, `fileWrite`, `shellExec`, `webFetch` built-in tools. `shellExec` spawns child processes via Node.js `child_process.exec()` with 30-second timeouts. All require user approval via Electron IPC.

**Why impossible on Android:**
- Android has no Node.js runtime — no `fs`, no `child_process`, no `crypto` modules
- Android enforces scoped storage since API 30 — apps cannot freely traverse or write arbitrary filesystem paths
- `child_process.exec()` has no Android equivalent — the OS sandbox model prohibits spawning arbitrary shell processes
- Tool approval uses `webContents.send()` (Electron IPC) — this API simply doesn't exist outside Electron
- File paths are fundamentally different: POSIX paths on desktop vs. content URIs and SAF on Android

**What could partially work:** `webFetch` is a plain HTTP call and could be reimplemented natively using OkHttp. The other three tools have no Android equivalent.

---

### MCP Server Integration (`src/main/mcp.ts`)

**What it does:** Manages lifecycle of external MCP servers — spawns them as child processes using `StdioClientTransport` from `@modelcontextprotocol/sdk`, communicates via stdin/stdout pipes, dynamically discovers tools, executes them, and manages per-agent trust/approval policies backed by a SQLite table (`agent_mcp_tool_overrides`).

**Why impossible on Android:**
- `StdioClientTransport` is built on Node.js stdio streams — no equivalent exists on Android
- The entire MCP protocol assumes the ability to spawn arbitrary child processes and communicate via file descriptors
- The `mcp_servers` table stores executable paths, command-line args, and environment variables — all desktop-centric concepts
- The Desktop Navigator MCP server (`desktop-navigator-mcp.ts`) uses Electron's `desktopCapturer` and native window control APIs

**What could partially work:** In theory, Android could connect to an MCP server running over HTTP/SSE (the newer MCP transport). This would allow connecting to remote MCP servers but still requires someone else to be hosting them — it can't run them locally.

---

### Multi-Agent Orchestration (`src/main/orchestrator.ts`)

**What it does:** A "team leadership" pattern — a leader agent receives a task, decomposes it using a `delegate_to_agent` tool, runs specialist agents in parallel (each with their own model, system prompt, and conversation stream), then synthesizes results. Streams character-by-character via `window.webContents.send()`.

**Why not available on Android standalone:**
- Response streaming uses `window.webContents.send('chat:stream-response', chunk)` — Electron-only IPC
- Each specialist agent can have a different LLM provider. Managing multiple concurrent streaming connections and synthesizing them is complex
- Conversation tracking uses `${conversationId}:${stepId}` compound IDs — session management tied to Electron's window model
- Not impossible in principle, but the streaming/session architecture would need complete reimplementation for Android

**Note:** Single-agent chat works fine in standalone. This is specifically about the multi-agent delegation/orchestration feature.

---

### Self-Heal (`src/main/self-heal.ts`, `self-heal/git-ops.ts`, `self-heal/recovery.ts`)

**What it does:** Full autonomous error investigation and recovery:
1. AI analyzes error reports and creates remediation plans
2. Generates code fixes and stages them in temp directories using `fs.copyFileSync()`
3. Executes `git` commands via `execFile('git', ['status', '--porcelain=v2', ...])` to stage/commit fixes
4. Runs `npm run package` to rebuild the app
5. Calls `app.relaunch()` and `app.exit(0)` to restart with the fixed version
6. Re-investigates to verify the fix worked

**Why completely impossible on Android:**
- No `git` binary — Android has no system git
- No filesystem write access to source code — Android sandbox prevents modifying arbitrary files
- `app.relaunch()` is an Electron API — mobile apps cannot relaunch themselves programmatically at the OS level
- `npm run package` requires Node.js, npm, and all build tooling — not present on Android
- The entire concept assumes the app is a mutable development artifact, not a distributed APK

**Verdict:** Self-heal is 100% desktop-only. It is the AI's ability to autonomously fix breaking bugs, commit changes, rebuild, and restart itself. None of this translates to Android.

---

### Chat Context Builder (`src/main/chat-context-builder.ts`)

**What it does:** Before each LLM call, injects rich context into the system prompt:
- Walks the project root directory tree using `fs.readFileSync()` / `fs.existsSync()`
- Reads agent knowledge files from arbitrary filesystem paths
- Generates file thumbnails for images via Electron's `nativeImage.createFromDataURL()`
- Reads `package.json` and other config files to understand the project structure
- Appends wiki entries, project instructions, tool definitions
- Truncates large files to fit token limits

**Why mostly impossible on Android:**
- No recursive filesystem traversal — Android scoped storage doesn't allow walking arbitrary directories
- Agent knowledge files live at desktop filesystem paths — inaccessible from Android
- `nativeImage` is Electron-only — Android uses `BitmapFactory` or Compose `ImageBitmap`
- No access to `package.json`, `.gitignore`, or any project config files

**What standalone context looks like instead:**
- Agent system prompt (stored in local DB)
- Conversation history (from local Room DB)
- Manually attached files/images (user-initiated, already works)
- No automatic project structure injection, no git diffs, no file tree

**Impact:** The AI operates without awareness of the user's codebase unless they manually paste or attach content.

---

### Desktop Build System (`src/main/build-handlers.ts`)

**What it does:** Spawns `npm run build`, `npm run typecheck`, `npm run package` as child processes; tracks artifacts in a `release/` directory; serves installer files via `local-feed-server.ts`; manages `latest.yml` update manifests for `electron-updater`.

**Why desktop-only:**
- Requires Node.js, npm, TypeScript compiler, and Electron builder — none present on Android
- Platform-specific build logic (`process.platform === 'win32'`, `'darwin'`, `'linux'`) targets desktop installers (.exe, .dmg, .AppImage)
- Update feeds serve via a local HTTP server (Node.js `http` module) — Android apps update via Play Store or manual APK download

---

### Android Build Handler (`src/main/android-handlers.ts`)

**What it does:** Spawns Gradle commands (`gradlew assembleDebug`, `assembleRelease`, `bundleRelease`), manages Android signing via `.jks` keystore files, uses `adb install` to push APKs to connected devices, publishes update manifests.

**Why still desktop-only (despite being "Android"):**
- Gradle requires a JDK and the full Android SDK toolchain — a developer's machine, not a phone
- ADB requires a desktop daemon to communicate with Android devices over USB/Wi-Fi
- Signing keystores are stored on the developer's machine for security reasons
- The flow is *desktop builds for Android*, not *Android builds for Android*

---

### Local Feed Server (`src/main/local-feed-server.ts`)

**What it does:** A Node.js HTTP server (port 16717, binding to `0.0.0.0`) that serves `.yml` update manifests and APK artifacts over LAN so paired Android devices can discover and download updates.

**Why impossible on Android standalone:**
- Node.js `http` module doesn't exist on Android
- Android apps cannot easily bind to arbitrary ports or serve as HTTP servers without special permissions
- The whole premise is that the desktop serves files to Android over LAN — in standalone mode there is no desktop server

---

### WebSocket Pairing Server (`src/main/ws-server.ts`)

**What it does:** Creates a Node.js HTTPS server with a dynamically generated self-signed TLS certificate (stored in SQLite), runs a WebSocket server on it, handles all Android ↔ Desktop command/event traffic, generates QR codes for pairing, and broadcasts events to connected mobile clients via `broadcastToMobile()`.

**Why it changes fundamentally in standalone mode:**
- This server only exists on the desktop — Android is the *client*, not the server
- In standalone mode there is no desktop to pair with, so the pairing server doesn't exist
- Android already initiates all connections — this doesn't change. The only change is that there's no server on the other end
- The QR pairing flow becomes irrelevant in standalone mode (there's nothing to pair with)

---

## The Sync Question

If Android has its own local database AND the desktop has its own SQLite, they will diverge. This is fine and expected — treat them as separate "workspaces" in v1:

- **Standalone conversations** = born on Android, live in Room DB, never auto-synced to desktop
- **Remote conversations** = live on desktop, Android sees them via WebSocket in Remote Desktop Mode
- A small indicator on conversation rows shows where the conversation lives (local icon vs. desktop icon)

A future sync system could use UUIDs + `updated_at` timestamps for merging, but that's a much larger project and out of scope for v1.

---

## Biggest Engineering Challenges

### 1. WsEventParser / WsRepository coupling
`WsEventParser.kt` (1657 lines) directly mutates WsRepository state flows inline — it's not just parsing, it's state management. Untangling this so state can be driven from either a Room DB or a WebSocket stream is the core structural refactor.

**Approach:** Introduce a `DataSource` interface. `WsEventParser` becomes one implementation; Room DAOs become another. `WsRepository` becomes a coordinator/facade, not the sole source of truth.

### 2. Streaming architecture parity
The desktop streams tokens via `win.webContents.send('chat:token', chunk)` → WebSocket → Android. In standalone mode, Android must stream directly from an LLM HTTP response via SSE. The `ChatViewModel` event collection loop is already well-structured — if `ChatRepository.sendMessage()` returns a `Flow<ChatEvent>` emitting the same sealed types, the UI layer needs zero changes.

### 3. API key security
Desktop uses Electron's `safeStorage` (OS keychain integration). Android equivalent: `EncryptedSharedPreferences` (Jetpack Security library) backed by Android Keystore. `PairedServerStore` already uses AES-256 — the same pattern and key alias structure can be extended for per-provider API keys.

### 4. Multi-provider SSE normalisation
Each LLM provider has a different SSE payload format. A provider abstraction layer must normalise these into the shared `Flow<ChatEvent>` type before the ViewModel sees them. This mirrors what `providers.ts` does on the desktop.

### 5. Thinking blocks from SSE
`ChatThinkingDelta` / `ChatThinkingEnd` events are produced by the desktop when Anthropic extended thinking is active. In standalone mode, Android must parse these directly from the Anthropic SSE stream (`type: "thinking"` events in the response). The rendering infrastructure already exists; it just needs a new upstream producer.

### 6. Image attachments in API requests
Currently images are base64-encoded on Android and sent over WebSocket to the desktop, which includes them in the provider request. In standalone mode, Android must include them directly in the LLM API request body:
- Anthropic: `{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "..." } }`
- OpenAI: `{ type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } }`

### 7. Model catalog
The desktop knows each model's context window via `model-catalog.ts` and uses it to size compression budgets. Android will need a local model catalog (a JSON file bundled in assets, periodically refreshed from a CDN) to make informed context window decisions. For v1, a conservative last-N-messages limit is acceptable.

### 8. Agent tool configuration in standalone
Agents have `tools: { fileEdit, terminal, webFetch }` with per-tool approval modes:
- `fileEdit` and `terminal` → meaningless in standalone (no desktop filesystem)
- `webFetch` → could work via native Android HTTP — worth implementing as a simple inline tool
- Tool approval dialogs → only needed when MCP servers are active (desktop-only)

In standalone, the agent tools UI should hide `fileEdit` and `terminal` options, or show them as "Available when connected to desktop."

---

## Open Questions (Unresolved — Product Decisions)

1. **Sync strategy:** If a user creates conversations locally and then connects to a desktop, what happens? Options: ignore (keep them separate), export/import manually, automatic UUID-based merge. This is a product decision with UX implications.

2. **Model catalog maintenance:** Hard-coded model lists go stale as providers release new models. Should the app fetch a live catalog from a CDN endpoint? Or accept that users will see outdated model names until an app update?

3. **Web fetch tool in standalone:** Should the app implement `webFetch` as a native Android HTTP call? This would make web-browsing agent use-cases work without a desktop, but adds security surface and complexity.

4. **MCP over HTTP transport:** Could Android connect to a remote MCP server hosted elsewhere (not the desktop)? The newer MCP HTTP/SSE transport would allow this. Out of scope for v1 but worth keeping in mind when designing the MCP UI.

5. **Thinking effort in standalone:** Agent config has `thinkingEffort` (`low`/`medium`/`high`). This maps to `budget_tokens` in the Anthropic API. Should this be respected in standalone mode? It increases costs noticeably.

6. **Cost visibility:** The desktop produces `ChatCost` events from provider usage metadata. Standalone mode should still surface this — Anthropic and OpenAI return `usage` in the final SSE event. The cost calculation logic needs to move to Android.

7. **FCM in standalone:** FCM currently delivers tool approval requests from the desktop. In standalone mode, tool approvals don't exist. Should FCM be used for other standalone push cases (e.g., background task notifications)?

8. **Context injection substitute:** The desktop injects file trees and git diffs. In standalone, users have no way to give the AI awareness of their codebase unless they manually paste or attach content. Is there a UX affordance that helps bridge this gap (e.g., a "Share from Files" flow that lets users attach a folder or file to the conversation context)?

9. **Generator parity in standalone:** Generators (project/agent/skill) currently write scaffolded files to the desktop workspace. In standalone mode they could still run the LLM conversation, but the "apply to workspace" step would be missing. Should the output be exportable as a ZIP? Shown as read-only?

---

## Proposed Phase Breakdown (Illustrative — Not Committed)

> Order can change. These phases exist to make the scope feel navigable, not to lock in a sequence.

### Phase α — Foundation
- Room database: conversations, messages, agents, projects, settings
- Encrypted API key storage (extend `PairedServerStore` pattern)
- `ConversationRepository`, `MessageRepository`, `AgentRepository` interfaces + Local implementations
- Wire `HomeViewModel` and `ChatViewModel` through interfaces instead of direct `WsRepository` access

### Phase β — Local LLM Chat
- OkHttp SSE client for Anthropic (primary target)
- `ChatRepository` interface + `LocalChatRepository` implementation
- Basic context building: system prompt + message history
- Streaming tokens into existing `ChatViewModel` event loop (no UI changes needed)
- Hard-coded model catalog for Anthropic + OpenAI

### Phase γ — Mode Switching Infrastructure
- `AppMode` enum + runtime selection logic
- `RepositoryModule` that provides Local or Remote implementations based on mode
- Remote implementations: thin delegates to existing `WsRepository`
- Settings screen: "Standalone" vs "Pair with Desktop" toggle
- Graceful fallback when desktop disconnects mid-session

### Phase δ — Provider Expansion
- OpenAI / OpenRouter SSE client
- Per-provider model catalog
- Thinking block parsing from Anthropic SSE
- Image attachment encoding per provider API format
- `webFetch` inline tool for standalone agents

### Phase ε — Feature Parity for Standalone
- Prompt library (local Room)
- Skills (local Room)
- Agent/Project generators running locally against direct LLM
- Wiki (local, no extraction)
- Simplified context compression (last-N-messages approach)

### Phase ζ — Desktop-Only Feature Gating
- Feature visibility flags per mode
- "Available when connected to desktop" empty states for: MCP, Self-Heal, Build Dashboard, Artifacts, file/shell tools
- Optional: Hybrid mode where local data is used but desktop tools are available when paired

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│                Android UI (Compose)              │
│  ChatScreen  HomeScreen  AgentConfig  Settings  │
└────────────────────────┬────────────────────────┘
                         │  (interfaces only — no WsRepository import)
┌────────────────────────▼────────────────────────┐
│           Repository Layer (interfaces)          │
│  ConversationRepo  AgentRepo  ChatRepo  ...     │
└──────────┬──────────────────────────────┬───────┘
           │                              │
    ┌──────▼──────┐                ┌──────▼──────┐
    │  STANDALONE │                │  REMOTE     │
    │  (default)  │                │  (optional) │
    ├─────────────┤                ├─────────────┤
    │ Room DB     │                │ WsRepository│
    │ OkHttp SSE  │                │ + WsEvent   │
    │ (LLM APIs)  │                │   Parser    │
    └─────────────┘                └─────────────┘
          ↕                               ↕
   Anthropic / OpenAI              Electron Desktop
   (direct HTTPS)                  (existing ws-server.ts)


Desktop-only (never on Android standalone):
  ┌────────────────────────────────────────────┐
  │  MCP servers (child processes)             │
  │  Self-heal (git CLI, npm, app.relaunch())  │
  │  File/shell tools (Node.js fs + exec)      │
  │  Chat context builder (filesystem + git)   │
  │  Build handlers (Gradle, ADB, electron)    │
  │  Local feed server (Node.js http)          │
  │  Multi-agent orchestration (Electron IPC)  │
  └────────────────────────────────────────────┘
```
