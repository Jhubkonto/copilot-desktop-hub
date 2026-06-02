# Architecture — Copilot Desktop Hub

## Overview

Copilot Desktop Hub is a cross-platform desktop application built with Electron, React 19, and TypeScript. It follows Electron's standard multi-process model with a hard security boundary between the renderer (UI) and the main process (system access, network, database).

```
┌─────────────────────────────────────────────────────────────────┐
│  Renderer process  (sandboxed, no Node access)                  │
│  React 19 + Zustand + Tailwind                                  │
│                         │                                       │
│             window.api  │  (contextBridge)                      │
└─────────────────────────┼───────────────────────────────────────┘
                          │  IPC (ipcRenderer ↔ ipcMain)
┌─────────────────────────┼───────────────────────────────────────┐
│  Preload script  (limited bridge, CJS)                          │
│  Exposes typed window.api surface only                          │
└─────────────────────────┼───────────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────────┐
│  Main process  (full Node / Electron access)                    │
│                                                                 │
│  IPC handlers ──► Auth ──► GitHub / Copilot API                 │
│               ──► Providers (OpenAI / Anthropic / Azure)        │
│               ──► Orchestrator (multi-agent delegation)         │
│               ──► Agents / Knowledge / Tools                    │
│               ──► MCP servers (stdio child processes)           │
│               ──► Terminal (node-pty / spawn)                   │
│               ──► File handlers / Context injection             │
│               ──► Database (better-sqlite3)                     │
│               ──► Auto-updater (electron-updater)               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Process Architecture

### Main process (`src/main/`)

The entry point is `src/main/index.ts`. On startup it:
1. Enforces a single-instance lock and registers the `copilot-hub://` deep-link protocol.
2. Creates the frameless `BrowserWindow` with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
3. Applies a Content Security Policy (relaxed in dev for Vite HMR).
4. Opens the SQLite database (`getDatabase()`), runs schema init and versioned migrations.
5. Registers all IPC handlers via `registerIpcHandlers()`.
6. Initialises MCP server connections and the auto-updater.

### Preload script (`src/preload/index.ts`)

A minimal CJS bridge. Uses `contextBridge.exposeInMainWorld` to attach `window.api` to the renderer. Every method is a thin `ipcRenderer.invoke` or `ipcRenderer.on` wrapper. This is the **only** path through which the renderer can reach the main process.

### Renderer (`src/renderer/`)

A standard Vite + React 19 SPA loaded by the `BrowserWindow`. It has no direct Node or Electron access — all side effects go through `window.api`.

---

## Source Layout

