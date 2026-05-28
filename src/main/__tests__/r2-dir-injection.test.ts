/**
 * R.2 — Directory listing injection into chat system prompt.
 * Tests verify that when a project has `rootDirectory` set, the
 * [Project File Structure] block is prepended to the outbound user message
 * (which carries the augmented context), and that the cache prevents redundant
 * `listDirectoryEntries` calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const { mockWebContents } = vi.hoisted(() => ({
  mockWebContents: { send: vi.fn() }
}))

const { mockDb, ipcHandlers, mockIpcMain } = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const stmtResults = new Map<string, unknown>()

  const mockDb = {
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((..._args: unknown[]) => ({ changes: 1 })),
      get: vi.fn((..._args: unknown[]): unknown => stmtResults.get(sql) ?? undefined),
      all: vi.fn((): unknown[] => (stmtResults.get(sql) as unknown[]) ?? [])
    })),
    transaction: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn(),
    _setResult: (sql: string, value: unknown) => stmtResults.set(sql, value),
    _clearResults: () => stmtResults.clear()
  }

  return {
    mockDb,
    ipcHandlers,
    mockIpcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcHandlers.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
  }
})

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ webContents: mockWebContents }]),
    fromWebContents: vi.fn(() => ({ webContents: mockWebContents }))
  },
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    on: vi.fn(),
    quit: vi.fn(),
    isPackaged: false,
    setLoginItemSettings: vi.fn()
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn()
  },
  shell: { openExternal: vi.fn() }
}))

vi.mock('../database', () => ({ getDatabase: () => mockDb }))

vi.mock('../safe-handle', () => ({
  safeHandle: async (channel: string, handler: (...args: unknown[]) => unknown) => {
    mockIpcMain.handle(channel, async (...args: unknown[]) => {
      try {
        return await handler(...args)
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Unknown error' }
      }
    })
  }
}))

vi.mock('crypto', () => ({ randomUUID: vi.fn(() => 'r2-uuid') }))

// fs mock: readdirSync returns a controlled list; statSync supports isDirectory()
const mockReaddirSync = vi.fn((_path: unknown) => [] as string[])
const mockStatSync = vi.fn((_path: unknown) => ({ size: 100, isDirectory: () => false }))
const mockExistsSync = vi.fn((_path: unknown) => true)

vi.mock('fs', () => ({
  readFileSync: vi.fn((path: string) => `contents of ${path}`),
  statSync: mockStatSync,
  existsSync: mockExistsSync,
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: mockReaddirSync
}))

const { mockSendCopilotChatMessage } = vi.hoisted(() => {
  const mockSendCopilotChatMessage = vi.fn(async (_w: unknown, _msgs: unknown, onChunk: (c: string) => void) => {
    onChunk('ok')
  })
  return { mockSendCopilotChatMessage }
})

vi.mock('../copilot-api', () => ({
  sendCopilotChatMessage: mockSendCopilotChatMessage,
  abortCopilotStream: vi.fn()
}))
vi.mock('../auth', () => ({ retrieveToken: vi.fn().mockResolvedValue('tok') }))
vi.mock('../agents', () => ({ registerAgentHandlers: vi.fn(), getAgentConfig: vi.fn(() => null) }))
vi.mock('../providers', () => ({
  registerProviderHandlers: vi.fn(),
  getProviderForAgent: vi.fn(() => ({ provider: 'copilot', model: 'default' })),
  getApiKey: vi.fn(() => null),
  sendOpenAIMessage: vi.fn(),
  sendAnthropicMessage: vi.fn(),
  sendAzureMessage: vi.fn(),
  getAzureEndpoint: vi.fn(() => null),
  abortActiveStream: vi.fn()
}))
vi.mock('../tools', () => ({ registerToolHandlers: vi.fn() }))
vi.mock('../terminal', () => ({ registerTerminalHandlers: vi.fn() }))
vi.mock('../mcp', () => ({ registerMcpHandlers: vi.fn() }))
vi.mock('../knowledge', () => ({ registerKnowledgeHandlers: vi.fn() }))
vi.mock('../orchestrator', () => ({
  runOrchestration: vi.fn(async () => ({ finalContent: 'orchestrated', teamActivity: [] }))
}))

// ── Helpers ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`No handler registered for "${channel}"`)
  return handler({}, ...args)
}

/**
 * Returns the USER-message content from the last Copilot API call.
 * The augmented context blocks (including [Project File Structure]) are
 * prepended to the user content, not the system message.
 */
