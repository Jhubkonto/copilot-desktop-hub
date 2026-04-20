import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/* ── Hoisted mocks ─────────────────────────────────────────── */
const { mockIpcMain, mockDb, mockBrowserWindow, mockExistsSync, mockReadFileSync, mockWriteFileSync, mockExec } = vi.hoisted(() => {
  const store = new Map<string, string>()
  const handlers = new Map<string, (...args: unknown[]) => unknown>()

  const mockIpcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    _handlers: handlers
  }

  const mockDb = {
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT OR REPLACE INTO settings') && sql.includes('VALUES (?, ?)')) {
          store.set(args[0] as string, args[1] as string)
        }
        if (sql.includes('DELETE FROM settings')) {
          store.delete(args[0] as string)
        }
        return { changes: 1 }
      }),
      get: vi.fn((...args: unknown[]): { value: string } | undefined => {
        if (sql.includes('WHERE key = ?') && args[0]) {
          const val = store.get(args[0] as string)
          return val !== undefined ? { value: val } : undefined
        }
        return undefined
      }),
      all: vi.fn(() => {
        if (sql.includes("LIKE 'tool_pref:%'")) {
          const prefs: { key: string; value: string }[] = []
          for (const [k, v] of store) {
            if (k.startsWith('tool_pref:')) prefs.push({ key: k, value: v })
          }
          return prefs
        }
        return []
      })
    })),
    _store: store
  }

  const mockBrowserWindow = {
    fromWebContents: vi.fn(() => ({
      webContents: {
        send: vi.fn()
      }
    }))
  }

  return {
    mockIpcMain,
    mockDb,
    mockBrowserWindow,
    mockExistsSync: vi.fn(),
    mockReadFileSync: vi.fn(),
    mockWriteFileSync: vi.fn(),
    mockExec: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  BrowserWindow: mockBrowserWindow
}))

vi.mock('../database', () => ({
  getDatabase: () => mockDb
}))

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync
}))

vi.mock('child_process', () => ({
  exec: mockExec
}))

/* ── Helpers ─────────────────────────────────────────── */
async function invokeHandler(channel: string, ...args: unknown[]): Promise<any> {
  const handler = mockIpcMain._handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  const fakeEvent = { sender: { id: 1 } }
  return handler(fakeEvent, ...args)
}

/* ── Import & Register ─────────────────────────────────────── */
import { registerToolHandlers, executeTool, TOOL_DEFINITIONS } from '../tools'

beforeEach(() => {
  mockDb._store.clear()
  vi.clearAllMocks()
  registerToolHandlers()
})

/* ── Tests ─────────────────────────────────────── */
describe('Tools — TOOL_DEFINITIONS', () => {
  it('exports 4 built-in tool definitions', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(4)
    const names = TOOL_DEFINITIONS.map((t) => t.name)
    expect(names).toEqual(['fileRead', 'fileWrite', 'shellExec', 'webFetch'])
  })
})

describe('Tools — executeTool', () => {
  it('fileRead returns file content', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('hello world')
    const r = await executeTool('fileRead', { path: '/tmp/test.txt' })
    expect(r.success).toBe(true)
    expect(r.result).toBe('hello world')
  })

  it('fileRead returns error for missing file', async () => {
    mockExistsSync.mockReturnValue(false)
    const r = await executeTool('fileRead', { path: '/tmp/nope.txt' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('File not found')
  })

  it('fileRead truncates large files', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('x'.repeat(200000))
    const r = await executeTool('fileRead', { path: '/tmp/big.txt' })
    expect(r.success).toBe(true)
    expect(r.result).toContain('truncated')
    expect(r.result!.length).toBeLessThan(200000)
  })

  it('fileWrite writes content and returns success', async () => {
    const r = await executeTool('fileWrite', { path: '/tmp/out.txt', content: 'data' })
    expect(r.success).toBe(true)
    expect(r.result).toContain('4 characters')
    expect(mockWriteFileSync).toHaveBeenCalledWith('/tmp/out.txt', 'data', 'utf-8')
  })

  it('shellExec runs command and returns stdout', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, 'output text', '')
    })
    const r = await executeTool('shellExec', { command: 'echo hi' })
    expect(r.success).toBe(true)
    expect(r.result).toBe('output text')
  })

  it('shellExec returns error on failure with no output', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(new Error('command failed'), '', '')
    })
    const r = await executeTool('shellExec', { command: 'bad' })
    expect(r.success).toBe(false)
    expect(r.error).toBe('command failed')
  })

  it('unknown tool returns error', async () => {
    const r = await executeTool('nonexistent', {})
    expect(r.success).toBe(false)
    expect(r.error).toContain('Unknown tool')
  })
})

describe('Tools — IPC Handlers', () => {
  it('tool:list returns definitions', async () => {
    const r = await invokeHandler('tool:list')
    expect(r).toEqual(TOOL_DEFINITIONS)
  })

  it('tool:execute with always_allow preference runs immediately', async () => {
    mockDb._store.set('tool_pref:fileRead', 'always_allow')
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('content')

    const r = await invokeHandler('tool:execute', 'fileRead', { path: '/test.txt' })
    expect(r.success).toBe(true)
  })

  it('tool:execute with always_deny preference rejects', async () => {
    mockDb._store.set('tool_pref:shellExec', 'always_deny')

    const r = await invokeHandler('tool:execute', 'shellExec', { command: 'rm -rf /' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('denied')
  })

  it('tool:set-preference stores preference', async () => {
    await invokeHandler('tool:set-preference', 'fileRead', 'always_allow')
    expect(mockDb._store.get('tool_pref:fileRead')).toBe('always_allow')
  })

  it('tool:get-preferences returns all stored prefs', async () => {
    mockDb._store.set('tool_pref:fileRead', 'always_allow')
    mockDb._store.set('tool_pref:shellExec', 'always_deny')

    const r = await invokeHandler('tool:get-preferences')
    expect(r).toEqual({ fileRead: 'always_allow', shellExec: 'always_deny' })
  })

  it('tool:approval-response resolves pending approval and remembers pref', async () => {
    // We need to trigger an approval flow — send tool:execute without pref
    // The execute call will hang waiting for approval
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('data')

    // Get the window mock to capture the requestId
    const sendMock = vi.fn()
    mockBrowserWindow.fromWebContents.mockReturnValue({
      webContents: { send: sendMock }
    })

    // Start execute — it will wait for approval
    const executePromise = invokeHandler('tool:execute', 'fileRead', { path: '/test.txt' })

    // Wait for the approval request to be sent
    await new Promise((r) => setTimeout(r, 50))

    // Get the requestId from the send call
    const approvalCall = sendMock.mock.calls.find(
      (c: unknown[]) => c[0] === 'tool:request-approval'
    )
    expect(approvalCall).toBeDefined()
    const requestId = approvalCall![1].requestId

    // Approve with remember=true
    await invokeHandler('tool:approval-response', requestId, true, true)

    const result = await executePromise
    expect(result.success).toBe(true)
    // Preference should be stored
    expect(mockDb._store.get('tool_pref:fileRead')).toBe('always_allow')
  })
})
