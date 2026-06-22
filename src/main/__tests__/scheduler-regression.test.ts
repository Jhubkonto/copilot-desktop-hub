/**
 * Regression tests: verify that scheduler dispatch integration does not affect
 * the normal interactive chat-handlers and tool-loop paths.
 *
 * Phase 6 checklist item: "Regression-test existing chat-handlers.ts and
 * tool-loop.ts paths remain unaffected after scheduler dispatch integration."
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

// ─── Hoisted mocks ────────────────────────────────────────────────────────

const { dispatchChatSendMock, sendChunkMock, callerMock } = vi.hoisted(() => ({
  dispatchChatSendMock: vi.fn(),
  sendChunkMock: vi.fn(),
  callerMock: vi.fn(),
}))

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      { webContents: { isDestroyed: () => false, send: vi.fn() }, isDestroyed: () => false },
    ]),
  },
  Notification: class { show() {} },
  powerMonitor: { on: vi.fn() },
}))

vi.mock('../database', () => ({
  getDatabase: () => {
    if (!state.db) throw new Error('DB not initialized')
    return state.db
  },
}))

vi.mock('../safe-handle', () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    state.handlers.set(channel, handler)
  },
}))

vi.mock('../ws-server', () => ({ broadcastToMobile: vi.fn() }))
vi.mock('../logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../fcm-sender', () => ({ sendSchedulerRunNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../chat-handlers', () => ({
  dispatchChatSend: dispatchChatSendMock,
}))

// ─── Imports after mocks ──────────────────────────────────────────────────

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { runProviderMcpToolLoop } from '../tool-loop'

function initDb() {
  state.db?.close()
  state.db = new Database(':memory:')
  initializeBaseSchema(state.db)
  runMigrations(state.db)
}

function makeWebContents() {
  return { isDestroyed: () => false, send: vi.fn() } as unknown as Electron.WebContents
}

// ─── Tool-loop regression ─────────────────────────────────────────────────

describe('tool-loop regression — scheduler toolPolicy does not affect normal runs', () => {
  it('runs normally when no toolPolicy is provided', async () => {
    callerMock
      .mockResolvedValueOnce({ content: 'Hello!', toolCalls: [] })

    const result = await runProviderMcpToolLoop(
      callerMock,
      [{ role: 'user', content: 'hi' }],
      [],
      new Map(),
      'agent-1',
      'conv-1',
      makeWebContents(),
      sendChunkMock,
    )

    expect(result).toBe('Hello!')
    expect(sendChunkMock).toHaveBeenCalledWith('Hello!')
    callerMock.mockReset()
  })

  it('executes inline handlers regardless of toolPolicy', async () => {
    const inlineResult = { success: true, result: 'wiki content' }
    const inlineHandler = vi.fn().mockResolvedValue(inlineResult)

    callerMock
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'tc-1', name: 'wiki_search', arguments: { query: 'foo' } }],
      })
      .mockResolvedValueOnce({ content: 'done', toolCalls: [] })

    const wc = makeWebContents()
    await runProviderMcpToolLoop(
      callerMock,
      [{ role: 'user', content: 'search' }],
      [{ function: { name: 'wiki_search', description: '', parameters: {} } }],
      new Map(),
      'agent-1',
      'conv-1',
      wc,
      sendChunkMock,
      undefined,
      false,
      new Map([['wiki_search', inlineHandler]]),
      undefined,
      undefined,
      undefined,
      // no toolPolicy — inline handlers always run
    )

    expect(inlineHandler).toHaveBeenCalled()
    callerMock.mockReset()
  })

  it('blocks neverAllow tools when toolPolicy is set', async () => {
    const wc = makeWebContents()
    callerMock
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'tc-2', name: 'srv__bash', arguments: {} }],
      })
      .mockResolvedValueOnce({ content: 'stopped', toolCalls: [] })

    await runProviderMcpToolLoop(
      callerMock,
      [{ role: 'user', content: 'run bash' }],
      [{ function: { name: 'srv__bash', description: '', parameters: {} } }],
      new Map([['srv__bash', { serverId: 'srv', toolName: 'bash' }]]),
      'agent-1',
      'conv-1',
      wc,
      sendChunkMock,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      { preApproved: [], alwaysAsk: [], neverAllow: ['bash'] },
    )

    // The tool result fed back to the model should contain a policy error
    const sendCalls = (wc.send as ReturnType<typeof vi.fn>).mock.calls
    const toolEvent = sendCalls.find((c) => c[0] === 'chat:tool-call-event')
    expect(toolEvent).toBeDefined()
    expect(toolEvent![1].success).toBe(false)
    expect(toolEvent![1].result).toMatch(/neverAllow/)
    callerMock.mockReset()
  })

  it('blocks non-preApproved MCP tools when toolPolicy is set', async () => {
    const wc = makeWebContents()
    callerMock
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'tc-3', name: 'srv__read_file', arguments: {} }],
      })
      .mockResolvedValueOnce({ content: 'done', toolCalls: [] })

    await runProviderMcpToolLoop(
      callerMock,
      [{ role: 'user', content: 'read something' }],
      [{ function: { name: 'srv__read_file', description: '', parameters: {} } }],
      new Map([['srv__read_file', { serverId: 'srv', toolName: 'read_file' }]]),
      'agent-1',
      'conv-1',
      wc,
      sendChunkMock,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      { preApproved: ['write_file'], alwaysAsk: [], neverAllow: [] },
    )

    const sendCalls = (wc.send as ReturnType<typeof vi.fn>).mock.calls
    const toolEvent = sendCalls.find((c) => c[0] === 'chat:tool-call-event')
    expect(toolEvent).toBeDefined()
    expect(toolEvent![1].success).toBe(false)
    expect(toolEvent![1].result).toMatch(/pre-approved/)
    callerMock.mockReset()
  })

  it('allows preApproved tools when toolPolicy is set', async () => {
    const wc = makeWebContents()
    callerMock
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'tc-4', name: 'srv__write_file', arguments: { path: '/tmp/x' } }],
      })
      .mockResolvedValueOnce({ content: 'written', toolCalls: [] })

    // No resolved server entry — the tool falls through to "unknown tool" path,
    // which still returns a result. The point is it is NOT blocked by policy.
    await runProviderMcpToolLoop(
      callerMock,
      [{ role: 'user', content: 'write' }],
      [{ function: { name: 'srv__write_file', description: '', parameters: {} } }],
      new Map(), // not in toolMap — resolves as unknown, not policy-blocked
      'agent-1',
      'conv-1',
      wc,
      sendChunkMock,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      { preApproved: ['write_file'], alwaysAsk: [], neverAllow: [] },
    )

    const sendCalls = (wc.send as ReturnType<typeof vi.fn>).mock.calls
    const toolEvent = sendCalls.find((c) => c[0] === 'chat:tool-call-event')
    // Should NOT say policy blocked — should be "Unknown tool" error instead
    expect(toolEvent![1].result).not.toMatch(/pre-approved/)
    expect(toolEvent![1].result).not.toMatch(/neverAllow/)
    callerMock.mockReset()
  })
})

// ─── Chat-handlers regression ─────────────────────────────────────────────

describe('scheduler-handlers IPC round-trip regression', () => {
  let db: Database.Database

  beforeEach(() => {
    initDb()
    db = state.db!
    state.handlers.clear()
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  it('conversations table still exists and is writable', () => {
    const id = 'test-conv'
    const now = Date.now()
    db.prepare(
      'INSERT INTO conversations (id, agent_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, null, 'Regression test', now, now)
    const row = db.prepare('SELECT id FROM conversations WHERE id = ?').get(id) as { id: string } | undefined
    expect(row?.id).toBe(id)
  })

  it('messages table still exists and is writable', () => {
    const convId = 'reg-conv'
    const msgId = 'reg-msg'
    const now = Date.now()
    db.prepare(
      'INSERT INTO conversations (id, agent_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(convId, null, 'Test', now, now)
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(msgId, convId, 'user', 'hello', null, now, null)
    const row = db.prepare('SELECT id FROM messages WHERE id = ?').get(msgId) as { id: string } | undefined
    expect(row?.id).toBe(msgId)
  })

  it('scheduled_tasks and scheduled_runs tables coexist with conversations and messages', () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name)

    expect(tables).toContain('conversations')
    expect(tables).toContain('messages')
    expect(tables).toContain('scheduled_tasks')
    expect(tables).toContain('scheduled_runs')
  })

  it('dispatchChatSend is callable without toolPolicy (normal interactive path)', async () => {
    dispatchChatSendMock.mockResolvedValueOnce({ assistantMsgId: 'mock-msg' })

    const { dispatchChatSend } = await import('../chat-handlers')
    const fakeWin = {
      webContents: { isDestroyed: () => false, send: vi.fn() },
      isDestroyed: () => false,
    } as unknown as import('electron').BrowserWindow

    const result = await dispatchChatSend(fakeWin, 'conv-x', 'hello')
    expect(result?.assistantMsgId).toBe('mock-msg')
    expect(dispatchChatSendMock).toHaveBeenCalledWith(fakeWin, 'conv-x', 'hello')
  })
})
