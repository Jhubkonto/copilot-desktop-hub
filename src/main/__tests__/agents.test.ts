import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockDb, ipcHandlers, mockIpcMain, mockDialog, mockRandomUUID, mockReadFileSync, mockWriteFileSync } = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()

  const stmtResults = new Map<string, unknown>()

  const mockDb = {
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((..._args: unknown[]) => ({ changes: 1 })),
      get: vi.fn((..._args: unknown[]): unknown => {
        return stmtResults.get(sql) ?? undefined
      }),
      all: vi.fn((): unknown[] => {
        return (stmtResults.get(sql) as unknown[]) ?? []
      })
    })),
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
    },
    mockDialog: {
      showSaveDialog: vi.fn(),
      showOpenDialog: vi.fn()
    },
    mockRandomUUID: vi.fn(() => 'test-uuid-1234'),
    mockReadFileSync: vi.fn(),
    mockWriteFileSync: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  dialog: mockDialog,
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{}])
  }
}))

vi.mock('../database', () => ({
  getDatabase: () => mockDb
}))

vi.mock('../safe-handle', () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    mockIpcMain.handle(channel, handler)
  }
}))

vi.mock('crypto', () => ({
  randomUUID: mockRandomUUID
}))

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync
}))

// ── Test helpers ───────────────────────────────────────────────────────────────

const SAMPLE_CONFIG = {
  name: 'Test Agent',
  icon: '🧪',
  systemPrompt: 'You are a test agent.',
  model: 'gpt-4o',
  temperature: 0.5,
  maxTokens: 8192,
  contextDirectories: [],
  contextFiles: [],
  mcpServers: [],
  agenticMode: false,
  tools: { fileEdit: false, terminal: false, webFetch: false },
  responseFormat: 'default'
}

