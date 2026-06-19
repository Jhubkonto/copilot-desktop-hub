import type { BrowserWindow } from 'electron'
import { clipboard as electronClipboard } from 'electron'
import { captureWindowByTitle, captureWithRegionSelection, listOpenWindows, readClipboardContent } from './screen-capture'
import { recognizeText } from './ocr'

export const DESKTOP_NAVIGATOR_ID = '__desktop-navigator__'

type McpToolResult = {
  success: boolean
  result?: string
  images?: { dataUrl: string; mimeType: string }[]
  error?: string
}

interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  serverId: string
  serverName: string
}

const SN = DESKTOP_NAVIGATOR_ID
const NAME = 'Desktop Navigator'

export const DESKTOP_NAVIGATOR_TOOLS: ToolDef[] = [
  // Phase 1 — See
  {
    name: 'list_windows',
    description: 'List all open desktop windows with their titles.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    serverId: SN,
    serverName: NAME,
  },
  {
    name: 'screenshot',
    description:
      'Capture a screenshot of a window by title (partial match). Omit windowTitle to capture the Nexy window itself.',
    inputSchema: {
      type: 'object',
      properties: {
        windowTitle: { type: 'string', description: 'Partial window title to match (case-insensitive)' },
      },
      required: [],
    },
    serverId: SN,
    serverName: NAME,
  },
  {
    name: 'screenshot_region',
    description: 'Capture a specific region of the screen by asking the user to draw a selection rectangle.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    serverId: SN,
    serverName: NAME,
  },
  {
    name: 'ocr',
    description:
      'Run OCR on an image to extract text. Provide a data URL, or omit to OCR the clipboard image.',
    inputSchema: {
      type: 'object',
      properties: {
        dataUrl: { type: 'string', description: 'data: URL of the image to OCR' },
      },
      required: [],
    },
    serverId: SN,
    serverName: NAME,
  },
  {
    name: 'get_clipboard',
    description: 'Read the current clipboard content (text or image).',
    inputSchema: { type: 'object', properties: {}, required: [] },
    serverId: SN,
    serverName: NAME,
  },

  // Phase 2 — Interact
  {
    name: 'focus_window',
    description: 'Bring a window to the front and give it focus.',
    inputSchema: {
      type: 'object',
      properties: {
        windowTitle: { type: 'string', description: 'Partial window title to match (case-insensitive)' },
      },
      required: ['windowTitle'],
    },
    serverId: SN,
    serverName: NAME,
  },
  {
    name: 'mouse_move',
    description: 'Move the mouse cursor to the given screen coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate in pixels' },
        y: { type: 'number', description: 'Y coordinate in pixels' },
      },
      required: ['x', 'y'],
    },
    serverId: SN,
    serverName: NAME,
  },
  {
    name: 'mouse_click',
    description: 'Click a mouse button, optionally moving to coordinates first.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (omit to click at current position)' },
        y: { type: 'number', description: 'Y coordinate (omit to click at current position)' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default: left)' },
        double: { type: 'boolean', description: 'Double-click (default: false)' },
      },
      required: [],
    },
    serverId: SN,
    serverName: NAME,
  },
  {
    name: 'mouse_drag',
    description: 'Click-drag from one position to another.',
    inputSchema: {
      type: 'object',
      properties: {
        fromX: { type: 'number' },
        fromY: { type: 'number' },
        toX: { type: 'number' },
        toY: { type: 'number' },
      },
      required: ['fromX', 'fromY', 'toX', 'toY'],
    },
    serverId: SN,
    serverName: NAME,
  },
  {
    name: 'key_press',
    description: 'Press a key or keyboard shortcut. Examples: "enter", "ctrl+c", "ctrl+shift+t", "escape".',
    inputSchema: {
      type: 'object',
      properties: {
        keys: { type: 'string', description: 'Key or shortcut string, e.g. "ctrl+c", "enter", "shift+tab"' },
      },
      required: ['keys'],
    },
    serverId: SN,
    serverName: NAME,
  },
  {
    name: 'type_text',
    description: 'Type a string of text at the current cursor position.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['text'],
    },
    serverId: SN,
    serverName: NAME,
  },
  {
    name: 'set_clipboard',
    description: 'Write text to the system clipboard.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to place on the clipboard' },
      },
      required: ['text'],
    },
    serverId: SN,
    serverName: NAME,
  },

  // Phase 3 — Extended
  {
    name: 'scroll',
    description: 'Scroll the mouse wheel at a position.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate to scroll at' },
        y: { type: 'number', description: 'Y coordinate to scroll at' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Number of scroll steps (default: 3)' },
      },
      required: ['x', 'y', 'direction'],
    },
    serverId: SN,
    serverName: NAME,
  },
  {
    name: 'get_active_window',
    description: 'Get the title and bounds of the currently focused window.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    serverId: SN,
    serverName: NAME,
  },
  {
    name: 'wait_for_window',
    description: 'Poll until a window matching a title appears.',
    inputSchema: {
      type: 'object',
      properties: {
        titleContains: { type: 'string', description: 'Substring to match in window title (case-insensitive)' },
        timeoutMs: { type: 'number', description: 'Max wait time in milliseconds (default: 10000)' },
      },
      required: ['titleContains'],
    },
    serverId: SN,
    serverName: NAME,
  },
]

