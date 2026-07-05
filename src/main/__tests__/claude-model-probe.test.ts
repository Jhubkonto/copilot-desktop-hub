import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockDb, resolveCliPathMock, ptySpawnMock } = vi.hoisted(() => {
  const store = new Map<string, string>()
  const mockDb = {
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT OR REPLACE INTO settings')) store.set(args[0] as string, args[1] as string)
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
    _store: store,
  }
  return { mockDb, resolveCliPathMock: vi.fn(), ptySpawnMock: vi.fn() }
})

vi.mock('../database', () => ({ getDatabase: () => mockDb }))
vi.mock('../cli-adapters/utils', () => ({ resolveCliPath: resolveCliPathMock }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

// Fake terminal: `write` is a no-op; the module's polling logic reads the grid via `getLine`,
// which is backed by `gridState.text` that each test sets directly to simulate a rendered frame.
const { gridState, FakeTerminal } = vi.hoisted(() => {
  const gridState = { text: '' }
  class FakeTerminal {
    rows = 40
    write(_chunk: string): void { /* no-op: grid content is driven via gridState in tests */ }
    buffer = {
      active: {
        getLine: (i: number) => {
          const lines = gridState.text.split('\n')
          const content = lines[i] ?? ''
          return { translateToString: () => content }
        },
      },
    }
  }
  return { gridState, FakeTerminal }
})
vi.mock('@xterm/headless', () => ({ default: { Terminal: FakeTerminal } }))
vi.mock('module', () => ({
  createRequire: () => (id: string) => {
    if (id === 'node-pty') return { spawn: ptySpawnMock }
    if (id === '@xterm/headless') return { Terminal: FakeTerminal }
    throw new Error(`Unexpected native dependency: ${id}`)
  },
}))

import {
  probeClaudeCliModels,
  cacheClaudeCliPtyModels,
  getCachedClaudeCliPtyModels,
  __setProbeTimingForTests,
} from '../cli-adapters/claude-model-probe'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeFakePty() {
  const dataHandlers: ((chunk: string) => void)[] = []
  const exitHandlers: (() => void)[] = []
  const written: string[] = []
  return {
    onData: (cb: (chunk: string) => void) => { dataHandlers.push(cb) },
    onExit: (cb: () => void) => { exitHandlers.push(cb) },
    write: (data: string) => { written.push(data) },
    kill: vi.fn(),
    _emitData: (chunk: string) => dataHandlers.forEach((h) => h(chunk)),
    _emitExit: () => exitHandlers.forEach((h) => h()),
    _written: written,
  }
}

beforeEach(() => {
  mockDb._store.clear()
  gridState.text = ''
  resolveCliPathMock.mockReset()
  ptySpawnMock.mockReset()
  __setProbeTimingForTests({ probeTimeoutMs: 400, quietMs: 30, pollMs: 10 })
})

afterEach(() => {
  __setProbeTimingForTests(null)
})

describe('probeClaudeCliModels', () => {
  it('returns [] when claude CLI is not found', async () => {
    resolveCliPathMock.mockReturnValue(null)
    const result = await probeClaudeCliModels()
    expect(result).toEqual([])
    expect(ptySpawnMock).not.toHaveBeenCalled()
  })

  it('drives the session to the model menu and parses the top-level entries', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    const fakePty = makeFakePty()
    ptySpawnMock.mockReturnValue(fakePty)

    const promise = probeClaudeCliModels()

    // Initial banner settles into the idle prompt
    gridState.text = '❯ \n  for shortcuts · ← for agents'
    fakePty._emitData('banner')
    await wait(80)

    expect(fakePty._written).toContain('/model\r')

    // Model menu renders
    gridState.text = [
      'Select model',
      '    1. Default (recommended)  Sonnet 5 · Efficient for routine tasks',
      '  ❯ 2. Sonnet ✔               Sonnet 5 · Efficient for routine tasks',
      '    3. Fable                  Fable 5 · Most capable for your hardest and longest-running tasks',
      '    4. Opus                   Opus 4.8 · Best for everyday, complex tasks · ~2× usage vs Sonnet',
      '    5. Haiku                  Haiku 4.5 · Fastest for quick answers',
    ].join('\n')
    fakePty._emitData('menu')
    await wait(80)

    const result = await promise
    expect(result).toEqual([
      { id: 'sonnet', label: 'Sonnet 5' },
      { id: 'fable', label: 'Fable 5' },
      { id: 'opus', label: 'Opus 4.8' },
      { id: 'haiku', label: 'Haiku 4.5' },
    ])
    expect(fakePty.kill).toHaveBeenCalled()
  })

  it('accepts the workspace trust dialog before continuing', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    const fakePty = makeFakePty()
    ptySpawnMock.mockReturnValue(fakePty)

    const promise = probeClaudeCliModels()

    gridState.text = 'Is this a project you trust?\n❯ 1. Yes, trust this folder'
    fakePty._emitData('trust-dialog')
    await wait(80)
    expect(fakePty._written).toContain('\r')

    gridState.text = '❯ \n  for shortcuts · ← for agents'
    fakePty._emitData('settled')
    await wait(80)
    expect(fakePty._written).toContain('/model\r')

    gridState.text = 'Select model\n  ❯ 2. Sonnet ✔  Sonnet 5 · Efficient for routine tasks'
    fakePty._emitData('menu')
    await wait(80)

    const result = await promise
    expect(result).toEqual([{ id: 'sonnet', label: 'Sonnet 5' }])
  })

  it('declines the MCP server prompt via Escape', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    const fakePty = makeFakePty()
    ptySpawnMock.mockReturnValue(fakePty)

    const promise = probeClaudeCliModels()

    gridState.text = 'New MCP server found in this project: playwright\n❯ 1. Use this MCP server'
    fakePty._emitData('mcp-prompt')
    await wait(80)
    expect(fakePty._written).toContain('\x1b')

    gridState.text = '❯ \n  for shortcuts · ← for agents'
    fakePty._emitData('settled')
    await wait(80)

    gridState.text = 'Select model\n  ❯ 2. Sonnet ✔  Sonnet 5 · Efficient for routine tasks'
    fakePty._emitData('menu')
    await wait(80)

    const result = await promise
    expect(result).toEqual([{ id: 'sonnet', label: 'Sonnet 5' }])
  })

  it('resolves to [] on hard timeout when the CLI never settles', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    const fakePty = makeFakePty()
    ptySpawnMock.mockReturnValue(fakePty)

    const promise = probeClaudeCliModels()
    gridState.text = 'still loading...'
    fakePty._emitData('stuck')

    const result = await promise
    expect(result).toEqual([])
  }, 2000)

  it('resolves to [] when the pty process exits early', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    const fakePty = makeFakePty()
    ptySpawnMock.mockReturnValue(fakePty)

    const promise = probeClaudeCliModels()
    fakePty._emitExit()

    const result = await promise
    expect(result).toEqual([])
  })

  it('coalesces concurrent calls into a single in-flight probe', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    const fakePty = makeFakePty()
    ptySpawnMock.mockReturnValue(fakePty)

    const p1 = probeClaudeCliModels()
    const p2 = probeClaudeCliModels()
    expect(ptySpawnMock).toHaveBeenCalledTimes(1)

    fakePty._emitExit()
    await Promise.all([p1, p2])
  })
})

describe('claude CLI PTY model cache', () => {
  beforeEach(() => {
    mockDb._store.clear()
  })

  it('returns empty array when nothing cached', () => {
    expect(getCachedClaudeCliPtyModels()).toEqual([])
  })

  it('round-trips cached models through the settings table', () => {
    cacheClaudeCliPtyModels([{ id: 'opus', label: 'Opus 4.8' }])
    expect(getCachedClaudeCliPtyModels()).toEqual([{ id: 'opus', label: 'Opus 4.8' }])
  })

  it('does not write cache for an empty probe result', () => {
    cacheClaudeCliPtyModels([])
    expect(mockDb._store.has('claude_cli_pty_models_cache')).toBe(false)
  })
})