function capturedUserContent(): string | undefined {
  const call = mockSendCopilotChatMessage.mock.calls.at(-1)
  if (!call) return undefined
  const msgs = call[1] as Array<{ role: string; content: unknown }>
  const userMsg = [...msgs].reverse().find((m) => m.role === 'user')
  return typeof userMsg?.content === 'string' ? userMsg.content : undefined
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('R.2 — directory context injection', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    ipcHandlers.clear()
    mockDb._clearResults()

    // Re-implement the Copilot mock after clearAllMocks
    mockSendCopilotChatMessage.mockImplementation(
      async (_w: unknown, _msgs: unknown, onChunk: (c: string) => void) => { onChunk('ok') }
    )

    // Prevent mandatory property accesses from throwing on undefined
    mockDb._setResult('SELECT COUNT(*) as count FROM agents WHERE is_default = 1', { count: 1 })
    mockDb._setResult('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?', { count: 0 })

    // Reset fs mocks
    mockReaddirSync.mockReturnValue([])
    mockStatSync.mockReturnValue({ size: 100, isDirectory: () => false })
    mockExistsSync.mockReturnValue(true)

    // Clear the directory listing cache between tests using the exported helper
    const mod = await import('../ipc-handlers')
    mod.clearDirListingCache()

    // Re-register handlers for the current test
    ipcHandlers.clear()
    mockIpcMain.handle.mockClear()
    mod.registerIpcHandlers()
  })

  it('r2-1: injects [Project File Structure] block when rootDirectory is set', async () => {
    // Mock the project config lookup to return a rootDirectory
    mockDb._setResult('SELECT config_json FROM projects WHERE id = ?', {
      config_json: JSON.stringify({ rootDirectory: '/home/user/myproject' })
    })

    // Make readdirSync return some representative files for the root
    mockReaddirSync.mockImplementation((p: unknown) => {
      if (p === '/home/user/myproject') return ['README.md', 'src']
      if (p === '/home/user/myproject/src') return ['index.ts']
      return []
    })
    mockStatSync.mockImplementation((p: unknown) => ({
      size: 100,
      isDirectory: () => (p as string).endsWith('src')
    }))

    await invoke('chat:send-message', 'conv-r2-1', 'Hello', { projectId: 'proj-1' })

    const userContent = capturedUserContent()
    expect(userContent).toBeDefined()
    expect(userContent).toContain('[Project File Structure]')
    expect(userContent).toContain('README.md')
    expect(userContent).toContain('src/')
    expect(userContent).toContain('[/Project File Structure]')
  })

  it('r2-2: does NOT inject file structure when rootDirectory is not set', async () => {
    // Project config has no rootDirectory
    mockDb._setResult('SELECT config_json FROM projects WHERE id = ?', {
      config_json: JSON.stringify({ instructions: 'Be helpful.', rootDirectory: '' })
    })

    await invoke('chat:send-message', 'conv-r2-2', 'Hello', { projectId: 'proj-1' })

    const userContent = capturedUserContent()
    expect(userContent).not.toContain('[Project File Structure]')
  })

  it('r2-3: does NOT inject file structure when no project is associated', async () => {
    await invoke('chat:send-message', 'conv-r2-3', 'Hello')

    const userContent = capturedUserContent() ?? ''
    expect(userContent).not.toContain('[Project File Structure]')
  })

  it('r2-4: cache prevents duplicate readdirSync calls for same project', async () => {
    mockDb._setResult('SELECT config_json FROM projects WHERE id = ?', {
      config_json: JSON.stringify({ rootDirectory: '/home/user/proj' })
    })
    mockReaddirSync.mockReturnValue(['main.ts'])

    // Send two messages for the same project
    await invoke('chat:send-message', 'conv-r2-4a', 'First message', { projectId: 'proj-cache' })
    await invoke('chat:send-message', 'conv-r2-4b', 'Second message', { projectId: 'proj-cache' })

    // readdirSync should be called only once (cache hit on second send)
    expect(mockReaddirSync).toHaveBeenCalledTimes(1)
  })

  it('r2-5: cache is invalidated when rootDirectory changes', async () => {
    // First send: rootDirectory = /old/path
    mockDb._setResult('SELECT config_json FROM projects WHERE id = ?', {
      config_json: JSON.stringify({ rootDirectory: '/old/path' })
    })
    mockReaddirSync.mockReturnValue(['old.ts'])

    await invoke('chat:send-message', 'conv-r2-5a', 'First', { projectId: 'proj-inv' })

    // Change rootDirectory
    mockDb._setResult('SELECT config_json FROM projects WHERE id = ?', {
      config_json: JSON.stringify({ rootDirectory: '/new/path' })
    })
    mockReaddirSync.mockReturnValue(['new.ts'])

    await invoke('chat:send-message', 'conv-r2-5b', 'Second', { projectId: 'proj-inv' })

    // readdirSync should have been called twice (cache miss due to path change)
    expect(mockReaddirSync).toHaveBeenCalledTimes(2)

    // Second message should have the new path entries
    const userContent = capturedUserContent()
    expect(userContent).toContain('new.ts')
  })
})