// Lazy-load nut-js so a require error only surfaces when a P2/P3 tool is actually called.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _nut: any = null
async function getNut() {
  if (_nut) return _nut
  _nut = await import('@nut-tree-fork/nut-js')
  return _nut
}

// Parse a shortcut string like "ctrl+shift+t" into an array of nut-js Key values.
// Falls back to keyboard.type() for plain character strings.
async function parseKeys(keyStr: string): Promise<{ keys: number[]; isShortcut: boolean }> {
  const { Key } = await getNut()
  const parts = keyStr.toLowerCase().split('+').map((p) => p.trim())

  const keyMap: Record<string, number> = {
    ctrl: Key.LeftControl, control: Key.LeftControl,
    shift: Key.LeftShift,
    alt: Key.LeftAlt,
    meta: Key.LeftSuper, cmd: Key.LeftCmd, win: Key.LeftWin, super: Key.LeftSuper,
    enter: Key.Return, return: Key.Return,
    escape: Key.Escape, esc: Key.Escape,
    tab: Key.Tab,
    space: Key.Space,
    backspace: Key.Backspace,
    delete: Key.Delete, del: Key.Delete,
    home: Key.Home, end: Key.End,
    pageup: Key.PageUp, pagedown: Key.PageDown,
    up: Key.Up, down: Key.Down, left: Key.Left, right: Key.Right,
    f1: Key.F1, f2: Key.F2, f3: Key.F3, f4: Key.F4,
    f5: Key.F5, f6: Key.F6, f7: Key.F7, f8: Key.F8,
    f9: Key.F9, f10: Key.F10, f11: Key.F11, f12: Key.F12,
    a: Key.A, b: Key.B, c: Key.C, d: Key.D, e: Key.E, f: Key.F, g: Key.G,
    h: Key.H, i: Key.I, j: Key.J, k: Key.K, l: Key.L, m: Key.M, n: Key.N,
    o: Key.O, p: Key.P, q: Key.Q, r: Key.R, s: Key.S, t: Key.T, u: Key.U,
    v: Key.V, w: Key.W, x: Key.X, y: Key.Y, z: Key.Z,
    '0': Key.Num0, '1': Key.Num1, '2': Key.Num2, '3': Key.Num3, '4': Key.Num4,
    '5': Key.Num5, '6': Key.Num6, '7': Key.Num7, '8': Key.Num8, '9': Key.Num9,
  }

  const resolved: number[] = []
  for (const part of parts) {
    const k = keyMap[part]
    if (k === undefined) return { keys: [], isShortcut: false }
    resolved.push(k)
  }
  return { keys: resolved, isShortcut: true }
}