```
src/
├── main/
│   ├── index.ts                  # Entry: window, lifecycle, init
│   ├── ipc-handlers.ts           # Aggregator — registers all handler modules
│   ├── database.ts               # SQLite singleton, schema init
│   ├── database-migrations.ts    # Versioned migration runner (PRAGMA user_version)
│   ├── auth.ts                   # BYOK auth mode persistence
│   ├── http-client.ts            # Shared HTTPS helpers: httpsPost, httpsGet, parseSseStream
│   ├── providers.ts              # Multi-provider streaming (OpenAI, Anthropic, Azure)
│   ├── orchestrator.ts           # Multi-agent delegation (leader + team via delegate_to_agent tool)
│   ├── chat-handlers.ts          # Chat IPC: send message, regenerate, edit, stop
│   ├── conversation-handlers.ts  # Conversation + message CRUD
│   ├── agents.ts                 # Agent CRUD + config persistence
│   ├── knowledge.ts              # Agent knowledge file management
│   ├── tools.ts                  # Built-in tool IPC (file-edit, terminal, web-fetch)
│   ├── terminal.ts               # Terminal session management
│   ├── mcp.ts                    # MCP server lifecycle + tool discovery
│   ├── file-handlers.ts          # File/directory read + context injection
│   ├── project-handlers.ts       # Project CRUD + per-project agent config
│   ├── settings-handlers.ts      # App settings (theme, hotkey, zoom, provider keys…)
│   ├── system-handlers.ts        # Window controls, deep-link, CLI detection
│   ├── updater.ts                # electron-updater integration
│   ├── safe-handle.ts            # ipcMain.handle wrapper with error catching
│   └── cli-detection.ts          # Detects installed CLI tools (gh, git…)
│
├── preload/
│   └── index.ts                  # contextBridge — exposes window.api
│
├── renderer/
│   ├── App.tsx                   # Root layout, lazy panels, global IPC event listeners
│   ├── main.tsx                  # React DOM root
│   ├── slash-commands.ts         # Slash command registry
│   │
│   ├── components/
│   │   ├── ChatWindow.tsx         # Chat view orchestrator (thin, ~386 lines)
│   │   ├── Sidebar.tsx            # Left nav: conversations, projects, agents
│   │   ├── TitleBar.tsx           # Custom title bar, agent badge, dir breadcrumb
│   │   ├── AgentPanel.tsx         # Agent builder/editor panel
│   │   ├── ProjectPanel.tsx       # Project view, assignment, config
│   │   ├── ProjectSettingsPanel.tsx
│   │   ├── SettingsPanel.tsx      # App settings UI
│   │   ├── McpServerPanel.tsx     # MCP server config + tool list
│   │   ├── TerminalPanel.tsx      # Embedded xterm.js terminal
│   │   ├── MessageBubble.tsx      # Single chat message renderer
│   │   ├── MarkdownRenderer.tsx   # react-markdown + rehype-highlight
│   │   ├── ToolApproval.tsx       # Approval modal for tool calls
│   │   ├── ContextInspector.tsx   # Active context block inspector
│   │   ├── SearchBar.tsx          # Conversation search
│   │   ├── SectionPane.tsx        # Resizable right-side section container
│   │   ├── ResizeHandle.tsx       # Drag-to-resize handle
│   │   ├── Toast.tsx              # Toast notifications
│   │   ├── OnboardingModal.tsx    # First-run auth/setup flow
│   │   ├── DirectoryPicker.tsx    # Working directory picker
│   │   ├── TeamActivityBlock.tsx  # Multi-agent activity feed
│   │   ├── DeleteAgentDialog.tsx
│   │   ├── DeleteConversationDialog.tsx
│   │   ├── DeleteProjectDialog.tsx
│   │   └── CreateProjectPanel.tsx
│   │
│   ├── components/chat/           # ChatWindow sub-components
│   │   ├── ChatMessages.tsx       # Message list + streaming indicator
│   │   ├── ChatComposer.tsx       # Input textarea + send controls
│   │   ├── AttachmentBar.tsx      # Attached files / image strip
│   │   ├── SlashCommandMenu.tsx   # Slash command dropdown
│   │   └── AtContextMenu.tsx      # @-context reference dropdown
│   │
│   ├── hooks/                     # Custom React hooks (extracted from ChatWindow)
│   │   ├── chat-types.ts          # Shared types for chat hooks
│   │   ├── useChat.ts             # Messages, streaming state, send/regenerate/edit
│   │   ├── useFileInput.ts        # Paste/drag-drop, attachment + image state
│   │   ├── useSlashMenu.ts        # Slash command menu open/close/filter state
│   │   ├── useAtMenu.ts           # @-context menu + resolveContextBlock
│   │   ├── useTimers.ts           # generationElapsedSec, rateLimitRemainingSec
│   │   └── useChatWindowActions.ts # High-level orchestration hook
│   │
│   └── store/
│       ├── app-store.ts           # Zustand store root + hydrate action
│       ├── types.ts               # Store state type
│       └── slices/
│           ├── authSlice.ts       # GitHub auth state, device-code flow
│           ├── conversationSlice.ts # Active conversation, messages, streaming
│           ├── projectSlice.ts    # Projects list, active project
│           ├── agentSlice.ts      # Agents list, active agent, agent panel state
│           └── uiSlice.ts         # Theme, sidebar visibility, toasts, panels
│
├── shared/
│   ├── types.ts                   # Cross-boundary types: Message, Conversation, AgentConfig,
│   │                              #   ProjectConfig, DEFAULT_PROJECT_CONFIG, IpcChannels,
│   │                              #   ProviderMessage discriminated union, ToolConfig…
│   ├── models.ts                  # Provider model lists
│   ├── utils.ts                   # Shared utilities
│   └── github-copilot-sdk.d.ts    # Manual type declarations for Copilot internals
│
└── test/                          # Vitest test helpers, renderer mocks
```

