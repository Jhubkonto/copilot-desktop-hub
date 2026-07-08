import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockDb, ipcHandlers, mockIpcMain } = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()

  // Simple default stmt: run returns changes:1, get/all return undefined/[]
  const makeStmt = () => ({
    run: vi.fn(() => ({ changes: 1 })),
    get: vi.fn(() => undefined),
    all: vi.fn(() => []),
  })

  const mockDb = {
    prepare: vi.fn(() => makeStmt()),
    transaction: vi.fn((fn: () => unknown) => fn),
  }

  return {
    mockDb,
    ipcHandlers,
    mockIpcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcHandlers.set(channel, handler)
      }),
      removeHandler: vi.fn(),
    },
  }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  BrowserWindow: class {},
  shell: { showItemInFolder: vi.fn() },
}))

vi.mock('../database', () => ({
  getDatabase: () => mockDb,
}))

vi.mock('../safe-handle', () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    mockIpcMain.handle(channel, handler)
  },
}))

vi.mock('../artifact-export', () => ({
  exportArtifactVersion: vi.fn().mockResolvedValue('/tmp/export/path'),
}))

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 123 })),
  writeFileSync: vi.fn(),
}))

beforeEach(async () => {
  vi.clearAllMocks()
  ipcHandlers.clear()
  // Reset prepare to default stmt
  mockDb.prepare.mockReset()
  mockDb.transaction.mockReset()
  mockDb.transaction.mockImplementation((fn: () => unknown) => fn)
  mockDb.prepare.mockImplementation(() => ({
    run: vi.fn(() => ({ changes: 1 })),
    get: vi.fn(() => undefined),
    all: vi.fn(() => []),
  }))
  const { registerArtifactHandlers } = await import('../artifacts')
  registerArtifactHandlers()
})

// ── artifact:move-to-project ─────────────────────────────────────────────────

describe('artifact:move-to-project', () => {
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = ipcHandlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({} as Electron.IpcMainInvokeEvent, ...args)
  }

  it('returns { ok: true } when artifact is moved to a project', () => {
    const result = invoke('artifact:move-to-project', 'art-1', 'proj-1')
    expect(result).toEqual({ ok: true })
  })

  it('passes artifactId and projectId to UPDATE query', () => {
    invoke('artifact:move-to-project', 'art-1', 'proj-1')
    const calls = mockDb.prepare.mock.calls.map((c: unknown[]) => String(c[0]))
    const updateCall = calls.find((s: string) => s.includes('UPDATE artifacts SET project_id'))
    expect(updateCall).toBeDefined()
    expect(updateCall).toContain('project_id = ?')
  })

  it('returns { ok: false } when no rows updated (missing artifact)', () => {
    mockDb.prepare.mockImplementationOnce(() => ({
      run: vi.fn(() => ({ changes: 0 })),
      get: vi.fn(() => undefined),
      all: vi.fn(() => []),
    }))
    const result = invoke('artifact:move-to-project', 'nonexistent', 'proj-1')
    expect(result).toEqual({ ok: false })
  })

  it('sets project_id to NULL when projectId is null', () => {
    invoke('artifact:move-to-project', 'art-1', null)
    const calls = mockDb.prepare.mock.calls.map((c: unknown[]) => String(c[0]))
    const updateCall = calls.find((s: string) => s.includes('project_id = NULL'))
    expect(updateCall).toBeDefined()
  })
})

// ── artifact:list ────────────────────────────────────────────────────────────

describe('artifact:list', () => {
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = ipcHandlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({} as Electron.IpcMainInvokeEvent, ...args)
  }

  it('queries every artifact regardless of project when no projectId given', () => {
    invoke('artifact:list')
    const calls = mockDb.prepare.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(calls.some((s: string) => s.includes('FROM artifacts') && !s.includes('WHERE'))).toBe(true)
  })

  it('queries project-scoped artifacts when projectId given', () => {
    invoke('artifact:list', 'proj-1')
    const calls = mockDb.prepare.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(calls.some((s: string) => s.includes('project_id = ?'))).toBe(true)
  })

  it('returns an empty array when no rows exist', () => {
    const result = invoke('artifact:list')
    expect(result).toEqual([])
  })
})

