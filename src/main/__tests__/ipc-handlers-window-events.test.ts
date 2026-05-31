import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCacheExternalWindowLabel, mockConsumeSuppressFocusEvent } = vi.hoisted(() => ({
  mockCacheExternalWindowLabel: vi.fn().mockResolvedValue(undefined),
  mockConsumeSuppressFocusEvent: vi.fn().mockReturnValue(false),
}))

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}))

vi.mock('../project-handlers', () => ({
  registerProjectHandlers: vi.fn(),
  registerProjectAgentHandlers: vi.fn(),
}))
vi.mock('../settings-handlers', () => ({ registerSettingsHandlers: vi.fn() }))
vi.mock('../conversation-handlers', () => ({
  registerConversationHandlers: vi.fn(),
  registerMessageHandlers: vi.fn(),
}))
vi.mock('../chat-handlers', () => ({
  registerChatHandlers: vi.fn(),
  clearDirListingCache: vi.fn(),
}))
vi.mock('../file-handlers', () => ({
  registerFileHandlers: vi.fn(),
  registerContextHandlers: vi.fn(),
  listDirectoryEntries: vi.fn(),
}))
vi.mock('../system-handlers', () => ({ registerSystemHandlers: vi.fn() }))
vi.mock('../agents', () => ({ registerAgentHandlers: vi.fn() }))
vi.mock('../knowledge', () => ({ registerKnowledgeHandlers: vi.fn() }))
vi.mock('../wiki-handlers', () => ({ registerWikiHandlers: vi.fn() }))
vi.mock('../tools', () => ({ registerToolHandlers: vi.fn() }))
vi.mock('../mcp', () => ({ registerMcpHandlers: vi.fn() }))
vi.mock('../providers', () => ({ registerProviderHandlers: vi.fn() }))
vi.mock('../screen-capture-handlers', () => ({ registerScreenCaptureHandlers: vi.fn() }))
vi.mock('../screen-capture', () => ({
  cacheExternalWindowLabel: mockCacheExternalWindowLabel,
  consumeSuppressFocusEvent: mockConsumeSuppressFocusEvent,
}))

describe('registerIpcHandlers window events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wires blur and focus listeners for clipboard integration', async () => {
    const listeners = new Map<string, () => void>()
    const mainWindow = {
      getTitle: vi.fn().mockReturnValue('Copilot Desktop Hub'),
      on: vi.fn((event: string, handler: () => void) => {
        listeners.set(event, handler)
      }),
      webContents: { send: vi.fn() },
    }

    const { registerIpcHandlers } = await import('../ipc-handlers')
    registerIpcHandlers(mainWindow as never)

    listeners.get('blur')?.()
    expect(mockCacheExternalWindowLabel).toHaveBeenCalledWith('Copilot Desktop Hub')

    listeners.get('focus')?.()
    expect(mockConsumeSuppressFocusEvent).toHaveBeenCalled()
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('clipboard:auto-focus')
  })

  it('skips auto-clipboard when the focus event is suppressed', async () => {
    mockConsumeSuppressFocusEvent.mockReturnValue(true)
    const listeners = new Map<string, () => void>()
    const mainWindow = {
      getTitle: vi.fn().mockReturnValue('Copilot Desktop Hub'),
      on: vi.fn((event: string, handler: () => void) => {
        listeners.set(event, handler)
      }),
      webContents: { send: vi.fn() },
    }

    const { registerIpcHandlers } = await import('../ipc-handlers')
    registerIpcHandlers(mainWindow as never)

    listeners.get('focus')?.()

    expect(mainWindow.webContents.send).not.toHaveBeenCalled()
  })
})
