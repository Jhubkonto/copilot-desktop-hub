import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Hoisted mocks ─────────────────────────────────────────── */
const { mockIpcMain, mockSpawn } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()

  return {
    mockIpcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      _handlers: handlers
    },
    mockSpawn: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  BrowserWindow: {
    fromWebContents: vi.fn(() => ({
      webContents: { send: vi.fn() }
    }))
  }
}))

vi.mock('child_process', () => ({
  spawn: mockSpawn
}))

/* ── Helpers ─────────────────────────────────────────── */
async function invokeHandler(channel: string, ...args: unknown[]): Promise<any> {
  const handler = mockIpcMain._handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  const fakeEvent = { sender: { id: 1 } }
  return handler(fakeEvent, ...args)
}

/* ── Import & Register ─────────────────────────────────────── */
import { registerTerminalHandlers, disposeAllTerminals } from '../terminal'
import EventEmitter from 'events'

function makeFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: { writable: boolean; write: ReturnType<typeof vi.fn> }
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
    pid: number
  }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = { writable: true, write: vi.fn() }
  proc.kill = vi.fn()
  proc.pid = 12345
  return proc
}

beforeEach(() => {
  vi.clearAllMocks()
  registerTerminalHandlers()
})

/* ── Tests ─────────────────────────────────────── */
describe('Terminal — IPC Handlers', () => {
  it('terminal:create spawns a shell process', async () => {
    const fakeProc = makeFakeProc()
    mockSpawn.mockReturnValue(fakeProc)

    const r = await invokeHandler('terminal:create', 'term-1')
    expect(r).toBe(true)
    expect(mockSpawn).toHaveBeenCalledTimes(1)
  })

  it('terminal:write sends data to process stdin', async () => {
    const fakeProc = makeFakeProc()
    mockSpawn.mockReturnValue(fakeProc)

    await invokeHandler('terminal:create', 'term-w')
    const r = await invokeHandler('terminal:write', 'term-w', 'ls\n')

    expect(r).toBe(true)
    expect(fakeProc.stdin.write).toHaveBeenCalledWith('ls\n')
  })

  it('terminal:write returns false for unknown terminal', async () => {
    const r = await invokeHandler('terminal:write', 'nonexistent', 'data')
    expect(r).toBe(false)
  })

  it('terminal:dispose kills the process', async () => {
    const fakeProc = makeFakeProc()
    mockSpawn.mockReturnValue(fakeProc)

    await invokeHandler('terminal:create', 'term-d')
    const r = await invokeHandler('terminal:dispose', 'term-d')

    expect(r).toBe(true)
    expect(fakeProc.kill).toHaveBeenCalled()
  })

  it('disposeAllTerminals kills all active terminals', async () => {
    const proc1 = makeFakeProc()
    const proc2 = makeFakeProc()
    mockSpawn.mockReturnValueOnce(proc1).mockReturnValueOnce(proc2)

    await invokeHandler('terminal:create', 'term-a1')
    await invokeHandler('terminal:create', 'term-a2')

    disposeAllTerminals()

    expect(proc1.kill).toHaveBeenCalled()
    expect(proc2.kill).toHaveBeenCalled()
  })
})