// ── artifact:delete ──────────────────────────────────────────────────────────

describe('artifact:delete', () => {
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = ipcHandlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({} as Electron.IpcMainInvokeEvent, ...args)
  }

  it('returns { deleted: true } when artifact exists', () => {
    const result = invoke('artifact:delete', 'art-1')
    expect(result).toEqual({ deleted: true })
  })

  it('returns { deleted: false } when artifact does not exist', () => {
    mockDb.prepare.mockImplementationOnce(() => ({
      run: vi.fn(() => ({ changes: 0 })),
      get: vi.fn(() => undefined),
      all: vi.fn(() => []),
    }))
    const result = invoke('artifact:delete', 'nonexistent')
    expect(result).toEqual({ deleted: false })
  })
})

// ── artifact:promote-message ────────────────────────────────────────────────

describe('artifact:promote-message', () => {
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = ipcHandlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({} as Electron.IpcMainInvokeEvent, ...args)
  }

  it('promotes an assistant message into a saved artifact', () => {
    const statements: Record<string, { get?: ReturnType<typeof vi.fn>; run?: ReturnType<typeof vi.fn>; all?: ReturnType<typeof vi.fn> }> = {}
    mockDb.prepare.mockImplementation(((sql: string) => {
      if (sql.includes('FROM messages m')) {
        return {
          get: vi.fn(() => ({
            id: 'msg-1',
            conversation_id: 'conv-1',
            role: 'assistant',
            content: '# Draft Plan\nShip it.',
            conversation_title: 'Roadmap chat',
            conversation_project_id: 'proj-1',
          })),
          run: vi.fn(() => ({ changes: 1 })),
          all: vi.fn(() => []),
        }
      }
      const stmt = {
        get: vi.fn(() => undefined),
        run: vi.fn(() => ({ changes: 1 })),
        all: vi.fn(() => []),
      }
      statements[sql] = stmt
      return stmt
    }) as never)

    const result = invoke('artifact:promote-message', {
      conversationId: 'conv-1',
      messageId: 'msg-1',
      title: 'Plan Export',
      kind: 'plan',
      scope: { type: 'project', projectId: 'proj-1' },
      filePath: 'output.md',
    })

    expect(result).toMatchObject({ title: 'Plan Export' })
    const calls = mockDb.prepare.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(calls.some((sql) => sql.includes('INSERT INTO artifacts'))).toBe(true)
    expect(calls.some((sql) => sql.includes('INSERT INTO artifact_versions'))).toBe(true)
    expect(calls.some((sql) => sql.includes('INSERT INTO artifact_files'))).toBe(true)
    expect(calls.some((sql) => sql.includes('INSERT INTO artifact_chat_refs'))).toBe(true)
  })

  it('rejects non-assistant messages', () => {
    mockDb.prepare.mockImplementation(((sql: string) => {
      if (sql.includes('FROM messages m')) {
        return {
          get: vi.fn(() => ({
            id: 'msg-1',
            conversation_id: 'conv-1',
            role: 'user',
            content: 'hello',
            conversation_title: 'Chat',
            conversation_project_id: null,
          })),
          run: vi.fn(() => ({ changes: 1 })),
          all: vi.fn(() => []),
        }
      }
      return {
        get: vi.fn(() => undefined),
        run: vi.fn(() => ({ changes: 1 })),
        all: vi.fn(() => []),
      }
    }) as never)

    expect(() => invoke('artifact:promote-message', {
      conversationId: 'conv-1',
      messageId: 'msg-1',
      title: 'Title',
      kind: 'document',
      scope: { type: 'global' },
      filePath: 'output.md',
    })).toThrow('Only assistant messages can be saved as artifacts')
  })
})
