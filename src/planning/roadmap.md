# Nexy — Product Roadmap

> **Last updated:** 2026-06-08 (v0.9.0)
> **Status:** Living document  
> **Related:** [`architecture-overview.md`](./architecture-overview.md)

---

## Vision

Nexy is a provider-agnostic native AI workspace — locally-first, capable of autonomous multi-step work via MCP tools, CLI adapters, and browser automation. Works with BYOK API keys (OpenAI, Anthropic, Azure), Claude CLI, or Codex CLI, with no vendor lock-in.

---

## Release History

### v0.1.0 — Foundation ✅
- Electron + React shell, local SQLite persistence
- GitHub OAuth device flow authentication
- Multi-conversation chat with streaming
- Agent configuration (system prompt, model, icon)
- Settings panel (model, temperature, API key)

### v0.2.0 — Project Intelligence ✅
- Project workspaces with per-project config
- `@workspace`, `@git`, `@file` context refs
- Knowledge files per agent
- Context inspector (token budget preview)
- Multi-provider support (OpenAI, Anthropic, Azure, Ollama)
- Team activity awareness panel

### v0.3.0 — Browser Automation via MCP ✅ _(2026-05-30)_
- MCP server lifecycle management (add/remove/enable/disable)
- MCP tool discovery and display in AgentPanel
- Tool approval modal (user confirms before execution)
- `@playwright/mcp` as first-class preset
- Crash recovery with exponential reconnect
- Tool-call activity blocks in chat (live, collapsible)
- Screenshot thumbnails in ToolCallBlock + "Use as context" pin button
- Vision feedback loop: model receives Playwright screenshots before next reasoning step

### v0.4.0 — Context Collector MVP ✅ _(2026-05-30)_
- Camera button captures full display → attaches to composer
- Clipboard button pastes clipboard image → attaches to composer
- Image-only sends (no text required)
- macOS Screen Recording permission guidance toast
- Images auto-scaled to ≤1568px before sending to model
- **Known limitation**: Camera captures the app itself (frontmost). Fixed in v0.4.1.

---

## Current Development

### v0.4.1 — Screen Capture Overlay ✅ _(2026-05-30)_

**Theme**: Make the camera button genuinely useful — rubber-band region selector over a clean screenshot.

**Spec**: [`screen-capture-overlay-spec.md`](./screen-capture-overlay-spec.md)

#### Overlay (OV series)
| Task | Description | Status |
|---|---|---|
| OV.1 | Dual preload build config | ✅ |
| OV.2 | `src/preload/overlay.ts` | ✅ |
| OV.3 | `src/renderer/overlay.html` (rubber-band UI) | ✅ |
| OV.4 | Overlay IPC channels | ✅ |
| OV.5 | `openRegionOverlay()` in screen-capture.ts | ✅ |
| OV.6 | `captureWithRegionSelection()` orchestrator | ✅ |
| OV.7 | Update `screen:capture` IPC handler | ✅ |
| OV.8 | Silent-cancel handling in ChatWindow | ✅ |

#### Enhancements
| Task | Description | Status |
|---|---|---|
| CCI.7a | `imageResponses?` field in `McpServerConfig` | ✅ |
| CCI.7b | `imageResponses` toggle UI in McpServerPanel | ✅ |
| CCI.7c | `--imageResponses` arg injection in MCP spawn | ✅ |
| CLB.1–5 | Clipboard text inject (paste text as `@clipboard` context ref) | ✅ |

---

### v0.4.2 — Provider-Agnostic MCP Tool Loop Refactor ✅ _(2026-05-30)_

**Theme**: Make MCP browser automation provider-agnostic and lock in v0.4.1 regressions with tests.

