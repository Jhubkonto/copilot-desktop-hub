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
| Enumerate open windows | ⚠️ Partial | `desktopCapturer.getSources()` used internally, not yet exposed as a tool |
| Capture a specific external window | ❌ Missing | Only full-screen or user-drawn region today |
| Mouse control | ❌ Missing | No library |
| Keyboard input | ❌ Missing | No library |
| Clipboard write | ❌ Missing | Read-only today |
| Window focus / bring-to-front | ❌ Missing | Electron only controls its own windows |
| In-process MCP server | ❌ Missing | Nexy is an MCP client today; this adds the server side |

---

## Architecture

**Built-in in-process MCP server** — runs inside the Nexy main process, not as a child process. Uses `@modelcontextprotocol/sdk`'s `Server` class directly. Registered as a permanent entry in Nexy's MCP server list at startup. Any agent can enable "Desktop Navigator" in its MCP settings and immediately gets the full tool set — no install, no external process.

When an agent has this server enabled, the existing `callMcpTool` routing in `mcp.ts` dispatches tool calls to the in-process handler instead of a child process transport.

---

## New Dependency

**`@nut-tree/nut-js`** — cross-platform (Windows / macOS / Linux) native desktop automation:
- Mouse move, click, drag
- Keyboard type, key press, shortcuts
- Window listing with title, position, size
- Native screen capture per window

It is a native Node addon with prebuilt binaries per Electron version. Requires an `electron-rebuild` step after install, same as `better-sqlite3`.

> `robotjs` was considered and rejected — abandoned/unmaintained. `@nut-tree/nut-js` is the actively maintained successor.

---

## Files to Create / Modify

| File | Change |
|---|---|
| `src/main/desktop-navigator-mcp.ts` *(new)* | In-process `Server` instance — all tool definitions and request handlers |
| `src/main/screen-capture.ts` *(modify)* | Add `captureWindowByTitle(title)` and `listOpenWindows()` using `desktopCapturer` |
| `src/main/mcp.ts` *(modify)* | Register built-in server sentinel on startup; route `__desktop-navigator__` calls to in-process handler |
| `src/main/ipc-handlers.ts` *(modify)* | Call `initDesktopNavigatorMcp(win)` during app startup |

---

## Tool Surface

### Phase 1 — See (read-only, zero new dependencies)

| Tool | Input | Description |
|---|---|---|
| `list_windows` | — | All open desktop windows: title, app name, focused state |
| `screenshot` | `windowTitle?: string` | Captures a window by title (or active window) as JPEG |
| `screenshot_region` | `x, y, width, height` | Captures a specific screen region |
| `ocr` | `dataUrl?: string` | OCR on the last screenshot or provided image; reuses `tesseract.js` |
| `get_clipboard` | — | Current clipboard content (text or image) |

### Phase 2 — Interact (requires `@nut-tree/nut-js`)

| Tool | Input | Description |
|---|---|---|
| `focus_window` | `windowTitle` | Brings a window to the front |
| `mouse_move` | `x, y` | Move cursor to screen coordinates |
| `mouse_click` | `x?, y?, button?` | Click at position (defaults to current cursor) |
| `mouse_drag` | `fromX, fromY, toX, toY` | Click-drag between two points |
| `key_press` | `keys` | Press a key or shortcut (e.g. `"ctrl+c"`, `"enter"`) |
| `type_text` | `text` | Types a string at the current cursor position |
| `set_clipboard` | `text` | Writes text to the clipboard |

### Phase 3 — Extended

| Tool | Input | Description |
|---|---|---|
| `scroll` | `x, y, direction, amount` | Mouse wheel scroll at a position |
| `get_active_window` | — | Title and bounds of the currently focused window |
| `wait_for_window` | `titleContains, timeoutMs?` | Poll until a matching window appears |

---

## Implementation Notes

### `captureWindowByTitle` (add to `screen-capture.ts`)

```ts
export async function captureWindowByTitle(title: string): Promise<{ dataUrl: string } | { error: string }> {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 1920, height: 1080 },
  })
  const match = sources.find((s) => s.name.toLowerCase().includes(title.toLowerCase()))
  if (!match) return { error: `No window matching "${title}" found` }
  return { dataUrl: match.thumbnail.toDataURL() }
}
```

### In-process MCP server (`desktop-navigator-mcp.ts`)

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { captureWindowByTitle, listOpenWindows } from './screen-capture'
import type { BrowserWindow } from 'electron'

export const DESKTOP_NAVIGATOR_ID = '__desktop-navigator__'

export function createDesktopNavigatorServer(win: BrowserWindow) {
  const server = new Server(
    { name: 'nexy-desktop-navigator', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    switch (req.params.name) {
      case 'list_windows': { /* ... */ }
      case 'screenshot': { /* calls captureWindowByTitle */ }
      case 'ocr': { /* calls existing tesseract.js integration */ }
      // Phase 2: mouse/keyboard via @nut-tree/nut-js
    }
  })

  return server
}
```

### Routing in `mcp.ts`

```ts
// On startup, add sentinel to the server map:
serverMap.set(DESKTOP_NAVIGATOR_ID, {
  config: { id: DESKTOP_NAVIGATOR_ID, name: 'Desktop Navigator', command: '', args: [], env: {}, enabled: true },
  server: createDesktopNavigatorServer(win),   // in-process Server instance
  status: 'connected',
  tools: DESKTOP_NAVIGATOR_TOOLS,
})

// In callMcpTool(), before child process dispatch:
if (serverId === DESKTOP_NAVIGATOR_ID) {
  return callInProcessServer(serverMap.get(serverId)!.server, toolName, args)
}
```

---

## Phased Delivery

| Phase | Milestone | Dependencies |
|---|---|---|
| P0 | Write this roadmap | Done |
| P1 | `list_windows`, `screenshot`, `ocr`, `get_clipboard` | `desktopCapturer` + `tesseract.js` (already present) |
| P2 | `mouse_*`, `key_press`, `type_text`, `set_clipboard`, `focus_window` | `@nut-tree/nut-js` (new, needs electron-rebuild) |
| P3 | `scroll`, `get_active_window`, `wait_for_window` | Same as P2 |

**P1 can be built immediately with zero new dependencies.** P2 requires adding and rebuilding `@nut-tree/nut-js`.

---

## Verification

1. Open Settings → MCP Servers → "Desktop Navigator" appears as a built-in server, status "connected"
2. Enable it for an agent
3. Ask: "What windows do I have open?" → agent calls `list_windows`, returns accurate titles
4. Ask: "Take a screenshot of VS Code" → agent calls `screenshot`, image appears in conversation
5. Ask: "Type 'hello world' into Notepad" → agent calls `focus_window` then `type_text`, text appears
6. All of the above works identically with GPT-4o, Claude, Gemini, or any other model