export function createDesktopNavigatorHandler(win: BrowserWindow) {
  return async (toolName: string, args: Record<string, unknown>): Promise<McpToolResult> => {
    // ---- Phase 1 — See ----

    if (toolName === 'list_windows') {
      const windows = await listOpenWindows()
      if (windows.length === 0) return { success: true, result: 'No windows found.' }
      const list = windows.map((w) => `• ${w.title}`).join('\n')
      return { success: true, result: `Open windows:\n${list}` }
    }

    if (toolName === 'screenshot') {
      const windowTitle = typeof args.windowTitle === 'string' ? args.windowTitle : undefined
      if (windowTitle) {
        const result = await captureWindowByTitle(windowTitle)
        if ('error' in result) return { success: false, error: result.error }
        return {
          success: true,
          result: `Screenshot of "${windowTitle}"`,
          images: [{ dataUrl: result.dataUrl, mimeType: 'image/jpeg' }],
        }
      }
      const image = await win.webContents.capturePage()
      const dataUrl = `data:image/jpeg;base64,${image.toJPEG(85).toString('base64')}`
      return {
        success: true,
        result: 'Screenshot of Nexy window',
        images: [{ dataUrl, mimeType: 'image/jpeg' }],
      }
    }

    if (toolName === 'screenshot_region') {
      const result = await captureWithRegionSelection(win)
      if ('error' in result) return { success: false, error: result.error }
      return {
        success: true,
        result: 'Region screenshot captured',
        images: [{ dataUrl: result.dataUrl, mimeType: 'image/png' }],
      }
    }

    if (toolName === 'ocr') {
      const dataUrl = typeof args.dataUrl === 'string' ? args.dataUrl : undefined
      const source = dataUrl ?? (() => {
        const clip = readClipboardContent()
        if (!clip) return null
        if (clip.type === 'text') return clip.text  // treat as already-text
        return clip.dataUrl
      })()
      if (!source) return { success: false, error: 'No image in clipboard and no dataUrl provided' }
      if (!source.startsWith('data:')) return { success: true, result: source }
      try {
        const text = await recognizeText(source)
        return { success: true, result: text || '(no text recognized)' }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    if (toolName === 'get_clipboard') {
      const clip = readClipboardContent()
      if (!clip) return { success: true, result: '(clipboard is empty)' }
      if (clip.type === 'text') return { success: true, result: clip.text }
      return {
        success: true,
        result: 'Clipboard contains an image',
        images: [{ dataUrl: clip.dataUrl, mimeType: 'image/png' }],
      }
    }

    // ---- Phase 2 — Interact ----

    if (toolName === 'set_clipboard') {
      const text = typeof args.text === 'string' ? args.text : ''
      electronClipboard.writeText(text)
      return { success: true, result: 'Clipboard updated' }
    }

    try {
      const { mouse, keyboard, getWindows, getActiveWindow, Button, straightTo, Point } = await getNut()

      if (toolName === 'focus_window') {
        const title = typeof args.windowTitle === 'string' ? args.windowTitle : ''
        const windows = await getWindows()
        let found = false
        for (const w of windows) {
          const t: string = await w.getTitle()
          if (t.toLowerCase().includes(title.toLowerCase())) {
            await w.focus()
            found = true
            break
          }
        }
        if (!found) return { success: false, error: `No window matching "${title}" found` }
        return { success: true, result: `Focused window matching "${title}"` }
      }

      if (toolName === 'mouse_move') {
        const x = Number(args.x)
        const y = Number(args.y)
        await mouse.move(straightTo(new Point(x, y)))
        return { success: true, result: `Mouse moved to (${x}, ${y})` }
      }

      if (toolName === 'mouse_click') {
        const x = typeof args.x === 'number' ? args.x : undefined
        const y = typeof args.y === 'number' ? args.y : undefined
        const btnStr = typeof args.button === 'string' ? args.button : 'left'
        const isDouble = args.double === true
        const btn = btnStr === 'right' ? Button.RIGHT : btnStr === 'middle' ? Button.MIDDLE : Button.LEFT

        if (x !== undefined && y !== undefined) {
          await mouse.move(straightTo(new Point(x, y)))
        }
        if (isDouble) {
          await mouse.doubleClick(btn)
        } else {
          await mouse.click(btn)
        }
        const pos = x !== undefined ? ` at (${x}, ${y})` : ' at current position'
        return { success: true, result: `${isDouble ? 'Double-clicked' : 'Clicked'} ${btnStr}${pos}` }
      }

      if (toolName === 'mouse_drag') {
        const fromX = Number(args.fromX)
        const fromY = Number(args.fromY)
        const toX = Number(args.toX)
        const toY = Number(args.toY)
        await mouse.move(straightTo(new Point(fromX, fromY)))
        await mouse.drag(straightTo(new Point(toX, toY)))
        return { success: true, result: `Dragged from (${fromX}, ${fromY}) to (${toX}, ${toY})` }
      }

      if (toolName === 'key_press') {
        const keyStr = typeof args.keys === 'string' ? args.keys : ''
        const { keys, isShortcut } = await parseKeys(keyStr)
        if (isShortcut && keys.length > 0) {
          await keyboard.pressKey(...keys)
          await keyboard.releaseKey(...keys)
        } else {
          // Fall back to typing for unrecognised single characters
          await keyboard.type(keyStr)
        }
        return { success: true, result: `Pressed "${keyStr}"` }
      }

      if (toolName === 'type_text') {
        const text = typeof args.text === 'string' ? args.text : ''
        await keyboard.type(text)
        return { success: true, result: `Typed ${text.length} character(s)` }
      }

      // ---- Phase 3 — Extended ----

      if (toolName === 'scroll') {
        const x = Number(args.x)
        const y = Number(args.y)
        const direction = typeof args.direction === 'string' ? args.direction : 'down'
        const amount = typeof args.amount === 'number' ? args.amount : 3

        await mouse.move(straightTo(new Point(x, y)))
        switch (direction) {
          case 'up':    await mouse.scrollUp(amount);    break
          case 'down':  await mouse.scrollDown(amount);  break
          case 'left':  await mouse.scrollLeft(amount);  break
          case 'right': await mouse.scrollRight(amount); break
          default:      await mouse.scrollDown(amount)
        }
        return { success: true, result: `Scrolled ${direction} ${amount} step(s) at (${x}, ${y})` }
      }

      if (toolName === 'get_active_window') {
        const w = await getActiveWindow()
        const title = await w.getTitle()
        const region = await w.getRegion()
        return {
          success: true,
          result: `Active window: "${title}"\nBounds: x=${region.left}, y=${region.top}, width=${region.width}, height=${region.height}`,
        }
      }

      if (toolName === 'wait_for_window') {
        const titleContains = typeof args.titleContains === 'string' ? args.titleContains : ''
        const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 10000
        const pollInterval = 500
        const deadline = Date.now() + timeoutMs

        while (Date.now() < deadline) {
          const windows = await getWindows()
          for (const w of windows) {
            const t: string = await w.getTitle()
            if (t.toLowerCase().includes(titleContains.toLowerCase())) {
              return { success: true, result: `Window found: "${t}"` }
            }
          }
          await new Promise((r) => setTimeout(r, pollInterval))
        }
        return { success: false, error: `Timed out waiting for window matching "${titleContains}"` }
      }

    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }

    return { success: false, error: `Unknown tool: ${toolName}` }
  }
}
