import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentConfig } from '../../shared/types'

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockDb, ipcHandlers, mockIpcMain, mockDialog, mockRandomUUID, mockReadFileSync, mockWriteFileSync, mockWriteFile, mockReadFile } = vi.hoisted(() => {
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
    mockWriteFileSync: vi.fn(),
    mockWriteFile: vi.fn().mockResolvedValue(undefined),
    mockReadFile: vi.fn(),
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
  writeFileSync: mockWriteFileSync,
  existsSync: vi.fn(() => false)
}))

vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
  readFile: mockReadFile
}))

vi.mock('../ws-server', () => ({
  broadcastToMobile: vi.fn(),
  isMobileInForeground: vi.fn().mockReturnValue(false),
}))

vi.mock('../tools', () => ({
  drainPendingApprovals: vi.fn(),
  registerToolHandlers: vi.fn(),
  requestApproval: vi.fn(),
}))

// ── Test helpers ───────────────────────────────────────────────────────────────

const SAMPLE_CONFIG = {
  id: 'agent-abc',
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
  tools: {
    fileEdit: { enabled: false, approval: 'always-ask', instructions: '' },
    terminal: { enabled: false, approval: 'always-ask', instructions: '' },
    webFetch: { enabled: false, approval: 'always-ask', instructions: '' }
  },
  responseFormat: 'default'
} satisfies AgentConfig

