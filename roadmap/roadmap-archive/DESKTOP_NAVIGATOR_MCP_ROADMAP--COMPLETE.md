# Desktop Navigator MCP Server — Feature Roadmap

## What it is

A built-in MCP server in Nexy that gives any agent the ability to see and control **any desktop application**. Analogous to Playwright MCP for web browsers, but for native desktop apps. Agents can enumerate open windows, capture screenshots, read text via OCR, control the mouse and keyboard, and manage the clipboard — all without the user having to describe anything.

Works with any LLM provider configured in Nexy (OpenAI, Anthropic, Gemini, OpenRouter, etc.) because it exposes standard MCP tools — the model just sees a tool list.

---

## Current State

| Capability | Status | Notes |
|---|---|---|
| Screenshot of Nexy window | ✅ Exists | `captureWindowContent()` in `screen-capture.ts` |
| Region selection screenshot | ✅ Exists | `captureWithRegionSelection()` in `screen-capture.ts` |
| OCR on image | ✅ Exists | `tesseract.js`, exposed via `screen:ocr-image` IPC channel |
| Clipboard read (image + text) | ✅ Exists | `readClipboardContent()` / `readClipboardImage()` |
| Enumerate open windows | ✅ Done | `listOpenWindows()` in `screen-capture.ts`, exposed as `list_windows` tool |
| Capture a specific external window | ✅ Done | `captureWindowByTitle()` in `screen-capture.ts` |
| Mouse control | ✅ Done | Via `@nut-tree-fork/nut-js` in `desktop-navigator-mcp.ts` |
| Keyboard input | ✅ Done | Via `@nut-tree-fork/nut-js` in `desktop-navigator-mcp.ts` |
| Clipboard write | ✅ Done | `set_clipboard` tool uses `electron.clipboard.writeText()` |
| Window focus / bring-to-front | ✅ Done | `focus_window` tool via `@nut-tree-fork/nut-js` |
| In-process MCP server | ✅ Done | `desktop-navigator-mcp.ts` + registered in `mcp.ts` via `initDesktopNavigatorMcp()` |

---

## Architecture

**Built-in in-process MCP server** — runs inside the Nexy main process, not as a child process. Uses a direct in-process handler registered as a permanent entry in Nexy's MCP server list at startup. Any agent can enable "Desktop Navigator" in its MCP settings and immediately gets the full tool set — no install, no external process.

When an agent has this server enabled, `callMcpTool` in `mcp.ts` dispatches to the in-process handler (stored as `inProcessHandler` on the `McpServerInstance`) instead of a child process transport.

A CLI bridge (`desktop-navigator-bridge.ts` + `desktop-navigator-bridge-worker.cjs`) also runs an HTTP loopback server so CLI adapters (Claude CLI, Codex CLI) can reach Desktop Navigator tools via a stdio MCP bridge worker process.

---

## New Dependency

**`@nut-tree-fork/nut-js`** ✅ installed (v4.2.6) — cross-platform (Windows / macOS / Linux) native desktop automation:
- Mouse move, click, drag
- Keyboard type, key press, shortcuts
- Window listing with title, position, size
- Native screen capture per window

---

## Files Created / Modified

| File | Change | Status |
|---|---|---|
| `src/main/desktop-navigator-mcp.ts` *(new)* | In-process handler — all tool definitions and request handlers | ✅ Done |
| `src/main/desktop-navigator-bridge.ts` *(new)* | HTTP loopback bridge for CLI adapters | ✅ Done |
| `src/main/desktop-navigator-bridge-worker.cjs` *(new)* | stdio MCP worker script spawned by CLI adapters | ✅ Done |
| `src/main/screen-capture.ts` *(modified)* | Added `captureWindowByTitle(title)` and `listOpenWindows()` | ✅ Done |
| `src/main/mcp.ts` *(modified)* | Registers built-in server via `initDesktopNavigatorMcp()`; routes in-process calls via `inProcessHandler`; injects CLI bridge config | ✅ Done |
| `src/main/ipc-handlers.ts` *(modified)* | Calls `initDesktopNavigatorMcp(win)` during app startup | ✅ Done |

---

## Tool Surface

### Phase 1 — See (read-only, zero new dependencies) ✅ Complete

| Tool | Input | Status |
|---|---|---|
| `list_windows` | — | ✅ Done |
| `screenshot` | `windowTitle?: string` | ✅ Done |
| `screenshot_region` | — | ✅ Done |
| `ocr` | `dataUrl?: string` | ✅ Done |
| `get_clipboard` | — | ✅ Done |

### Phase 2 — Interact (requires `@nut-tree-fork/nut-js`) ✅ Complete

| Tool | Input | Status |
|---|---|---|
| `focus_window` | `windowTitle` | ✅ Done |
| `mouse_move` | `x, y` | ✅ Done |
| `mouse_click` | `x?, y?, button?, double?` | ✅ Done |
| `mouse_drag` | `fromX, fromY, toX, toY` | ✅ Done |
| `key_press` | `keys` | ✅ Done |
| `type_text` | `text` | ✅ Done |
| `set_clipboard` | `text` | ✅ Done |

### Phase 3 — Extended ✅ Complete

| Tool | Input | Status |
|---|---|---|
| `scroll` | `x, y, direction, amount` | ✅ Done |
| `get_active_window` | — | ✅ Done |
| `wait_for_window` | `titleContains, timeoutMs?` | ✅ Done |

---

## Phased Delivery

| Phase | Milestone | Status |
|---|---|---|
| P0 | Write this roadmap | ✅ Done |
| P1 | `list_windows`, `screenshot`, `ocr`, `get_clipboard` | ✅ Done |
| P2 | `mouse_*`, `key_press`, `type_text`, `set_clipboard`, `focus_window` | ✅ Done |
| P3 | `scroll`, `get_active_window`, `wait_for_window` | ✅ Done |

---

## Verification

1. ✅ Open Settings → MCP Servers → "Desktop Navigator" appears as a built-in server, status "connected" — registered via `initDesktopNavigatorMcp()` which adds a sentinel entry with no DB row, surfaced by `getMcpServersWithStatus()` / `registerMcpHandlers` `mcp:list-servers` handler.
2. ✅ Enable it for an agent — standard agent MCP server assignment.
3. ✅ Ask: "What windows do I have open?" → agent calls `list_windows`, returns accurate titles — implemented via `desktopCapturer.getSources()`.
4. ✅ Ask: "Take a screenshot of VS Code" → agent calls `screenshot`, image appears in conversation — implemented via `captureWindowByTitle()`.
5. ✅ Ask: "Type 'hello world' into Notepad" → agent calls `focus_window` then `type_text`, text appears — implemented via `@nut-tree-fork/nut-js`.
6. ✅ All of the above works identically with GPT-4o, Claude, Gemini, or any other model — tools are exposed via standard MCP tool list.
