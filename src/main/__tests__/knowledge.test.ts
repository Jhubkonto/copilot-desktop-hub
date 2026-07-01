import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockDb, ipcHandlers, mockIpcMain, mockRandomUUID, mockExistsSync, mockReadFileSync, mockWriteFileSync } =
  vi.hoisted(() => {
    const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
    const stmtResults = new Map<string, unknown>()

    const mockDb = {
      prepare: vi.fn((sql: string) => ({
        run: vi.fn((..._args: unknown[]) => ({ changes: 1 })),
        get: vi.fn((..._args: unknown[]): unknown => stmtResults.get(sql) ?? undefined),
        all: vi.fn((): unknown[] => (stmtResults.get(sql) as unknown[]) ?? [])
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
      mockRandomUUID: vi.fn(() => 'test-uuid-1234'),
      mockExistsSync: vi.fn(() => true),
      mockReadFileSync: vi.fn(() => '# File Content'),
      mockWriteFileSync: vi.fn()
    }
  })

const { mockInferProjectAuditTarget, mockRecordProjectAuditChange } = vi.hoisted(() => ({
  mockInferProjectAuditTarget: vi.fn(),
  mockRecordProjectAuditChange: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => [{}]) }
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
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync
}))

vi.mock('../project-audit', () => ({
  inferProjectAuditTarget: mockInferProjectAuditTarget,
  recordProjectAuditChange: mockRecordProjectAuditChange,
}))

// ── Helpers ────────────────────────────────────────────────────────────────────

async function invokeHandler(channel: string, ...args: unknown[]): Promise<any> {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`No handler for channel: ${channel}`)
  return handler({}, ...args)
}

