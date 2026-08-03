import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Hoisted mocks ─────────────────────────────────────────── */
const { mockIpcMain, mockDb } = vi.hoisted(() => {
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
    })),
    _store: store
  }

  return { mockIpcMain, mockDb }
})

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
}))

vi.mock('../database', () => ({
  getDatabase: () => mockDb
}))

const { mockBroadcastToMobile, mockSendApprovalPush, mockIsMobileInForeground } = vi.hoisted(() => ({
  mockBroadcastToMobile: vi.fn(),
  mockSendApprovalPush: vi.fn().mockResolvedValue(undefined),
  mockIsMobileInForeground: vi.fn().mockReturnValue(false),
}))

vi.mock('../ws-server', () => ({
  broadcastToMobile: mockBroadcastToMobile,
  isMobileInForeground: mockIsMobileInForeground,
}))

vi.mock('../fcm-sender', () => ({
  sendApprovalPush: mockSendApprovalPush,
}))

vi.mock('../safe-handle', () => ({
  safeHandle: mockIpcMain.handle,
}))

/* ── Helpers ─────────────────────────────────────────── */
async function invokeHandler(channel: string, ...args: unknown[]): Promise<any> {
  const handler = mockIpcMain._handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  const fakeEvent = { sender: { id: 1 } }
  return handler(fakeEvent, ...args)
}

/* ── Import & Register ─────────────────────────────────────── */
import { registerToolHandlers, requestApproval, drainPendingApprovals, approvePendingApprovalsForConversation } from '../tools'

beforeEach(() => {
  mockDb._store.clear()
  vi.clearAllMocks()
  registerToolHandlers()
})

/* ── Tests ─────────────────────────────────────── */
describe('Tools — tool:approval-response', () => {
  it('accepts an approval response that arrives synchronously while the request is published', async () => {
    const send = vi.fn((channel: string, payload: { requestId?: string }) => {
      if (channel === 'tool:request-approval' && payload.requestId) {
        void invokeHandler('tool:approval-response', payload.requestId, true, false)
      }
    })
    const wc = { send, isDestroyed: () => false } as unknown as Electron.WebContents

    await expect(requestApproval(wc, 'myTool', {}, 'desc')).resolves.toBe(true)
  })

  it('resolves a pending approval and remembers the preference when no onRemember/noRemember override is given', async () => {
    const send = vi.fn()
    const wc = { send, isDestroyed: () => false } as unknown as Electron.WebContents

    const approvalPromise = requestApproval(wc, 'myTool', { path: '/test.txt' }, 'desc')
    await new Promise((r) => setTimeout(r, 0))

    const approvalCall = send.mock.calls.find((c: unknown[]) => c[0] === 'tool:request-approval')
    expect(approvalCall).toBeDefined()
    const requestId = approvalCall![1].requestId

    await invokeHandler('tool:approval-response', requestId, true, true)

    expect(await approvalPromise).toBe(true)
    expect(mockDb._store.get('tool_pref:myTool')).toBe('always_allow')
  })

  it('does not persist a preference when remember is false', async () => {
    const send = vi.fn()
    const wc = { send, isDestroyed: () => false } as unknown as Electron.WebContents

    const approvalPromise = requestApproval(wc, 'myTool', {}, 'desc')
    await new Promise((r) => setTimeout(r, 0))
    const requestId = send.mock.calls.find((c: unknown[]) => c[0] === 'tool:request-approval')![1].requestId

    await invokeHandler('tool:approval-response', requestId, true, false)

    expect(await approvalPromise).toBe(true)
    expect(mockDb._store.has('tool_pref:myTool')).toBe(false)
  })

  it('calls onRemember instead of writing the global preference when provided', async () => {
    const send = vi.fn()
    const wc = { send, isDestroyed: () => false } as unknown as Electron.WebContents
    const onRemember = vi.fn()

    const approvalPromise = requestApproval(wc, 'myTool', {}, 'desc', { onRemember })
    await new Promise((r) => setTimeout(r, 0))
    const requestId = send.mock.calls.find((c: unknown[]) => c[0] === 'tool:request-approval')![1].requestId

    await invokeHandler('tool:approval-response', requestId, true, true)

    expect(await approvalPromise).toBe(true)
    expect(onRemember).toHaveBeenCalledWith(true)
    expect(mockDb._store.has('tool_pref:myTool')).toBe(false)
  })
})