| Task | Description | Status |
|---|---|---|
| PTL.1 | Consolidate planning docs + `.gitignore` housekeeping | ✅ |
| PTL.2 | Extract `runProviderMcpToolLoop()` into `src/main/tool-loop.ts` | ✅ |
| PTL.3 | Add Anthropic MCP tool-calling support + routing | ✅ |
| T.1 | Tool loop abstraction tests | ✅ |
| T.2 | Screen-capture clipboard regression tests | ✅ |
| T.3 | MCP `imageResponses` transport tests | ✅ |
| T.4 | Anthropic conversion helper tests | ✅ |

#### Follow-on work
| Task | Description | Status |
|---|---|---|
| CCI.8 | Anthropic native tool-result image format in streamed path | ✅ |
| CC.11 | Local OCR via `tesseract.js` (main process worker_threads) | ✅ |
| CC.12 | Active window metadata via `get-windows` package | ✅ |
| CC.13 | Auto clipboard-on-focus (opt-in setting) | ✅ |

#### Phase 3 — Advanced (v0.5.0+)
| Task | Description | Status |
|---|---|---|
| CC.14 | Global keyboard shortcut | 🔲 |
| CC.15 | Multi-capture batching | 🔲 |
| CC.16 | Capture annotation (draw arrows/text) | 🔲 |

---

## Planned

### v0.4.3 — Dynamic Model Catalog ✅ _(Released)_

**Theme**: Replace the manually-maintained static model list with live data from the GitHub Copilot model catalog. Notify the user whenever models are added, removed, or updated.

**Why now**: The `GET https://api.githubcopilot.com/models` endpoint is already accessible with the existing Copilot token. The DB snapshot is now the sole source of truth for available models; `MODEL_OPTIONS` has been removed from the runtime fallback path and the DB is seeded on first install.

| Task | Description | Status |
|---|---|---|
| MC.1 | Fetch `GET /models` on auth (and each app start when authenticated); normalise into `CatalogModel[]` | ✅ |
| MC.2 | Persist catalog snapshot in `settings` table (key: `model_catalog_snapshot`); diff new vs. stored snapshot | ✅ |
| MC.3 | Emit `model:catalog-updated` to renderer when diff is non-empty, listing added/removed/changed models | ✅ |
| MC.4 | Add `model:list-catalog` IPC channel; expose `listModelCatalog()` and `onCatalogUpdated()` on preload bridge | ✅ |
| MC.5 | DB is the sole source of truth; `MODEL_OPTIONS` removed from fallback path; DB seeded with 15 known models on first install so the dropdown is never empty | ✅ |
| MC.6 | Tests: fetch + diff logic, snapshot persistence, first-install seeding, offline fallback, renderer dropdown population (723 passing) | ✅ |

---

### v0.4.4 — Project Wiki ✅ _(all phases complete)_

**Theme**: A living, per-project knowledge base that grows from conversations — facts, decisions, procedures, and resolutions captured automatically from chat history and surfaced back into future conversations.

**Problem**: Valuable knowledge discovered in conversations (architectural decisions, debugging resolutions, coding conventions, API quirks) lives only in chat history and is never re-used. Users repeat themselves across conversations and agents have no memory of what was already figured out.

**Design principles**:
- Per-project scope (not per-agent) — knowledge belongs to the project, not the agent
- Atomic tagged entries — not free-form files, but structured facts that can be searched and injected
- Closes the loop — wiki entries feed back into future conversations via `@wiki` refs and auto-injection
- Curated by default — AI suggests, user approves; nothing is silently stored

#### Phases

**Phase 1 — Manual wiki foundation** _(v0.4.4)_

The data model and UI, no AI extraction yet. Establishes the foundation everything else builds on.