const SAMPLE_FILE_ROW = {
  id: 'kf-1',
  agent_id: 'agent-1',
  file_path: '/docs/notes.md',
  inject_mode: 'always',
  sort_order: 0,
  created_at: 1000,
  updated_at: 1000
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Knowledge — IPC Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcHandlers.clear()
    mockDb._clearResults()
    mockInferProjectAuditTarget.mockReturnValue(null)
    // Re-register handlers fresh each test
    return import('../knowledge').then((mod) => mod.registerKnowledgeHandlers())
  })

  describe('agent:list-knowledge-files', () => {
    it('kf-m-1: returns all registered files for the agent in sort order', async () => {
      mockDb._setResult(
        'SELECT * FROM agent_knowledge_files WHERE agent_id = ? ORDER BY sort_order ASC, created_at ASC',
        [SAMPLE_FILE_ROW]
      )
      const result = await invokeHandler('agent:list-knowledge-files', 'agent-1')
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ id: 'kf-1', file_path: '/docs/notes.md' })
    })
  })

  describe('agent:add-knowledge-file', () => {
    it('kf-m-2: inserts file and returns new row', async () => {
      const newRow = { ...SAMPLE_FILE_ROW, id: 'test-uuid-1234', sort_order: 0 }
      mockDb._setResult(
        'SELECT MAX(sort_order) as m FROM agent_knowledge_files WHERE agent_id = ?',
        { m: null }
      )
      mockDb._setResult(
        'SELECT * FROM agent_knowledge_files WHERE id = ?',
        newRow
      )

      const result = await invokeHandler(
        'agent:add-knowledge-file',
        'agent-1',
        '/docs/notes.md',
        'always'
      )

      expect(result).toMatchObject({ id: 'test-uuid-1234', file_path: '/docs/notes.md' })
    })

    it('kf-m-2b: defaults to "always" inject mode when mode is omitted', async () => {
      mockDb._setResult(
        'SELECT MAX(sort_order) as m FROM agent_knowledge_files WHERE agent_id = ?',
        { m: null }
      )
      mockDb._setResult('SELECT * FROM agent_knowledge_files WHERE id = ?', SAMPLE_FILE_ROW)

      const insertStmt = { run: vi.fn(), get: vi.fn(), all: vi.fn() }
      mockDb.prepare
        .mockReturnValueOnce({ run: vi.fn(), get: vi.fn().mockReturnValueOnce({ m: null }), all: vi.fn() })
        .mockReturnValueOnce(insertStmt)
        .mockReturnValueOnce({ run: vi.fn(), get: vi.fn().mockReturnValueOnce(SAMPLE_FILE_ROW), all: vi.fn() })

      await invokeHandler('agent:add-knowledge-file', 'agent-1', '/docs/notes.md')
      // Third prepare call is the final SELECT; second is the INSERT
      const insertCall = insertStmt.run.mock.calls[0] as unknown[]
      expect(insertCall).toContain('always')
    })
  })

  describe('agent:remove-knowledge-file', () => {
    it('kf-m-3: deletes the file record and returns true', async () => {
      const runFn = vi.fn()
      mockDb.prepare.mockReturnValueOnce({ run: runFn, get: vi.fn(), all: vi.fn() })

      const result = await invokeHandler('agent:remove-knowledge-file', 'kf-1')
      expect(result).toBe(true)
      expect(runFn).toHaveBeenCalledWith('kf-1')
    })
  })

  describe('agent:update-knowledge-inject-mode', () => {
    it('kf-m-4: updates inject_mode for a file and returns true', async () => {
      const runFn = vi.fn()
      mockDb.prepare.mockReturnValueOnce({ run: runFn, get: vi.fn(), all: vi.fn() })

      const result = await invokeHandler('agent:update-knowledge-inject-mode', 'kf-1', 'on-demand')
      expect(result).toBe(true)
      expect(runFn).toHaveBeenCalledWith('on-demand', expect.any(Number), 'kf-1')
    })
  })

  describe('fs:read-file', () => {
    it('kf-m-5: reads and returns file content for a registered file', async () => {
      mockDb._setResult(
        'SELECT id FROM agent_knowledge_files WHERE agent_id = ? AND file_path = ?',
        { id: 'kf-1' }
      )
      mockReadFileSync.mockReturnValueOnce('# My Notes')

      const result = await invokeHandler('fs:read-file', 'agent-1', '/docs/notes.md')
      expect(result).toBe('# My Notes')
      expect(mockReadFileSync).toHaveBeenCalledWith('/docs/notes.md', 'utf-8')
    })

    it('kf-m-6: throws when file is not registered for the agent', async () => {
      // default _setResult for validation query is undefined → not found
      await expect(
        invokeHandler('fs:read-file', 'agent-1', '/docs/unregistered.md')
      ).rejects.toThrow('File not registered for this agent')
    })

    it('kf-m-6b: throws when file does not exist on disk', async () => {
      mockDb._setResult(
        'SELECT id FROM agent_knowledge_files WHERE agent_id = ? AND file_path = ?',
        { id: 'kf-1' }
      )
      mockExistsSync.mockReturnValueOnce(false)

      await expect(
        invokeHandler('fs:read-file', 'agent-1', '/docs/notes.md')
      ).rejects.toThrow('File not found')
    })
  })

  describe('fs:write-file', () => {
    it('kf-m-7: writes content to a registered file and returns true', async () => {
      mockDb._setResult(
        'SELECT id FROM agent_knowledge_files WHERE agent_id = ? AND file_path = ?',
        { id: 'kf-1' }
      )

      const result = await invokeHandler(
        'fs:write-file',
        'agent-1',
        '/docs/notes.md',
        '# Updated Content'
      )
      expect(result).toBe(true)
      expect(mockWriteFileSync).toHaveBeenCalledWith('/docs/notes.md', '# Updated Content', 'utf-8')
    })

    it('kf-m-7b: records project audit entries for project-scoped knowledge writes', async () => {
      mockDb._setResult(
        'SELECT id FROM agent_knowledge_files WHERE agent_id = ? AND file_path = ?',
        { id: 'kf-1' }
      )
      mockInferProjectAuditTarget.mockReturnValue({ projectId: 'proj-1', relativePath: 'docs/notes.md' })

      const result = await invokeHandler(
        'fs:write-file',
        'agent-1',
        '/docs/notes.md',
        '# Updated Content'
      )

      expect(result).toBe(true)
      expect(mockRecordProjectAuditChange).toHaveBeenCalledWith(expect.objectContaining({
        projectId: 'proj-1',
        agentId: 'agent-1',
        title: 'Knowledge file update',
        source: 'manual-apply',
        relativePath: 'docs/notes.md',
      }))
    })

    it('kf-m-8: throws when file is not registered for the agent', async () => {
      await expect(
        invokeHandler('fs:write-file', 'agent-1', '/docs/unregistered.md', 'content')
      ).rejects.toThrow('File not registered for this agent')
    })
  })
})
