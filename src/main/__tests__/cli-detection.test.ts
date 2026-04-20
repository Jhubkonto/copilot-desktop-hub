import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Hoisted mocks ─────────────────────────────────────────── */
const { mockIpcMain, mockExecSync, mockExistsSync } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    mockIpcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      _handlers: handlers
    },
    mockExecSync: vi.fn(),
    mockExistsSync: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: mockIpcMain
}))

vi.mock('child_process', () => ({
  execSync: mockExecSync
}))

vi.mock('fs', () => ({
  existsSync: mockExistsSync
}))

import { registerCliHandlers, checkCliOnStartup } from '../cli-detection'

async function invokeHandler(channel: string, ...args: unknown[]): Promise<any> {
  const handler = mockIpcMain._handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  const fakeEvent = { sender: { id: 1 } }
  return handler(fakeEvent, ...args)
}

beforeEach(() => {
  vi.clearAllMocks()
  registerCliHandlers()
})

describe('CLI Detection', () => {
  it('cli:status returns not installed when CLI not found', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found') })
    mockExistsSync.mockReturnValue(false)

    const result = await invokeHandler('cli:status')
    expect(result.installed).toBe(false)
    expect(result.path).toBeNull()
  })

  it('cli:status returns installed when CLI found via which/where', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if ((cmd.includes('where') || cmd.includes('which')) && cmd.includes('copilot')) {
        return '/usr/local/bin/copilot\n'
      }
      if (cmd.includes('--version')) return '1.0.0'
      throw new Error('unknown')
    })
    mockExistsSync.mockReturnValue(true)

    // Use cli:check to force re-detection (bypasses cache)
    const result = await invokeHandler('cli:check')
    expect(result.installed).toBe(true)
    expect(result.path).toBe('/usr/local/bin/copilot')
    expect(result.version).toBe('1.0.0')
  })

  it('cli:check forces re-detection', async () => {
    // First: CLI found
    mockExecSync.mockImplementation((cmd: string) => {
      if ((cmd.includes('where') || cmd.includes('which')) && cmd.includes('copilot')) {
        return '/usr/bin/copilot'
      }
      throw new Error('unknown')
    })
    mockExistsSync.mockReturnValue(true)

    const r1 = await invokeHandler('cli:check')
    expect(r1.installed).toBe(true)

    // Now CLI disappears
    mockExecSync.mockImplementation(() => { throw new Error('not found') })
    mockExistsSync.mockReturnValue(false)

    // cli:status would return cached true
    const cached = await invokeHandler('cli:status')
    expect(cached.installed).toBe(true)

    // cli:check forces re-detection
    const r2 = await invokeHandler('cli:check')
    expect(r2.installed).toBe(false)
  })

  it('checkCliOnStartup returns CLI status', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found') })
    mockExistsSync.mockReturnValue(false)

    const result = checkCliOnStartup()
    expect(result.installed).toBe(false)
  })

  it('handles version command failure gracefully', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if ((cmd.includes('where') || cmd.includes('which')) && cmd.includes('copilot')) {
        return '/usr/bin/copilot'
      }
      throw new Error('no version')
    })
    mockExistsSync.mockReturnValue(true)

    // Use cli:check to force re-detection
    const result = await invokeHandler('cli:check')
    expect(result.installed).toBe(true)
    expect(result.version).toBeNull()
  })
})
