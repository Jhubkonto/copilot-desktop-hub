# Implementation Plan v2

> This plan supersedes the original `IMPLEMENTATION-PLAN.md` (kept for historical reference).
> It tracks feature milestones using semantic versioning.

---

## Versioning Scheme

| Version | Meaning |
|---------|---------|
| `v1.0.0` | Stable, feature-complete MVP |
| `v0.x.0` | Pre-MVP feature milestones |
| `patch` | Bug fixes and polish within a milestone |

Git tags are created at each minor/major version boundary.

---

## v0.2.0 — Baseline ✅ *(tagged)*

The foundational app: chat via Electron, projects, agents, model selection, sidebar navigation, and UX polish.

**Included:**
- Multi-project and multi-agent support with persistent chat history (SQLite)
- Custom model dropdown (chat composer + regenerate menu) with viewport-aware positioning
- Safe chat regeneration — history preserved on API failure
- Sidebar nav correctness (Projects/Agents always show root list)
- Uniform modal UI (create/cancel buttons, footer layout)
- Fully typed IPC layer, Vitest test suite

---

## v0.3.0 — Browser Automation via MCP ✅

Enable agents to control a browser and interact with webpages — fill forms, click elements, read page content — using the Model Context Protocol.

### Approach

Two complementary modes:

| Mode | How it works | Browser support |
|------|-------------|-----------------|
| **Managed browser** (`@playwright/mcp`) | Agent launches its own Playwright-managed browser | Chromium, Firefox, WebKit |
| **Attach to existing session** (CDP) | Connects to a user's already-open Chrome/Edge tab | Chrome, Edge only |

CDP attach is the primary enabler for "I manually navigated to a page — now help me fill this form."

---

### Implementation Tasks

#### BA.1 — MCP server support in agent config ✅
- `Agent.mcpServers: string[]` stores assigned server IDs
- `McpServerConfig`: `{ id, name, command, args, env, cwd?, enabled }` persisted in DB
- IPC: `mcp:list-servers`, `mcp:add-server`, `mcp:update-server`, `mcp:remove-server`, `mcp:restart-server`
- Agent-level tool overrides via `agent:get-mcp-tool-overrides` / `agent:set-mcp-tool-override`

#### BA.2 — MCP client in main process ✅
- Spawns MCP server processes via stdio/JSON-RPC on `initMcpServers()`
- Discovers tools via `tools/list`, injects into agent chat loop
- Lifecycle: start on app init, stop on app close, manual restart via IPC
- **Crash recovery:** auto-reconnect on unexpected transport close (5 s delay, per-server timer, cancels on intentional disconnect/remove/shutdown)
- **Tests:** spawn, tool discovery, lifecycle, crash recovery, approval policies

#### BA.3 — `@playwright/mcp` integration ✅
- `@playwright/mcp ^0.0.75` added to `dependencies`
- Playwright (Chromium) and Playwright (CDP attach) presets in McpServerPanel quick-add

#### BA.4 — CDP attach mode ✅
- CDP handled via `--cdp-endpoint` arg in Playwright CDP preset
- Preset description includes setup instructions (`--remote-debugging-port=9222`)

#### BA.5 — Agent settings UI — MCP/Browser panel ✅
- **"Browser & MCP"** section in AgentPanel with server assignment toggles
- Connection status badge per server, tool count display
- Quick-add presets and Manage link to McpServerPanel

#### BA.6 — Tool call rendering in chat ✅
- `chat:tool-call-event` IPC event emitted from `runMcpToolLoop` after each tool call
- Live `ToolCallBlock` messages injected into chat during generation (collapsible, shows args + result)
- Success (✅) / error (⚠️) state, result truncated at 2000 chars
- **Tests:** renders tool name/server, expands/collapses, error state, truncation, disabled when no details

#### BA.7 — Tool approval UX ✅
- `ToolApproval` modal with Approve / Deny / Always buttons + 60 s auto-deny countdown
- Per-tool override policies: `auto`, `always-ask`, `disabled` (configurable per agent)

#### BA.8 — Docs & onboarding ✅
- `src/FEATURE-IDEAS.md` updated: Browser Automation marked as implemented in v0.3.0
- AgentPanel empty-MCP state hint: "Add Playwright to enable browser automation"

---

### Open Questions for v0.3.0

1. Bundle `@playwright/mcp` in the Electron package, or require separate install?
2. Tool approval: auto-approve all, or prompt user per action?
3. Screenshot results: display inline in chat or save to disk?