| Task | Description | Status |
|---|---|---|
| WK.1 | `project_wiki_entries` DB table: `id, project_id, title, body, tags, source_conversation_id, source_message_id, superseded_by, created_at, updated_at` | ✅ |
| WK.2 | IPC: `wiki:list-entries`, `wiki:create-entry`, `wiki:update-entry`, `wiki:delete-entry` | ✅ |
| WK.3 | Preload bridge: expose all wiki IPC channels on `window.api` | ✅ |
| WK.4 | "Wiki" tab in Project settings panel — browse entries grouped by tag, create/edit/delete inline (markdown body) | ✅ |
| WK.5 | `@wiki` context ref in composer — autocomplete from project wiki entries, injects selected entries into the message | ✅ |
| WK.6 | Tests: CRUD IPC handlers, DB schema, `@wiki` ref resolution | ✅ |

**Phase 2 — User-triggered extraction** _(v0.4.4 or v0.4.5)_

Let the user flag individual messages as worth remembering — no AI involved yet.

| Task | Description | Status |
|---|---|---|
| WK.7 | "Save to wiki" action on message bubble (alongside Copy/Regenerate) | ✅ |
| WK.8 | Clicking "Save to wiki" opens a pre-filled entry editor (title auto-suggested from first line of message) | ✅ |
| WK.9 | Saved entries carry `source_conversation_id` + `source_message_id` for traceability | ✅ |
| WK.10 | In-chat indicator: subtle 📖 icon on messages that have a linked wiki entry | ✅ |

**Phase 3 — AI-suggested extraction** _(v0.5.0)_

Background LLM call after each conversation proposes candidate entries. User reviews before anything is saved.

| Task | Description | Status |
|---|---|---|
| WK.11 | Post-conversation extraction: background call with structured prompt — "Extract factual learnings, decisions, and procedures from this conversation as a JSON array of `{title, body, tags}` objects" | ✅ |
| WK.12 | Review queue UI — toast "💡 N learnings extracted — review" → modal with Accept / Edit / Discard per candidate | ✅ |
| WK.13 | Deduplication: fuzzy title match against existing entries; if near-match found, offer to update existing rather than create new | ✅ |
| WK.14 | Staleness: if an extracted entry contradicts an existing one, flag it for review with a "supersedes" suggestion | ✅ |

**Phase 4 — Auto-injection into conversations** _(v0.5.0)_

Relevant wiki entries are quietly surfaced at the start of new conversations.

| Task | Description | Status |
|---|---|---|
| WK.15 | On new project conversation start, inject top-N most relevant wiki entries into the system prompt as a "Project knowledge" section | ✅ |
| WK.16 | Relevance scoring: keyword overlap between user's first message and entry titles/tags (no embedding needed for v1) | ✅ |
| WK.17 | Context snapshot includes "N wiki entries injected" — visible in the message's context chip | ✅ |

**Phase 5 — Model-queryable wiki** _(v0.4.4)_ ✅

The model can search the wiki as a tool mid-conversation.

| Task | Description | Status |
|---|---|---|
| WK.18 | Built-in `search_project_wiki(query)` tool available to all project agents | ✅ |
| WK.19 | Tool result rendered as a `ToolCallBlock` in chat (collapsible, shows matched entries) | ✅ |
| WK.20 | Model can also call `create_wiki_entry(title, body, tags)` — subject to user approval | ✅ |

---

### v0.5.0 — Project Intelligence v2 ✅ _(2026-06-01, scoped)_

**Theme**: Deeper workspace understanding — make the app a first-class collaborator on a specific codebase.

**Scope decision**: After evaluating all planned features, only `@git:diff` was implemented. Keyword-based codebase search (FTS5) lacks value without semantic embeddings; file watching and dynamic project variables added noise without meaningful AI utility; project templates were deemed unnecessary bloat.

| Area | Status | Notes |
|---|---|---|
| `@git:diff` context reference | ✅ | `@git:diff` in composer attaches the current `git diff HEAD` output; ~800 token estimate in context inspector |
| Semantic code search (`@codebase`) | ❌ Removed | FTS5 keyword search is poor UX without embeddings; deferred to a future semantic search feature |
| File watcher | ❌ Removed | Passive noise; agents don't benefit from knowing files changed |
| Dynamic project variables (`{{git.branch}}` etc.) | ❌ Removed | Marginal value; `@git:diff` already covers the main use case |
| Project templates | ❌ Removed | Not worth the complexity |