describe('requestApproval — autoApprove bypass', () => {
  it('resolves true immediately when autoApprove is true', async () => {
    const send = vi.fn()
    const wc = { send, isDestroyed: () => false } as unknown as Electron.WebContents
    const result = await requestApproval(wc, 'myTool', { a: 1 }, 'desc', { autoApprove: true })
    expect(result).toBe(true)
  })

  it('does not emit tool:request-approval when autoApprove is true', async () => {
    const send = vi.fn()
    const wc = { send, isDestroyed: () => false } as unknown as Electron.WebContents
    await requestApproval(wc, 'myTool', {}, 'desc', { autoApprove: true })
    const requestApprovalCalls = send.mock.calls.filter((c: unknown[]) => c[0] === 'tool:request-approval')
    expect(requestApprovalCalls).toHaveLength(0)
  })

  it('emits tool:auto-approved when autoApprove is true', async () => {
    const send = vi.fn()
    const wc = { send, isDestroyed: () => false } as unknown as Electron.WebContents
    await requestApproval(wc, 'myTool', { x: 42 }, 'desc', { autoApprove: true })
    expect(send).toHaveBeenCalledWith('tool:auto-approved', { toolName: 'myTool', args: { x: 42 } })
  })

  it('does not call broadcastToMobile when autoApprove is true', async () => {
    const send = vi.fn()
    const wc = { send, isDestroyed: () => false } as unknown as Electron.WebContents
    await requestApproval(wc, 'myTool', {}, 'desc', { autoApprove: true })
    expect(mockBroadcastToMobile).not.toHaveBeenCalled()
  })

  it('does not call sendApprovalPush when autoApprove is true', async () => {
    const send = vi.fn()
    const wc = { send, isDestroyed: () => false } as unknown as Electron.WebContents
    await requestApproval(wc, 'myTool', {}, 'desc', { autoApprove: true })
    expect(mockSendApprovalPush).not.toHaveBeenCalled()
  })

  it('still emits tool:request-approval when autoApprove is false', async () => {
    const send = vi.fn()
    const wc = { send, isDestroyed: () => false } as unknown as Electron.WebContents
    // Fire and forget — we don't need to resolve it
    void requestApproval(wc, 'myTool', {}, 'desc', { autoApprove: false })
    await new Promise((r) => setTimeout(r, 0))
    const requestApprovalCalls = send.mock.calls.filter((c: unknown[]) => c[0] === 'tool:request-approval')
    expect(requestApprovalCalls).toHaveLength(1)
  })
})

describe('drainPendingApprovals', () => {
  it('resolves all pending approvals for the given agent with true', async () => {
    const send = vi.fn()
    const wc = { send, isDestroyed: () => false } as unknown as Electron.WebContents

    let resolved1: boolean | undefined
    let resolved2: boolean | undefined

    void requestApproval(wc, 'toolA', {}, 'desc', { agentId: 'agent-1' }).then((v) => { resolved1 = v })
    void requestApproval(wc, 'toolB', {}, 'desc', { agentId: 'agent-1' }).then((v) => { resolved2 = v })

    await new Promise((r) => setTimeout(r, 0))

    drainPendingApprovals('agent-1')

    await new Promise((r) => setTimeout(r, 0))

    expect(resolved1).toBe(true)
    expect(resolved2).toBe(true)
  })

  it('leaves pending approvals for other agents untouched', async () => {
    const send = vi.fn()
    const wc = { send, isDestroyed: () => false } as unknown as Electron.WebContents

    let resolvedOther: boolean | undefined

    void requestApproval(wc, 'toolC', {}, 'desc', { agentId: 'agent-2' }).then((v) => { resolvedOther = v })

    await new Promise((r) => setTimeout(r, 0))

    drainPendingApprovals('agent-1')

    await new Promise((r) => setTimeout(r, 10))

    expect(resolvedOther).toBeUndefined()
  })
})

describe('approvePendingApprovalsForConversation', () => {
  it('releases a waiting approval for the escalated conversation only', async () => {
    const send = vi.fn()
    const wc = { send, isDestroyed: () => false } as unknown as Electron.WebContents

    let escalated: boolean | undefined
    let other: boolean | undefined
    void requestApproval(wc, 'Edit', {}, 'desc', { conversationId: 'conv-1' }).then((value) => { escalated = value })
    void requestApproval(wc, 'Edit', {}, 'desc', { conversationId: 'conv-2' }).then((value) => { other = value })
    await new Promise((resolve) => setTimeout(resolve, 0))

    approvePendingApprovalsForConversation('conv-1')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(escalated).toBe(true)
    expect(other).toBeUndefined()
    expect(send).toHaveBeenCalledWith('tool:approval-resolved', expect.any(String))
    approvePendingApprovalsForConversation('conv-2')
  })
})