---

## v0.4.0 — Context Collector ✅ *(shipped — Phase 1)*

Bring any on-screen information into Copilot with a single click.

**Full spec:** `src/planning/context-collector-spec.md`  
**Feasibility assessment:** `src/planning/context-collector-feasibility.md`

### Approach

Captures produce `data:image/png;base64,...` data URLs that slot directly into the existing `images: PastedImage[]` pipeline — no changes to `chat-handlers.ts` or the Copilot API call.

---

### Implementation Tasks

#### CC.1 — `src/main/screen-capture.ts` module ✅
- `checkScreenPermission()`, `captureFullScreen()` (full display, auto-scaled to ≤1568px), `readClipboardImage()`
- macOS: empty `getSources()` treated as denied regardless of cached status
- Images downscaled to ≤1568px longest edge before returning

#### CC.2 — Overlay preload + region selection ✅ *(shipped in v0.4.1)*
- Implemented as OV.1–OV.8: hide app → clean capture → transparent overlay → rubber-band region select → crop → restore app

#### CC.3 — IPC channel registration ✅
- `'screen:capture'`, `'screen:check-permission'`, `'clipboard:read-image'` in `IpcChannels` + `IpcReturnMap`
- `src/main/screen-capture-handlers.ts` + registered in `src/main/ipc-handlers.ts`

#### CC.4 — Preload bridge ✅
- `captureScreen()`, `checkScreenPermission()`, `readClipboardImage()` on `window.api`

#### CC.5 — Capture state management ✅ *(simplified: uses existing `useFileInput.setPendingImages` directly)*

#### CC.6 — Send flow ✅ *(image-only sends allowed; fallback content injected if input empty)*

#### CC.7 — CaptureChip component ✅ *(simplified: existing `AttachmentBar` renders capture thumbnails identically)*

#### CC.8 — Camera + Clipboard buttons in ChatComposer ✅
- `Camera` and `ClipboardPaste` icon buttons added after `Paperclip`
- Send button enabled when images present even without text

#### CC.9 — Wire `ChatWindow` ✅
- `handleCaptureScreen` + `handlePasteClipboardImage` callbacks; wired to `fileInput.setPendingImages`

#### CC.10 — macOS permission guidance ✅
- Error toast with System Settings guidance on denied

---

### Playwright MCP ↔ Context Collector Integration

**Full spec:** `src/planning/context-collector-mcp-integration.md`

#### CCI.1–CCI.6 ✅ *(all shipped)*
- Image extraction, vision feedback loop, ToolCallBlock thumbnails, "Use as context" button

#### CCI.7 — `imageResponses` toggle in McpServerPanel ✅ *(v0.4.1)*
#### CCI.8 — Anthropic native tool-result image format ✅ *(v0.4.2)*

---

## v0.4.1 — Screen Capture Overlay ✅ *(shipped)*

**Theme**: Make the camera button genuinely useful — hide the app, capture clean, show a rubber-band region selector.

**Full spec:** `src/planning/screen-capture-overlay-spec.md`

### The Problem

The v0.4.0 camera button captures the full display with the app frontmost — the screenshot always shows the Copilot Hub UI. The fix is to hide the app window before capturing, then show a transparent fullscreen overlay for region selection.

### Implementation Tasks

#### OV.1 — Dual preload build config ✅
- `electron.vite.config.ts`: add `overlay.ts` as a second preload input
- Produces `dist/preload/index.cjs` and `dist/preload/overlay.cjs`

#### OV.2 — `src/preload/overlay.ts` ✅
- Minimal `contextBridge`: `window.overlay.ready()`, `window.overlay.getScreenshot()`, `window.overlay.submit(rect)`, `window.overlay.cancel()`, `window.overlay.onScreenshotReady(cb)`

#### OV.3 — `src/renderer/overlay.html` ✅
- Static HTML/JS/CSS — no React, no Vite bundling needed
- On ready: calls `window.overlay.ready()`, waits for `onScreenshotReady`, fetches screenshot via `getScreenshot()`, renders as dimmed background
- Rubber-band selection: two-div approach (dimmed overlay + clear selection rect)
- Cursor: `crosshair`; Escape → `cancel()`; pointerup → `submit(rect)` if rect ≥ 10×10 CSS px

