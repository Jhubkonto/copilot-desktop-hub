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

import { registerCliHandlers, checkCliOnStartup, detectAllClis } from '../cli-detection'

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

  it('detectAllClis returns status for all CLIs', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('copilot') && (cmd.includes('where') || cmd.includes('which'))) return '/usr/bin/copilot\n'
      if (cmd.includes('claude') && (cmd.includes('where') || cmd.includes('which'))) return '/usr/bin/claude\n'
      if (cmd.includes('gh') && (cmd.includes('where') || cmd.includes('which'))) return '/usr/bin/gh\n'
      if (cmd.includes('ollama') && (cmd.includes('where') || cmd.includes('which'))) return '/usr/bin/ollama\n'
      if (cmd.includes('github-copilot-cli --version') || cmd.includes('copilot --version')) return '1.0.0'
      if (cmd.includes('claude --version')) return '0.9.1'
      if (cmd.includes('gh --version')) return 'gh version 2.0.0\nmore'
      if (cmd.includes('ollama --version')) return '0.7.0'
      throw new Error(`unknown command: ${cmd}`)
    })
    mockExistsSync.mockReturnValue(true)

    const result = detectAllClis()
    expect(result).toEqual({
      copilot: { installed: true, path: '/usr/bin/copilot', version: '1.0.0' },
      claude: { installed: true, path: '/usr/bin/claude', version: '0.9.1' },
      gh: { installed: true, path: '/usr/bin/gh', version: 'gh version 2.0.0' },
      ollama: { installed: true, path: '/usr/bin/ollama', version: '0.7.0' },
    })

    const viaIpc = await invokeHandler('cli:detect-all')
    expect(viaIpc).toEqual(result)
  })

  it('detectAllClis returns not-installed when commands fail', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found') })
    mockExistsSync.mockReturnValue(false)

    expect(detectAllClis()).toEqual({
      copilot: { installed: false, path: null, version: null },
      claude: { installed: false, path: null, version: null },
      gh: { installed: false, path: null, version: null },
      ollama: { installed: false, path: null, version: null },
    })
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