### v0.6.0 — Multi-Agent Hardening ✅

**Theme**: Production-grade multi-agent orchestration.

| Task | Description | Status |
|---|---|---|
| MA.1 | `sendOpenAIWithTools()` in providers.ts — non-streaming OpenAI completion with tool calling | ✅ |
| MA.2 | `sendProviderWithTools()` in providers.ts — provider-agnostic routing (Copilot/OpenAI/Anthropic; Azure throws descriptive error) | ✅ |
| MA.3 | `callLeaderStreaming()` in orchestrator.ts — routes final answer via leader's configured provider | ✅ |
| MA.4 | `callSpecialist()` in orchestrator.ts — resolves specialist provider from `cfg.model`; inherits leader model as fallback; single retry if `chunksEmitted === 0` | ✅ |
| MA.5 | Parallel `Promise.all` for all tool calls in one round | ✅ |
| MA.6 | Input validation: malformed/missing tool call args inject error and let leader recover | ✅ |
| MA.7 | ONE assistant message with all `tool_calls` + individual tool result messages (correct OpenAI protocol) | ✅ |
| MA.8 | DB migration 14: `agent_delegations` audit table | ✅ |
| MA.9 | `agent_delegations` audit writes in chat-handlers.ts after orchestration completes | ✅ |
| MA.10 | Per-step request ID (`${conversationId}:${stepId}`) to avoid request tracking collisions during parallel calls | ✅ |

### v0.7.0 — Plugin SDK ❌ Removed _(Not worth the complexity at this stage)_

---

### v0.4.5 — GitHub Auth Decoupling ✅ _(2026-06-01)_

**Theme**: Make GitHub login optional so users who only use BYOK providers (OpenAI, Anthropic, Azure) can use the app without a GitHub account or Copilot subscription.

| Task | Description | Status |
|---|---|---|
| AU.1 | "Use API key instead" option on the onboarding screen | ✅ |
| AU.2 | Skip `loadModelCatalog` Copilot fetch when not authenticated via GitHub; rely on static seed + DB snapshot | ✅ |
| AU.3 | Guard `getCopilotToken()` — surface a clear auth error if called without GitHub auth | ✅ |
| AU.4 | Auth state in renderer distinguishes `copilot` / `byok` / `none` modes | ✅ |
| AU.5 | `auth:login-byok` IPC handler; Settings screen surfaces API key setup as the primary step in BYOK mode | ✅ |

---

### v0.8.0 — CLI Agent Adapters ✅ _(Released: 2026-06-01)_

**Theme**: Integrate CLI-based AI tools (Claude CLI, gh-copilot CLI) as first-class agent backends — spawn them in a managed PTY, translate their I/O into the app's chat and tool-call UI.

| Task | Description | Status |
|---|---|---|
| CA.1 | Managed PTY wrapper using `node-pty`; spawn, resize, kill, I/O streams | ✅ |
| CA.2 | `cli:spawn`, `cli:write`, `cli:resize`, `cli:kill` IPC + preload bridge | ✅ |
| CA.3 | `CliTerminalPanel` renderer component — embeds `xterm.js` | ✅ |
| CA.4 | CLI detection: scan `$PATH` for `claude`, `gh`, `aider`, `ollama` | ✅ |
| CA.5 | `CliAgentAdapter` interface | ✅ |
| CA.6 | `ClaudeAdapter` — `--output-format stream-json`; streams chunks, surfaces tool calls | ✅ |
| CA.7 | `GhCopilotAdapter` — wraps `gh copilot suggest` | ✅ |
| CA.9 | Agent config UI: "Backend" selector (`claude-cli` / `gh-copilot`) per agent | ✅ |

**Deferred → resolved in v0.8.2:**