const SAMPLE_ROW = {
  id: 'agent-abc',
  config_json: JSON.stringify(SAMPLE_CONFIG),
  is_default: 0,
  created_at: 1000,
  updated_at: 1000
}

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
      // First prepare: SELECT config_json FROM agents WHERE id = ? (reads previous config)
      mockDb.prepare.mockReturnValueOnce({ run: vi.fn(), get: vi.fn(() => undefined), all: vi.fn() })
      // Second prepare: UPDATE agents SET config_json = ? ...
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
    it('agent-m-4: removes agent, nulls conversations, returns success', async () => {
      const affectedProjectsAllFn = vi.fn(() => [])
      const affectedConvGetFn = vi.fn(() => ({ count: 0 }))
      const nullConvFn = vi.fn()
      const delFn = vi.fn()
      mockDb.prepare
        .mockReturnValueOnce({ run: vi.fn(), get: vi.fn(), all: affectedProjectsAllFn }) // affected projects
        .mockReturnValueOnce({ run: vi.fn(), get: affectedConvGetFn, all: vi.fn() })     // affected conv count
        .mockReturnValueOnce({ run: nullConvFn, get: vi.fn(), all: vi.fn() })            // NULL conversations
        .mockReturnValueOnce({ run: delFn, get: vi.fn(), all: vi.fn() })                 // DELETE agent

      const result = await invokeHandler('agent:delete', 'agent-abc')
      expect(result).toMatchObject({ success: true, affectedProjects: [], affectedConvCount: 0 })
      expect(delFn).toHaveBeenCalledWith('agent-abc')
      expect(nullConvFn).toHaveBeenCalledWith('agent-abc')
    })

    it('agent-m-5: deletes default agents (no longer blocked)', async () => {
      const affectedProjectsAllFn = vi.fn(() => [])
      const affectedConvGetFn = vi.fn(() => ({ count: 0 }))
      const nullConvFn = vi.fn()
      const delFn = vi.fn()
      mockDb.prepare
        .mockReturnValueOnce({ run: vi.fn(), get: vi.fn(), all: affectedProjectsAllFn })
        .mockReturnValueOnce({ run: vi.fn(), get: affectedConvGetFn, all: vi.fn() })
        .mockReturnValueOnce({ run: nullConvFn, get: vi.fn(), all: vi.fn() })
        .mockReturnValueOnce({ run: delFn, get: vi.fn(), all: vi.fn() })

      const result = await invokeHandler('agent:delete', 'default-agent')
      expect(result).toMatchObject({ success: true })
      expect(delFn).toHaveBeenCalledWith('default-agent')
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
      expect(mockWriteFile).toHaveBeenCalledWith(
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
      mockReadFile.mockResolvedValue(JSON.stringify({
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
      mockReadFile.mockResolvedValue('not valid json {{{')

      const result = await invokeHandler('agent:import')
      expect(result).toBeNull()
    })

    it('rejects JSON without name field', async () => {
      mockDialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/tmp/noname.json']
      })
      mockReadFile.mockResolvedValue(JSON.stringify({ icon: '🚀' }))

      const result = await invokeHandler('agent:import')
      expect(result).toBeNull()
    })

    it('returns null when user cancels dialog', async () => {
      mockDialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

      const result = await invokeHandler('agent:import')
      expect(result).toBeNull()
    })
  })

  // ── agent:delete-preflight ────────────────────────────────────────────────

  describe('agent:delete-preflight', () => {
    it('i-1: returns affected projects and conversation count without deleting', async () => {
      const affectedProjectsAllFn = vi.fn(() => [
        { id: 'proj-1', name: 'Alpha', is_primary: 1 },
        { id: 'proj-2', name: 'Beta', is_primary: 0 }
      ])
      const affectedConvGetFn = vi.fn(() => ({ count: 7 }))
      const affectedProjectsRunFn = vi.fn()
      const affectedConvRunFn = vi.fn()
      mockDb.prepare
        .mockReturnValueOnce({ run: affectedProjectsRunFn, get: vi.fn(), all: affectedProjectsAllFn })
        .mockReturnValueOnce({ run: affectedConvRunFn, get: affectedConvGetFn, all: vi.fn() })

      const result = await invokeHandler('agent:delete-preflight', 'agent-x')
      expect(result).toMatchObject({
        affectedProjects: [
          { id: 'proj-1', name: 'Alpha', is_primary: 1 },
          { id: 'proj-2', name: 'Beta', is_primary: 0 }
        ],
        affectedConvCount: 7
      })
      // No DELETE / UPDATE should have been called
      expect(affectedProjectsRunFn).not.toHaveBeenCalled()
      expect(affectedConvRunFn).not.toHaveBeenCalled()
    })

    it('i-2: returns empty impact for an agent with no memberships or conversations', async () => {
      mockDb.prepare
        .mockReturnValueOnce({ run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) })
        .mockReturnValueOnce({ run: vi.fn(), get: vi.fn(() => ({ count: 0 })), all: vi.fn() })

      const result = await invokeHandler('agent:delete-preflight', 'lone-agent')
      expect(result).toMatchObject({ affectedProjects: [], affectedConvCount: 0 })
    })
  })

  // ── agent:delete enhanced ─────────────────────────────────────────────────

  describe('agent:delete (enhanced)', () => {
    it('i-3: includes affected project list in success result', async () => {
      const affectedProjectsAllFn = vi.fn(() => [
        { id: 'proj-1', name: 'Alpha', is_primary: 1 }
      ])
      const affectedConvGetFn = vi.fn(() => ({ count: 3 }))
      const nullConvFn = vi.fn()
      const delFn = vi.fn()
      mockDb.prepare
        .mockReturnValueOnce({ run: vi.fn(), get: vi.fn(), all: affectedProjectsAllFn })
        .mockReturnValueOnce({ run: vi.fn(), get: affectedConvGetFn, all: vi.fn() })
        .mockReturnValueOnce({ run: nullConvFn, get: vi.fn(), all: vi.fn() })
        .mockReturnValueOnce({ run: delFn, get: vi.fn(), all: vi.fn() })

      const result = await invokeHandler('agent:delete', 'agent-in-project')
      expect(result).toMatchObject({
        success: true,
        affectedProjects: [{ id: 'proj-1', name: 'Alpha', is_primary: 1 }],
        affectedConvCount: 3
      })
      expect(nullConvFn).toHaveBeenCalledWith('agent-in-project')
      expect(delFn).toHaveBeenCalledWith('agent-in-project')
    })

    it('i-4: deleting non-existent agent is idempotent (success with empty impact)', async () => {
      const affectedProjectsAllFn = vi.fn(() => [])
      const affectedConvGetFn = vi.fn(() => ({ count: 0 }))
      const nullConvFn = vi.fn()
      const delFn = vi.fn()
      mockDb.prepare
        .mockReturnValueOnce({ run: vi.fn(), get: vi.fn(), all: affectedProjectsAllFn })
        .mockReturnValueOnce({ run: vi.fn(), get: affectedConvGetFn, all: vi.fn() })
        .mockReturnValueOnce({ run: nullConvFn, get: vi.fn(), all: vi.fn() })
        .mockReturnValueOnce({ run: delFn, get: vi.fn(), all: vi.fn() })

      const result = await invokeHandler('agent:delete', 'ghost-agent')
      expect(result).toMatchObject({ success: true, affectedProjects: [], affectedConvCount: 0 })
    })
  })
})