---

## Data Flow: Chat Message

```
User types + sends
       │
  ChatComposer (renderer)
       │  window.api.sendChatMessage(...)
       ▼
  ipcRenderer.invoke('chat:send', payload)
       │
  chat-handlers.ts (main)
       │── loads conversation history from SQLite
       │── resolves agent config + context files
       │── calls the selected BYOK provider or CLI adapter
       │
  providers.ts
       │── opens HTTPS streaming request
       │── parses SSE chunks via parseSseStream()
       │── emits ipcMain → win.webContents.send('chat:token', chunk)
       │
  useChat.ts (renderer hook)
       │── receives streaming tokens via window.api.onChatToken(cb)
       │── appends to messages state
       ▼
  ChatMessages.tsx renders live streaming output
```

---

## State Management

The renderer uses a single **Zustand** store (`useAppStore`) composed from five domain slices with **Immer** for immutable updates:

| Slice | Responsibility |
|---|---|
| `authSlice` | GitHub token, user profile, device-code flow state |
| `conversationSlice` | Active conversation, message list, streaming state, model selection |
| `projectSlice` | Projects list, active project |
| `agentSlice` | Agents list, active agent, agent panel open/closed |
| `uiSlice` | Theme, sidebar visibility, toasts, modal flags, section panes |

The `hydrate` action in `app-store.ts` loads all persistent state from the main process on startup via a single `window.api.hydrate()` call.

---

## Database

**Engine:** `better-sqlite3` (synchronous, single-file SQLite)  
**Location:** `{userData}/data/copilot-hub.db`  
**Settings:** `WAL` journal mode, `foreign_keys = ON`

### Schema

| Table | Purpose |
|---|---|
| `settings` | Key-value app settings (theme, hotkey, zoom, provider keys) |
| `projects` | Projects with color, config JSON |
| `conversations` | Conversations with optional agent, model, project, pinned flag |
| `messages` | Chat messages with role, content, attachments, edit history, context snapshot |
| `agents` | Agent configs (name, icon, system prompt, model, tools, etc.) |
| `knowledge_files` | Agent knowledge files with injection mode |
| `mcp_servers` | MCP server configs (command, args, env, enabled) |
| `tool_overrides` | Per-agent tool enable/approval overrides |

### Migrations

Schema changes are applied via a **versioned migration runner** in `database-migrations.ts`. The current schema version is tracked with SQLite's `PRAGMA user_version`. Each migration runs exactly once, in order, and is idempotent. Currently at version 11.

---

## IPC Channel Model

All renderer ↔ main communication uses `ipcMain.handle` / `ipcRenderer.invoke` (request-response) or `webContents.send` / `ipcRenderer.on` (main-to-renderer push for streaming events and tool approval requests).

The full channel surface is typed in `src/shared/types.ts` as the `IpcChannels` union. Handler registration is split into domain modules and aggregated in `ipc-handlers.ts`.

---

## Authentication

GitHub authentication uses the **Device Code OAuth flow** (no redirect URI required):

1. Main process requests a device code from `https://github.com/login/device/code`.
2. The `user_code` + `verification_uri` are pushed to the renderer via IPC.
3. The renderer displays the code in an `OnboardingModal`; the user opens the browser link manually.
4. The main process polls `https://github.com/login/oauth/access_token` until granted or expired.
5. The access token is stored via Electron's `safeStorage` (OS keychain-backed encryption).

The token is then exchanged for a Copilot API session token (`https://api.github.com/copilot_internal/v2/token`) at the start of each streaming request.

---

## Provider Abstraction

`src/main/providers.ts` implements a uniform streaming interface over four LLM providers:

| Provider | Endpoint |
|---|---|
| `copilot` | `https://api.githubcopilot.com/chat/completions` |
| `openai` | `https://api.openai.com/v1/chat/completions` |
| `anthropic` | `https://api.anthropic.com/v1/messages` |
| `azure` | `https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions` |

All providers stream over HTTPS using `parseSseStream()` from `http-client.ts`. Active streaming requests are tracked in `activeStreamingRequests: Map<string, http.ClientRequest>` to support per-conversation abort.

---

## Multi-Agent Orchestration

When a project has `orchestrationEnabled`, the **orchestrator** (`src/main/orchestrator.ts`) takes over the chat flow:

1. A **leader agent** receives the user message along with a `delegate_to_agent` tool definition.
2. The leader may call `delegate_to_agent` with a `agent_id` and `task` to forward sub-tasks to team specialist agents.
3. Each delegation is capped by `MAX_DELEGATION_DEPTH` (default 5) to prevent infinite loops.
4. Activity steps are streamed back to the renderer as `team-activity` messages shown in `TeamActivityBlock.tsx`.

---

## MCP Integration

Model Context Protocol servers are managed in `src/main/mcp.ts`:

- Server configs are persisted in the `mcp_servers` table.
- On startup, enabled servers are launched as `stdio` child processes via `@modelcontextprotocol/sdk`.
- The tool catalogue is discovered from each connected server and made available to the agent tool-call pipeline.
- Server lifecycle (connect, disconnect, reconnect) is managed at runtime via IPC handlers.

---

## Built-in Tools

The following built-in tools are available to agents (subject to per-agent config and user approval):

| Tool | Handler | Description |
|---|---|---|
| `file_edit` | `tools.ts` | Read, write, create, and diff files in the working directory |
| `terminal` | `terminal.ts` | Run shell commands in a managed terminal session |
| `web_fetch` | `tools.ts` | Fetch a URL and return its content |

Each tool has an approval mode: `auto` (no prompt), `always-ask` (modal per call), or `disabled`. The `ToolApproval.tsx` component handles the approval dialog.

---

## Build & Toolchain

| Tool | Role |
|---|---|
| `electron-vite` | Unified dev server + build for main, preload, renderer |
| `Vite` (renderer) | React SPA bundling, HMR in dev |
| `TypeScript` | All source — `strict` mode, project references per process |
| `tsconfig.typecheck.json` | Non-composite typecheck config (avoids TS6305 project-ref noise) |
| `Tailwind CSS` | Utility-first styling in renderer |
| `electron-builder` | Cross-platform distributable packaging |
| `Vitest` | Test runner (612 tests across main + renderer) |
| `eslint` + `typescript-eslint` | Linting |
| `electron-rebuild` | Rebuilds native modules (better-sqlite3) against Electron's Node ABI |

### Native module note

`better-sqlite3` is a native Node addon. It must be compiled against **Electron's Node ABI** (not system Node). `postinstall` runs `electron-rebuild -f -w better-sqlite3` automatically after `npm install`. If native module errors appear at runtime after manual `npm rebuild` or agent-triggered builds, re-run:

```bash
npx electron-rebuild -f -w better-sqlite3
```

---

## Testing

Tests live alongside their modules in `__tests__/` subdirectories:

```
src/main/__tests__/           # Main-process unit tests
src/renderer/__tests__/       # Renderer component + hook tests
src/renderer/__tests__/hooks/ # Chat hook tests
```

The test environment for renderer tests uses `happy-dom`. Main-process tests mock Electron and `better-sqlite3` as needed. Run the full suite with:

```bash
npm test
```

---

## Security Model

- Renderer runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- The preload script is the only allowed bridge; it exposes only explicitly listed methods.
- A restrictive CSP is applied via `webRequest.onHeadersReceived`; external `connect-src` is limited to the known API endpoints.
- Credentials (GitHub token, provider API keys) are stored via Electron `safeStorage` (OS keychain encryption on Windows/macOS).
- External URLs opened from the app are delegated to the OS browser via `shell.openExternal`; `setWindowOpenHandler` returns `{ action: 'deny' }` for all in-app navigation.