| Task | Description | Status |
|---|---|---|
| CA.10 | Tool-call approval bridge — tool events broadcast to WS clients; blocking approval via Android companion (v0.9.0 AR.6) | ✅ |
| CA.11 | Auto-approve policy — agent Backend selector defaults to "Auto"; `approval` field honoured at runtime | ✅ |
| CA.12 | Store CLI output as conversation messages in DB — tool calls persisted as `tool-call` messages, loaded on conversation reload | ✅ |

**Removed in v0.8.2 (replaced by unified chat window):**

| Task | Description | Status |
|---|---|---|
| CA.1 | Managed PTY wrapper (`node-pty`) | ❌ Removed |
| CA.2 | PTY IPC channels (`cli:spawn/write/resize/kill`) | ❌ Removed |
| CA.3 | `CliTerminalPanel` (xterm.js) | ❌ Removed |

---

### v0.8.1 — Copilot API removal + Smart Terminal integration ✅ _(2026-06-02)_

**Theme**: Remove the GitHub Copilot API dependency entirely; the app now works via BYOK keys or Claude CLI only. Integrate the Smart Terminal with the main chat state so conversations persist and stream correctly.

| Task | Description | Status |
|---|---|---|
| RM.1 | Remove `copilot-api.ts`, `DeviceCodeModal`, GitHub OAuth device flow | ✅ |
| RM.2 | DB migration v15: convert `auth_mode: 'copilot'` → `'none'`, migrate agent backends | ✅ |
| RM.3 | Auth state simplifies to `byok` / `none` (CLI counts as `none` for auth purposes) | ✅ |
| RM.4 | `extractWikiLearnings` falls back to Claude CLI when no BYOK key is configured | ✅ |
| ST.1 | Smart Terminal refactored: shares `useChat` state — same conversation, same SQLite history | ✅ |
| ST.2 | `SmartTerminalPanel` receives chat props from `ChatWindow`; isolated IPC removed | ✅ |
| ST.3 | `TerminalMessageList` renders `ChatMessage[]` — user, assistant, tool-call roles | ✅ |
| ST.4 | Fix CLI adapter streaming: `receivedDeltas` flag prevents text duplication when both delta events and full message event fire | ✅ |

---

### v0.8.2 — Smart Terminal consolidation + Nexy rename ✅ _(2026-06-02)_

**Theme**: Remove the raw PTY terminal and Smart Terminal as separate UI modes; consolidate everything into a single chat window. Rename the product from "Copilot Desktop Hub" to **Nexy**.

| Task | Description | Status |
|---|---|---|
| UI.1 | Remove PTY terminal (`node-pty`, `xterm.js`, `CliTerminalPanel`) — no compelling use case over real terminal | ✅ |
| UI.2 | Remove Smart Terminal as a separate mode — it now duplicated the chat window exactly | ✅ |
| UI.3 | "Force CLI backend" toggle added to agent config with Auto / Claude CLI / gh-copilot options | ✅ |
| UI.4 | CLI token cost footer shown in main chat window when CLI backend responds (already in `ChatMessages`) | ✅ |
| UI.5 | Wiki extraction transcript limit raised to 40k chars; head+tail windowing preserves both start and resolution | ✅ |
| UI.6 | App renamed to **Nexy** everywhere: package, electron-builder, window title, tray, DB file (`nexy.db`), MCP client identity, User-Agent | ✅ |
| UI.7 | Dead `copilot.ts` and `github-copilot-sdk.d.ts` deleted | ✅ |

---

### v0.8.3 — CLI Backend Polish ✅ _(2026-06-02)_

**Theme**: Fix rough edges in the Claude CLI backend: vision support, model selection, conversation history, and correct model identity.