const SAMPLE_ROW = {
  id: 'agent-abc',
  config_json: JSON.stringify(SAMPLE_CONFIG),
  is_default: 0,
  created_at: 1000,
  updated_at: 1000
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invokeHandler(channel: string, ...args: unknown[]): Promise<any> {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  const event = {}
  return handler(event, ...args)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Agents — IPC Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcHandlers.clear()
    mockDb._clearResults()

    // Default: no existing default agents → seed will run
    mockDb._setResult(
      'SELECT COUNT(*) as count FROM agents WHERE is_default = 1',
      { count: 0 }
    )

    // Import and register handlers
    return import('../agents').then((mod) => {
      // Clear module cache so registerAgentHandlers runs fresh
      mod.registerAgentHandlers()
    })
  })

  describe('agent:list', () => {
    it('agent-m-1: returns all agents including defaults', async () => {
      const rows = [
        { id: 'a1', config_json: JSON.stringify({ name: 'General Assistant', icon: '🤖' }), is_default: 1, created_at: 100, updated_at: 100 },
        { id: 'a2', config_json: JSON.stringify({ name: 'Custom Agent', icon: '🧪' }), is_default: 0, created_at: 200, updated_at: 200 }
      ]
      mockDb.prepare.mockReturnValueOnce({
        run: vi.fn(), get: vi.fn(), all: vi.fn(() => rows)
      })

      const result = await invokeHandler('agent:list')
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ id: 'a1', name: 'General Assistant', isDefault: true })
      expect(result[1]).toMatchObject({ id: 'a2', name: 'Custom Agent', isDefault: false })
    })
  })

  describe('agent:create', () => {
    it('agent-m-2: persists agent config and returns ID', async () => {
      const runFn = vi.fn()
      mockDb.prepare.mockReturnValueOnce({ run: runFn, get: vi.fn(), all: vi.fn() })

      const result = await invokeHandler('agent:create', SAMPLE_CONFIG)
      expect(result).toMatchObject({
        ...SAMPLE_CONFIG,
        id: 'test-uuid-1234',
        isDefault: false
      })
      expect(runFn).toHaveBeenCalledWith(
        'test-uuid-1234',
        JSON.stringify(SAMPLE_CONFIG),
        expect.any(Number),
        expect.any(Number)
      )
    })
  })

  describe('agent:update', () => {
    it('agent-m-3: updates existing agent in DB', async () => {
      const runFn = vi.fn()
      mockDb.prepare.mockReturnValueOnce({ run: runFn, get: vi.fn(), all: vi.fn() })

      const updated = { ...SAMPLE_CONFIG, name: 'Updated Agent' }
      const result = await invokeHandler('agent:update', 'agent-abc', updated)
      expect(result).toMatchObject({ ...updated, id: 'agent-abc' })
      expect(runFn).toHaveBeenCalledWith(
        JSON.stringify(updated),
        expect.any(Number),
        'agent-abc'
      )
    })
  })

  describe('agent:delete', () => {
    it('agent-m-4: removes non-default agent', async () => {
      const getFn = vi.fn(() => ({ is_default: 0 }))
      const delFn = vi.fn()
      const cascadeFn = vi.fn()
      mockDb.prepare
        .mockReturnValueOnce({ run: vi.fn(), get: getFn, all: vi.fn() })
        .mockReturnValueOnce({ run: delFn, get: vi.fn(), all: vi.fn() })
        .mockReturnValueOnce({ run: cascadeFn, get: vi.fn(), all: vi.fn() })

      const result = await invokeHandler('agent:delete', 'agent-abc')
      expect(result).toBe(true)
      expect(delFn).toHaveBeenCalledWith('agent-abc')
      expect(cascadeFn).toHaveBeenCalledWith('agent-abc')
    })

    it('agent-m-5: rejects deletion of default agents', async () => {
      const getFn = vi.fn(() => ({ is_default: 1 }))
      mockDb.prepare.mockReturnValueOnce({ run: vi.fn(), get: getFn, all: vi.fn() })

      const result = await invokeHandler('agent:delete', 'default-agent')
      expect(result).toBe(false)
    })
  })

  describe('agent:duplicate', () => {
    it('agent-m-6: creates copy with "(copy)" suffix', async () => {
      const getFn = vi.fn(() => SAMPLE_ROW)
      const runFn = vi.fn()
      mockDb.prepare
        .mockReturnValueOnce({ run: vi.fn(), get: getFn, all: vi.fn() })
        .mockReturnValueOnce({ run: runFn, get: vi.fn(), all: vi.fn() })

      const result = await invokeHandler('agent:duplicate', 'agent-abc')
      expect(result).toMatchObject({
        name: 'Test Agent (copy)',
        id: 'test-uuid-1234',
        isDefault: false
      })
      expect(runFn).toHaveBeenCalled()
    })

    it('returns null for non-existent agent', async () => {
      const getFn = vi.fn(() => undefined)
      mockDb.prepare.mockReturnValueOnce({ run: vi.fn(), get: getFn, all: vi.fn() })

      const result = await invokeHandler('agent:duplicate', 'missing')
      expect(result).toBeNull()
    })
  })

  describe('agent:export', () => {
    it('agent-m-7: writes JSON file to selected path', async () => {
      const getFn = vi.fn(() => SAMPLE_ROW)
      mockDb.prepare.mockReturnValueOnce({ run: vi.fn(), get: getFn, all: vi.fn() })
      mockDialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/agent.json' })

      const result = await invokeHandler('agent:export', 'agent-abc')
      expect(result).toBe(true)
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/tmp/agent.json',
        expect.stringContaining('"Test Agent"'),
        'utf-8'
      )
    })

    it('returns false when user cancels dialog', async () => {
      const getFn = vi.fn(() => SAMPLE_ROW)
      mockDb.prepare.mockReturnValueOnce({ run: vi.fn(), get: getFn, all: vi.fn() })
      mockDialog.showSaveDialog.mockResolvedValue({ canceled: true })

      const result = await invokeHandler('agent:export', 'agent-abc')
      expect(result).toBe(false)
    })
  })

  describe('agent:import', () => {
    it('agent-m-8: reads and validates JSON file', async () => {
      mockDialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/tmp/import.json']
      })
      mockReadFileSync.mockReturnValue(JSON.stringify({
        name: 'Imported Agent',
        icon: '🚀',
        systemPrompt: 'Hello',
        temperature: 0.9
      }))
      const runFn = vi.fn()
      mockDb.prepare.mockReturnValueOnce({ run: runFn, get: vi.fn(), all: vi.fn() })

      const result = await invokeHandler('agent:import')
      expect(result).toMatchObject({
        name: 'Imported Agent',
        icon: '🚀',
        id: 'test-uuid-1234',
        isDefault: false
      })
    })

    it('agent-m-9: rejects invalid JSON', async () => {
      mockDialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/tmp/bad.json']
      })
      mockReadFileSync.mockReturnValue('not valid json {{{')

      const result = await invokeHandler('agent:import')
      expect(result).toBeNull()
    })

    it('rejects JSON without name field', async () => {
      mockDialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/tmp/noname.json']
      })
      mockReadFileSync.mockReturnValue(JSON.stringify({ icon: '🚀' }))

      const result = await invokeHandler('agent:import')
      expect(result).toBeNull()
    })

    it('returns null when user cancels dialog', async () => {
      mockDialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

      const result = await invokeHandler('agent:import')
      expect(result).toBeNull()
    })
  })
})