#### OV.4 — Overlay IPC channels ✅
- Add `'overlay:get-screenshot': string` to `IpcReturnMap` and `IpcChannels`
- `ipcMain.on` handlers for `overlay:ready`, `overlay:submit`, `overlay:cancel` (fire-and-forget)
- `ipcMain.handle` for `overlay:get-screenshot` (returns dataUrl from `pendingCaptures` map)

#### OV.5 — `openRegionOverlay()` in `screen-capture.ts` ✅
- Creates overlay `BrowserWindow` (transparent, frameless, alwaysOnTop, `screen-saver` level on macOS)
- Loads `overlay.html` via `file://` URL
- Returns `CssRect | null` (null on cancel or Wayland)
- Cleans up all `ipcMain.on` handlers in every exit path (submit / cancel / window close)

#### OV.6 — `captureWithRegionSelection()` orchestrator ✅
- Replaces simple `captureFullScreen()` call
- Flow: permission check → `mainWindow.hide()` → 400ms delay → `getSources()` → store NativeImage → `openRegionOverlay()` → `mainWindow.show()` → crop → resize ≤1568px → return dataUrl
- Multi-monitor: captures the display nearest the cursor (`screen.getCursorScreenPoint()`)
- Wayland: skip overlay, use full portal source directly

#### OV.7 — Update `screen:capture` IPC handler ✅
- Replace `captureFullScreen()` with `captureWithRegionSelection(mainWindow)` in `screen-capture-handlers.ts`

#### OV.8 — Silent-cancel handling in `ChatWindow.tsx` ✅
- Suppress toast when error contains `'cancelled'` (user pressed Escape — not an error, just a cancel)

---

#### CCI.7a — `imageResponses?` field in `McpServerConfig` ✅
- Add `imageResponses?: 'allow' | 'omit'` to `McpServerConfig` in `src/shared/types.ts`

#### CCI.7b — `imageResponses` toggle UI in `McpServerPanel.tsx` ✅
- Checkbox "Include screenshots in tool results" — shown only when command/name contains `playwright`
- Default: checked (`'allow'`)

#### CCI.7c — `--imageResponses` arg injection in MCP spawn ✅
- In `src/main/mcp.ts` server spawn logic: if `config.imageResponses === 'omit'`, append `['--imageResponses', 'omit']` to `args`

---

#### CLB.1–CLB.5 — Clipboard text inject ✅
- Extend `readClipboardContent()` to return `{ type: 'image' | 'text', ... } | null`
- Text result injected as `@clipboard` context ref in the composer
- `resolveContextBlock()` resolves `@clipboard` to the stored text

---

## v0.4.2 — Provider-Agnostic MCP Tool Loop Refactor ✅ *(shipped)*

**Theme**: Make the MCP browser automation loop reusable across providers while locking in v0.4.1 coverage.

**Full spec:** `src/planning/tool-loop-spec.md`

### Implementation Tasks

#### PTL.1 — Housekeeping + lint cleanup ✅
- `src/planning/` added to `.gitignore`
- `IMPLEMENTATION-PLAN-V2.md` moved into `src/planning/`
- `src/renderer/overlay.js` updated with explicit browser globals for ESLint

#### PTL.2 — Provider-agnostic MCP loop ✅
- Extract `runProviderMcpToolLoop()` into `src/main/tool-loop.ts`
- Reuse the loop from the Copilot path in `chat-handlers.ts`
- Add Anthropic MCP routing without changing non-tool streaming behavior

#### PTL.3 — Anthropic native tool-call plumbing ✅
- Add `toAnthropicMessages()`, `toAnthropicTools()`, and `sendAnthropicWithTools()` in `src/main/providers.ts`
- Preserve screenshot feedback by merging synthetic screenshot messages into Anthropic tool-result turns
- Normalize Anthropic tool names and map tool uses back to original MCP names

#### T.1 — Tool loop tests ✅
- Added `src/main/__tests__/tool-loop.test.ts`
- Covers directive injection, tool-choice sequencing, screenshot batching, unknown tools, and loop cap fallback

#### T.2 — Screen capture regression tests ✅
- Added `src/main/__tests__/screen-capture.test.ts`
- Covers clipboard image/text/null behavior from `readClipboardContent()`

#### T.3 — MCP imageResponses tests ✅
- Added `src/main/__tests__/mcp-image-responses.test.ts`
- Verifies `--imageResponses omit` arg injection rules in MCP stdio transport startup

#### T.4 — Provider conversion tests ✅
- Extended `src/main/__tests__/providers.test.ts`
- Covers Anthropic system extraction, tool-result grouping, screenshot merge behavior, and tool normalization/name maps