| Task | Description | Status |
|---|---|---|
| CL.1 | Use `--input-format stream-json` for vision — images attached to messages now pass through correctly | ✅ |
| CL.2 | Remove false model identity injection from CLI system prompt — model no longer claims to be the BYOK default | ✅ |
| CL.3 | Backend indicator chip in context bar — shows active backend (Claude CLI, BYOK, etc.) | ✅ |
| CL.4 | Fix DB userData path migration after app rename to Nexy | ✅ |
| CL.5 | Embed conversation history as labeled text in CLI user message — multi-turn context works correctly | ✅ |
| CL.6 | Store actual model ID on CLI assistant messages (not the backend name "claude-cli") | ✅ |
| CL.7 | Pass conversation model to CLI correctly; resolve it at send time from conversation row | ✅ |
| CL.8 | Replace CLI model text input with styled dropdown; model IDs updated to current Claude 4.x lineup | ✅ |
| CL.9 | `pendingCliModelRef` — model selection before first message now persists correctly to first send | ✅ |
| CL.10 | Per-message model label only shows when a model is stored on the message; no retroactive relabelling | ✅ |
| CL.11 | Auto-detect CLI mode in composer even without an active agent (`authState.mode === 'none' && cliInstalled`) | ✅ |

---

### v0.8.4 — Codex CLI + Setup Flow Polish ✅ _(2026-06-02)_

**Theme**: Make Codex CLI a reliable first-class backend and make first-run setup self-serve for users with no configured provider.

| Task | Description | Status |
|---|---|---|
| CX.1 | Add `CodexAdapter` for `codex exec --json`, with stdin prompt transport, image file attachments, JSONL parsing, token usage, and clean nested error extraction | ✅ |
| CX.2 | Register `codex-cli` as an agent backend and expose it in AgentPanel | ✅ |
| CX.3 | Add account-aware `cli:get-models`; Codex models are read from `~/.codex/models_cache.json` and filtered to visible account-available entries | ✅ |
| CX.4 | Codex chat fallback ignores stale unsupported saved models and uses the first available cached Codex model | ✅ |
| CX.5 | Chat composer model dropdown fetches CLI models dynamically for Claude/Codex and handles Codex-only direct chat | ✅ |
| CX.6 | CLI auth state now tracks Claude and Codex separately while preserving a combined `cliInstalled` readiness flag | ✅ |
| CX.7 | Onboarding supports three setup paths: Codex CLI, Claude CLI, or BYOK API key; API key setup opens Settings directly | ✅ |
| CX.8 | Tests cover Codex adapter parsing/errors, CLI model discovery, auth state, onboarding, and chat-window fallback behavior | ✅ |

---

### v0.9.0 — Android Remote Dispatcher 🔲 _(In progress — desktop WebSocket server complete 2026-06-02)_

**Theme**: A companion Android app (Kotlin + Jetpack Compose) that connects to the desktop over local WiFi, lets the user approve or reject tool calls remotely, monitor live agent output, and trigger new conversations — so long-running agentic tasks can run unattended while the user stays in control from their phone.

**Problem**: Agentic tasks (MCP browser automation, multi-step orchestration) can run for minutes. The user must stay at their desk to approve each tool call. A mobile companion removes that constraint while keeping full human oversight.

**Design principles**:
- Local-network only by default — no cloud relay, no data leaves the LAN unless the user explicitly enables a relay
- Pairing via QR code — one scan sets up the shared secret; no manual IP entry
- Approval parity — the mobile approval UI has the same options as the desktop modal (approve / reject / approve-all-from-this-server)
- Stateless companion — the Android app is a thin client; all state lives in the desktop app

**WS protocol** (server ↔ Android):

| Direction | Event / command | Payload |
|---|---|---|
| Desktop → Android | `connected` | `{ version }` |
| Desktop → Android | `tool:approval-request` | `{ requestId, toolName, args, description }` |
| Desktop → Android | `chat:stream-chunk` | `{ conversationId, chunk }` |
| Desktop → Android | `chat:stream-end` | `{ conversationId }` |
| Desktop → Android | `conversation:list` | `[{ id, title, updated_at }]` |
| Android → Desktop | `tool:approve` / `tool:reject` | `{ token, command, data: { requestId } }` |
| Android → Desktop | `chat:send-message` | `{ token, command, data: { conversationId, content, model? } }` |
| Android → Desktop | `agent:stop` | `{ token, command, data: { conversationId? } }` |
| Android → Desktop | `conversation:list` | triggers push back |

