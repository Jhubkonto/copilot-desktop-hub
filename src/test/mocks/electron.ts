/**
 * Mocks for Electron modules used in main process tests.
 * Import and call the setup functions in your test files.
 */
import { vi } from 'vitest'

// --- safeStorage ---
const store = new Map<string, string>()

export const mockSafeStorage = {
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((text: string) => Buffer.from(`enc:${text}`)),
  decryptString: vi.fn((buffer: Buffer) => {
    const str = buffer.toString()
    return str.startsWith('enc:') ? str.slice(4) : str
  })
}

// --- BrowserWindow ---
export function createMockBrowserWindow() {
  return {
    webContents: {
      send: vi.fn()
    },
    loadURL: vi.fn(),
    on: vi.fn(),
    show: vi.fn(),
    close: vi.fn()
  }
}

export const mockBrowserWindow = {
  fromWebContents: vi.fn(() => createMockBrowserWindow())
}

// --- ipcMain ---
const handlers = new Map<string, (...args: unknown[]) => unknown>()

export const mockIpcMain = {
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    handlers.set(channel, handler)
  }),
  removeHandler: vi.fn((channel: string) => {
    handlers.delete(channel)
  }),
  _getHandler: (channel: string) => handlers.get(channel),
  _clear: () => handlers.clear()
}

// --- ipcRenderer ---
const listeners = new Map<string, Set<(...args: unknown[]) => void>>()

export const mockIpcRenderer = {
  invoke: vi.fn(),
  on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set())
    listeners.get(channel)!.add(listener)
  }),
  removeListener: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    listeners.get(channel)?.delete(listener)
  }),
  _emit: (channel: string, ...args: unknown[]) => {
    listeners.get(channel)?.forEach((fn) => fn({} as Electron.IpcRendererEvent, ...args))
  },
  _clear: () => listeners.clear()
}

// --- Consolidated electron mock module ---
export function mockElectronModule() {
  vi.mock('electron', () => ({
    safeStorage: mockSafeStorage,
    BrowserWindow: mockBrowserWindow,
    ipcMain: mockIpcMain,
    ipcRenderer: mockIpcRenderer,
    app: {
      getPath: vi.fn(() => '/tmp/test'),
      on: vi.fn(),
      quit: vi.fn(),
      isPackaged: false
    },
    shell: {
      openExternal: vi.fn()
    },
    dialog: {
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn()
    }
  }))
}

export { store, handlers, listeners }