---

#### CC.11 — Local OCR via `tesseract.js` ✅ *(Phase 2)*
- Main-process worker_threads OCR, lazy init, ASAR-safe packaging
- CaptureChip toggle: `👁 Vision` / `🔤 Text`

#### CC.12 — Active window metadata ✅ *(Phase 2)*
- `get-windows` package; track `lastKnownExternalWindow` on blur
- Annotate chip: `Screen capture (VS Code)`

#### CC.13 — Auto clipboard-on-focus ✅ *(Phase 2)*
- Opt-in setting; 750ms polling while not focused

#### CC.14–CC.16 — Global shortcut / multi-capture / annotation 🔲 *(Phase 3)*

---

### Context Collector ↔ Playwright MCP Integration

**Full spec:** `src/planning/context-collector-mcp-integration.md`

The browser automation pipeline (v0.3.0) and the Context Collector (v0.4.0) intersect at three seams. CCI tasks ship alongside v0.4.0:

#### CCI.1 — `callMcpTool` image extraction ✅
- Extended return type: `{ success, result?, images?: { dataUrl, mimeType }[], error? }`
- Extracts `type: 'image'` content parts from MCP `CallToolResult`
- Suppresses JSON fallback when images present; returns `[Screenshot captured — N image(s)]` summary

#### CCI.2 — Vision feedback injection in tool loop ✅ *(OQ-CCI-1 resolved)*
- In `runMcpToolLoop`: after ALL tool results in an iteration, injects one synthetic `role: 'user'` message with all screenshots batched (never per-tool — keeps assistant→tool(s)→user sequence valid)
- Enables model to *see* the browser state before deciding next action

#### CCI.3 — `ToolCallEvent` + `ChatMessage` image fields ✅
- Added `resultImages?: { dataUrl: string }[]` to `ToolCallEvent` and `ChatMessage`

#### CCI.4 — Emit images in `chat:tool-call-event` ✅
- `resultImages` included in IPC event payload and live ChatMessage

#### CCI.5 — `ToolCallBlock` image rendering + "Use as context" ✅
- Screenshot `<img>` thumbnails rendered in expanded ToolCallBlock
- `📌 Use as context` button per image → adds to `pendingImages` in composer (via `ChatWindow.tsx`)

#### CCI.6 — Wire "Use as context" through ChatWindow ✅ *(wired directly, no CaptureContext dependency)*
- `onUseImageAsContext` connected from `ToolCallBlock` → `ChatMessages` → `ChatWindow` → `fileInput.setPendingImages`

---

## v0.4.3 — Dynamic Model Catalog ✅

---

## v0.4.4 — Project Wiki ✅ *(shipped — Phases 1 & 4)*

**Theme**: A living, per-project knowledge base — structured wiki entries created manually or extracted from conversations, surfaced back via `@wiki` refs and auto-injection into new conversations.

**Delivered:**
- `project_wiki_entries` DB table with full CRUD IPC layer (`wiki:list-entries`, `wiki:create-entry`, `wiki:update-entry`, `wiki:delete-entry`)
- "Wiki" tab in Project settings — browse by tag, create/edit/delete inline
- `@wiki` context ref in the composer — autocomplete from project entries, injects selected entries into the message context
- AI-suggested extraction (WK.11–WK.14): post-conversation LLM extraction → review queue (Accept / Edit / Discard) with deduplication and staleness detection
- Phase 4 auto-injection: on the first message of a new project conversation, relevant wiki entries are scored by keyword overlap and injected as a `[Project Knowledge]` block; renderer shows a 📖 system message with count
- New `wiki-context.ts` module (`scoreWikiEntry`, `getRelevantWikiEntries`, `formatWikiSection`) — 14 unit tests

**Phases completed:** 1 (WK.1–WK.6), 3 (WK.11–WK.14), 4 (WK.15–WK.17)  
**Deferred:** Phase 2 (WK.7–WK.10 — "Save to wiki" message action), Phase 5 (WK.18–WK.20 — model-queryable wiki tool)

---

**Theme**: Replace the static hardcoded model list with live data from the GitHub Copilot model catalog, and notify the user whenever the available models change.

**Problem**: `src/shared/models.ts` contains a manually-maintained `MODEL_OPTIONS` array with labels and rate multipliers. New models, retired models, and pricing changes require a code change and a release. The `GET https://api.githubcopilot.com/models` endpoint (Copilot catalog) provides this information at runtime and is already accessible with the existing Copilot token.

