import { describe, it, expect, vi, beforeEach } from 'vitest'

const { dbStore, mockDb, ipcHandlers, mockIpcMain } = vi.hoisted(() => {
  const dbStore = new Map<string, string>()

  const mockDb = {
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((...args: unknown[]) => {
        const insertMatch = sql.match(/INSERT OR REPLACE INTO settings \(key, value\) VALUES \('([^']+)',\s*\?\)/)
        if (insertMatch) {
          dbStore.set(insertMatch[1], args[0] as string)
          return { changes: 1 }
        }
        if (sql.startsWith('DELETE')) {
          const keys = sql.match(/key IN \(([^)]+)\)/)?.[1]
          if (keys) {
            keys.split(',').map((k) => k.trim().replace(/'/g, '')).forEach((k) => dbStore.delete(k))
          }
          return { changes: 1 }
        }
        return { changes: 1 }
      }),
      get: vi.fn(() => {
        const selectMatch = sql.match(/SELECT value FROM settings WHERE key = '([^']+)'/)
        if (selectMatch) {
          const value = dbStore.get(selectMatch[1])
          return value !== undefined ? { value } : undefined
        }
        return undefined
      }),
    })),
  }

  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const mockIpcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler)
    }),
    removeHandler: vi.fn(),
  }

  return { dbStore, mockDb, ipcHandlers, mockIpcMain }
})

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))
vi.mock('../database', () => ({ getDatabase: vi.fn(() => mockDb) }))
vi.mock('../safe-handle', () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    ipcHandlers.set(channel, handler)
  },
}))
vi.mock('../cli-adapters/claude', () => ({
  ClaudeAdapter: { isAvailable: vi.fn(() => false) },
}))
vi.mock('../cli-adapters/codex', () => ({
  CodexAdapter: { isAvailable: vi.fn(() => false) },
}))

import { registerAuthHandlers, retrieveAuthMode, storeAuthMode } from '../auth'

describe('auth', () => {
  beforeEach(() => {
    dbStore.clear()
    ipcHandlers.clear()
    vi.clearAllMocks()
  })

  it('stores and retrieves BYOK auth mode', () => {
    storeAuthMode('byok')
    expect(retrieveAuthMode()).toBe('byok')
  })

  it('defaults to none when auth mode is missing', () => {
    expect(retrieveAuthMode()).toBe('none')
  })

  it('registers BYOK auth handlers', () => {
    registerAuthHandlers()
    expect(ipcHandlers.has('auth:status')).toBe(true)
    expect(ipcHandlers.has('auth:login-byok')).toBe(true)
    expect(ipcHandlers.has('auth:logout')).toBe(true)
  })

  it('auth:status returns BYOK state', async () => {
    storeAuthMode('byok')
    registerAuthHandlers()

    const handler = ipcHandlers.get('auth:status') as () => { authenticated: boolean; mode: string; user: null; cliInstalled: boolean; clis: { claude: boolean; codex: boolean } }
    expect(handler()).toEqual({
      authenticated: true,
      mode: 'byok',
      user: null,
      cliInstalled: false,
      clis: { claude: false, codex: false },
    })
  })

  it('auth:login-byok enables BYOK mode', async () => {
    registerAuthHandlers()

    const handler = ipcHandlers.get('auth:login-byok') as () => { success: boolean }
    expect(handler()).toEqual({ success: true })
    expect(retrieveAuthMode()).toBe('byok')
  })

  it('auth:logout clears legacy auth rows and resets mode', async () => {
    dbStore.set('auth_mode', 'byok')
    dbStore.set('auth_token', 'token')
    dbStore.set('auth_encrypted', 'true')
    dbStore.set('auth_user', '{"login":"octocat"}')
    registerAuthHandlers()

    const handler = ipcHandlers.get('auth:logout') as () => boolean
    expect(handler()).toBe(true)
    expect(retrieveAuthMode()).toBe('none')
    expect(dbStore.has('auth_token')).toBe(false)
    expect(dbStore.has('auth_encrypted')).toBe(false)
    expect(dbStore.has('auth_user')).toBe(false)
  })
})
