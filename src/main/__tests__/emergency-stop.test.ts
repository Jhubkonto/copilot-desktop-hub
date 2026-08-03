import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  value: undefined as string | undefined,
  abort: vi.fn(),
  abortHttps: vi.fn(),
  clearTurns: vi.fn(),
  denyApprovals: vi.fn(),
  broadcast: vi.fn(),
  send: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: state.send } }] },
}))
vi.mock('../database', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => sql.startsWith('SELECT')
      ? { get: () => state.value == null ? undefined : { value: state.value } }
      : { run: (_key: string, value: string) => { state.value = value } },
  }),
}))
vi.mock('../provider-stream-state', () => ({ abortActiveStream: state.abort }))
vi.mock('../http-client', () => ({ abortAllHttpsRequests: state.abortHttps }))
vi.mock('../active-chat-turns', () => ({ clearAllActiveChatTurns: state.clearTurns }))
vi.mock('../tools', () => ({ denyAllPendingApprovals: state.denyApprovals }))
vi.mock('../ws-server', () => ({ broadcastToMobile: state.broadcast }))
vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))

describe('emergency stop', () => {
  beforeEach(async () => {
    state.value = undefined
    vi.clearAllMocks()
    const { resetEmergencyStopForTest } = await import('../emergency-stop')
    resetEmergencyStopForTest()
  })

  it('latches, aborts all work, and rejects new conversation starts', async () => {
    const api = await import('../emergency-stop')
    const status = api.activateEmergencyStop()

    expect(status.active).toBe(true)
    expect(state.abort).toHaveBeenCalledOnce()
    expect(state.abortHttps).toHaveBeenCalledOnce()
    expect(state.clearTurns).toHaveBeenCalledOnce()
    expect(state.denyApprovals).toHaveBeenCalledOnce()
    expect(() => api.assertConversationStartsAllowed()).toThrow('Emergency stop is active')
    expect(JSON.parse(state.value!)).toMatchObject({ active: true })
  })

  it('requires an explicit resume and then permits starts again', async () => {
    const api = await import('../emergency-stop')
    api.activateEmergencyStop()
    expect(api.resumeConversations()).toEqual({ active: false, activatedAt: null })
    expect(() => api.assertConversationStartsAllowed()).not.toThrow()
  })
})