#### Phases

**Phase 1 — Desktop WebSocket server** ✅ _(2026-06-02)_

| Task | Description | Status |
|---|---|---|
| AR.1 | Optional WebSocket server in Electron main process (off by default); port 0 (OS assigns), stored in settings | ✅ |
| AR.2 | Shared-secret auth: desktop generates token via `crypto.randomBytes(24)`; validated on every WS connection and message | ✅ |
| AR.3 | QR code in Settings → "Connect mobile"; encodes `ws://<local-ip>:<port>?token=<secret>`; regenerate button disconnects all clients | ✅ |
| AR.4 | mDNS/Bonjour advertisement | 🔲 Deferred — IP shown in settings UI; sufficient for Phase 1 |
| AR.5 | Event push: `tool:approval-request`, `chat:stream-chunk`, `chat:stream-end`, `conversation:list` | ✅ |
| AR.6 | Command receive: `tool:approve`, `tool:reject`, `chat:send-message` (calls `dispatchChatSend` directly), `agent:stop` | ✅ |

**Phase 2 — Android companion app** 🔲 _(Next up — repo: `nexy-android`, Kotlin + Jetpack Compose + OkHttp)_

| Task | Description | Status |
|---|---|---|
| AR.7 | Android project (`nexy-android`); OkHttp WS client with auto-reconnect and background service | 🔲 |
| AR.8 | QR scan pairing screen; stores endpoint + token in `EncryptedSharedPreferences` | 🔲 |
| AR.9 | Live approval screen: shows tool name, args; Approve / Reject buttons with haptic feedback | 🔲 |
| AR.10 | Conversation list + live streaming view (Markdown rendered, auto-scroll) | 🔲 |
| AR.11 | Push notification via `NotificationManager` (no FCM) when approval arrives while backgrounded | 🔲 |

**Phase 3 — Relay mode (optional, opt-in)**

| Task | Description | Status |
|---|---|---|
| AR.12 | Optional self-hosted relay server (Node.js, open source) for approvals when desktop and phone are not on the same network | 🔲 |
| AR.13 | End-to-end encryption for relay path (NaCl box, keys exchanged at QR pairing time) | 🔲 |
| AR.14 | Desktop setting: "Allow remote access" toggle with relay URL config | 🔲 |

---

### v0.10.0 — Prompt Management 🔲

**Theme**: Treat prompts as reusable, versioned project assets instead of one-off text copied between conversations.

**Problem**: High-value prompts for coding, support, reports, and workflows are hard to find, compare, reuse, and improve. Users lose track of what changed, which prompt performed best, and how to roll back after a bad edit.

| Task | Description | Status |
|---|---|---|
| PM.1 | Prompt library with categories for coding prompts, support prompts, report generation prompts, and custom collections | 🔲 |
| PM.2 | Prompt editor with title, body, description, tags, project scope, and global scope | 🔲 |
| PM.3 | Prompt variables using `{{variable}}` syntax, e.g. `Analyze {{repository}}` or `Generate report for {{customer}}` | 🔲 |
| PM.4 | Variable resolver UI before insertion or execution, with remembered defaults per project where appropriate | 🔲 |
| PM.5 | Prompt version history: track edits, author/source, timestamp, and diff between versions | 🔲 |
| PM.6 | Rollback to any previous prompt version | 🔲 |
| PM.7 | Lightweight performance tracking: usage count, accepted/rejected outcomes, manual rating, and notes | 🔲 |
| PM.8 | Insert prompt into composer, run prompt against current project context, or attach prompt as an agent instruction block | 🔲 |