### Implementation Tasks

#### MC.1 — Fetch catalog on auth ✅
- On successful authentication (and on each app start when already authenticated), call `GET https://api.githubcopilot.com/models` using `getCopilotToken()` in `src/main/copilot-api.ts`
- Parse and normalise the response into a `CatalogModel[]` shape: `{ id, name, vendor, capabilities: string[], rateMultiplier?: number }`

#### MC.2 — Persist catalog snapshot in DB ✅
- Store the catalog as a versioned JSON blob in the `settings` table (key: `model_catalog_snapshot`)
- On every fetch, diff the new list against the snapshot: detect added, removed, and changed (label/rate) entries
- Update the snapshot if the list changed

#### MC.3 — Change notification toast ✅
- If the diff is non-empty, emit `model:catalog-updated` with a `changeSummary` string: "Model catalog updated — 2 added, 1 removed"
- Renderer shows a toast on receipt; emitted at most once per session

#### MC.4 — Expose dynamic list via IPC ✅
- Added `model:list-catalog` and `model:catalog-updated` to `IpcChannels` / `IpcReturnMap` in `src/shared/types.ts`
- Handler returns `CatalogModel[]` (cached in memory after first fetch, DB snapshot on cold start)
- Added `listModelCatalog()` and `onCatalogUpdated()` to the preload bridge

#### MC.5 — Renderer uses live list ✅
- Replaced static `MODEL_OPTIONS` in `AgentPanel`, `MessageBubble`, `SettingsPanel`, `Sidebar`, and `slash-commands.ts` with `getAvailableModelIds(catalogModels, currentModel)` from Zustand `uiSlice`
- `MODEL_OPTIONS` export removed; `MODEL_LABELS` kept as a private display-name fallback in `getModelLabel`
- `getModelLabel(model, catalog?)` checks live catalog first, then falls back to `MODEL_LABELS`, then the raw model ID
- Added `getAvailableModelIds(catalog?, currentModel?)` helper that appends the current model when not in catalog (legacy-model safety)
- When catalog is empty, `getAvailableModelIds` returns `['default']` only — the DB snapshot is the source of truth, not the static list

#### MC.5a — DB seeding on first install ✅ *(added post-review)*
- On first launch (no `model_catalog_snapshot` in DB), `getCachedCatalog()` seeds the DB with a `STATIC_SEED` of 15 known models
- This ensures the model dropdown is never empty before the first API fetch succeeds
- After the first successful catalog fetch, the seed is overwritten with live data
- If offline on subsequent launches, the last fetched snapshot (or seed) is served from DB
- `STATIC_SEED` is defined in `src/main/model-catalog.ts` and exported for test verification

#### MC.6 — Tests ✅
- Main (11 tests): fetch null-on-failure, API mapping, diff added/removed/changed, toast suppression, DB snapshot fallback, null-fetch no-overwrite, first-install DB seeding
- Renderer (5 tests): dropdown population from catalog, empty-catalog shows only Default, `getAvailableModelIds` legacy safety, `getModelLabel` catalog → static label → ID fallback chain
- Total suite: 723 tests passing

---

## v0.8.1 — Copilot API removal + Smart Terminal integration ✅ *(current)*

**Theme**: Remove the GitHub Copilot API dependency; unify the Smart Terminal with the main chat state.

**Included:**
- `copilot-api.ts` and `DeviceCodeModal` removed; GitHub OAuth device flow gone
- DB migration v15: `auth_mode: 'copilot'` → `'none'`, agent backends migrated
- Auth simplifies to `byok` / `none`; Claude CLI users need no API key at all
- `extractWikiLearnings` falls back to Claude CLI when no BYOK key is configured
- Smart Terminal refactored: shares `useChat` state — same SQLite conversation, same streaming path, same sidebar entry
- Removed isolated `SmartTerminalSlice`, `smart-terminal-manager`, `smart-terminal-handlers`, and all `smart-terminal:*` IPC channels
- CLI adapter streaming fix: `receivedDeltas` flag prevents response duplication when CLI emits both per-token delta events and the final complete message event

---

## v1.0.0 — Stable MVP 🔲 *(target)*

To be defined. Will capture remaining stability, performance, accessibility, and polish work needed to call this production-ready. See `src/planning/roadmap.md` for requirements checklist.

---

*Last updated: 2026-06-02*