---

### v0.11.0 — Conversation Portability 🔲

**Theme**: Let conversations move between providers and models without losing useful context.

**Problem**: Users often start in one assistant or provider, then need to continue in another — Claude to GPT, GPT to a local model, BYOK to CLI, or desktop to another environment. Today that usually means copy/paste, lost metadata, and broken context.

| Task | Description | Status |
|---|---|---|
| CP.1 | Provider-neutral conversation export format containing messages, attachments metadata, tool-call summaries, model IDs, timestamps, and project context references | 🔲 |
| CP.2 | Import conversation into a new or existing Nexy conversation while preserving role order and key metadata | 🔲 |
| CP.3 | "Continue with..." action to fork a conversation onto another configured backend or model | 🔲 |
| CP.4 | Model/provider compatibility layer that rewrites unsupported content into portable summaries, e.g. tool calls, images, or provider-specific message parts | 🔲 |
| CP.5 | Export packs for external use: Markdown transcript, JSON archive, and compact context bundle | 🔲 |
| CP.6 | Local-model continuation path with automatic context compression when the target context window is smaller | 🔲 |

---

### v0.12.0 — Context Compression 🔲

**Theme**: Keep long-running conversations useful by automatically preserving decisions, facts, unresolved tasks, and current working state.

**Problem**: Long conversations eventually exceed context windows or become expensive to continue. Naive truncation drops important decisions and debugging history; full replay wastes tokens.

| Task | Description | Status |
|---|---|---|
| CCMP.1 | Automatic rolling summaries for long conversations when token budget thresholds are crossed | 🔲 |
| CCMP.2 | Structured summary format: goals, decisions, constraints, files touched, commands run, open questions, and next actions | 🔲 |
| CCMP.3 | Preserve key user preferences and project facts separately from temporary conversation details | 🔲 |
| CCMP.4 | Compression preview in context inspector showing what will be retained, summarized, or omitted | 🔲 |
| CCMP.5 | Manual "compress now" action with editable summary before continuing | 🔲 |
| CCMP.6 | Provider-aware compression targets so summaries fit the selected model's context window | 🔲 |
| CCMP.7 | Conversation restore path that combines compressed summaries, recent messages, and referenced wiki entries | 🔲 |

---

## v1.0.0 — Public Release Milestone 🔲 _(Target: Q3 2027)_

**Requirements before v1.0.0:**
- [ ] Windows installer (NSIS/Squirrel), macOS DMG, Linux AppImage/deb — all auto-updating
- [ ] Telemetry opt-in (crash reports via Sentry or equivalent)
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] Performance baseline (< 200ms p95 for chat composer interaction)
- [ ] Security audit (IPC surface review, CSP hardening)
- [ ] Localization framework in place (even if only English shipped)
- [ ] Public documentation site
- [ ] Privacy policy + terms of service

---

## Ideas Backlog

Items from `src/FEATURE-IDEAS.md` not yet scheduled:

| Idea | Potential Version |
|---|---|
| Voice input (Whisper API) | v0.9.0 |
| Conversation sharing / export | v0.5.0 |
| Pinned system messages / personas | v0.5.0 |
| Custom hotkeys per command | v0.6.0 |
| Embedded web browser panel | v0.7.0 |
| Local model support (llama.cpp) | v0.8.0 (CA adapter) |
| Conversation branching | v1.0.0 |
| iOS companion app | v1.0.0+ |

---

## Principles

1. **Local first**: Sensitive data (conversations, agent configs, captures) stays on the user's machine by default.
2. **Explicit permissions**: Nothing is sent to external APIs without the user's knowledge and action.
3. **Progressive enhancement**: New features layer on top of existing infrastructure; the core chat loop must never regress.
4. **Testable by design**: Every new IPC handler, hook, and component ships with tests.
5. **Traceable**: Every feature has a spec doc with user stories, acceptance criteria, and a subtask list traceable back to code changes.
