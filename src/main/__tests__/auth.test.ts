import { describe, it, expect, vi, beforeEach } from 'vitest'

// Everything referenced inside vi.mock factories must be created in vi.hoisted
const {
  mockRequest, dbStore, mockDb, mockSafeStorage,
  mockBrowserWindow, ipcHandlers, mockIpcMain
} = vi.hoisted(() => {
  const mockRequest = vi.fn()

  const dbStore = new Map<string, string>()

  const mockDb = {
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((...args: unknown[]) => {
        const insertMatch = sql.match(/INSERT OR REPLACE INTO settings \(key, value\) VALUES \('([^']+)',\s*\?\)/)
        if (insertMatch) {
          dbStore.set(insertMatch[1], args[0] as string)
          return { changes: 1 }
        }
        // Handle hardcoded key+value like VALUES ('auth_encrypted', 'true')
        const insertHardcoded = sql.match(/INSERT OR REPLACE INTO settings \(key, value\) VALUES \('([^']+)',\s*'([^']+)'\)/)
        if (insertHardcoded) {
          dbStore.set(insertHardcoded[1], insertHardcoded[2])
          return { changes: 1 }
        }
        if (sql.includes('INSERT OR REPLACE INTO settings') && !insertMatch && !insertHardcoded) {
          dbStore.set(args[0] as string, args[1] as string)
          return { changes: 1 }
        }
        if (sql.startsWith('DELETE')) {
          const keys = sql.match(/key IN \(([^)]+)\)/)?.[1]
          if (keys) {
            keys.split(',').map(k => k.trim().replace(/'/g, '')).forEach(k => dbStore.delete(k))
          }
          return { changes: 1 }
        }
        return { changes: 1 }
      }),
      get: vi.fn(() => {
        const selectMatch = sql.match(/SELECT value FROM settings WHERE key = '([^']+)'/)
        if (selectMatch) {
          const val = dbStore.get(selectMatch[1])
          return val !== undefined ? { value: val } : undefined
        }
        return undefined
      }),
      all: vi.fn(() => [])
    })),
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn()
  }

  const mockSafeStorage = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((text: string) => Buffer.from(`enc:${text}`)),
    decryptString: vi.fn((buffer: Buffer) => {
      const str = buffer.toString()
      return str.startsWith('enc:') ? str.slice(4) : str
    })
  }

  const mockBrowserWindow = { fromWebContents: vi.fn() }
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const mockIpcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler)
    }),
    removeHandler: vi.fn()
  }

  return { mockRequest, dbStore, mockDb, mockSafeStorage, mockBrowserWindow, ipcHandlers, mockIpcMain }
})

vi.mock('electron', () => ({
  safeStorage: mockSafeStorage,
  BrowserWindow: mockBrowserWindow,
  ipcMain: mockIpcMain,
  app: { getPath: vi.fn(() => '/tmp/test'), on: vi.fn(), quit: vi.fn(), isPackaged: false },
  shell: { openExternal: vi.fn() }
}))

vi.mock('../database', () => ({
  getDatabase: vi.fn(() => mockDb),
  closeDatabase: vi.fn()
}))

vi.mock('https', () => ({
  default: { request: mockRequest },
  request: mockRequest
}))

import {
  _storeToken,
  _retrieveToken,
  _clearToken,
  _fetchGitHubUser,
  registerAuthHandlers
} from '../auth'

function createMockResponse(statusCode: number, body: string) {
  const res = {
    statusCode,
    on: vi.fn((event: string, cb: (data?: string) => void) => {
      if (event === 'data') cb(body)
      if (event === 'end') cb()
      return res
    })
  }
  return res
}

function setupMockRequest(responses: Array<{ statusCode: number; body: string }>) {
  let callIndex = 0
  mockRequest.mockImplementation((_options: unknown, callback: (res: unknown) => void) => {
    const response = responses[callIndex] ?? responses[responses.length - 1]
    callIndex++
    const req = {
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(() => {
        callback(createMockResponse(response.statusCode, response.body))
      }),
      setTimeout: vi.fn(),
      destroy: vi.fn()
    }
    return req
  })
}

describe('Auth — Token Storage (auth-m-9, auth-m-10)', () => {
  beforeEach(() => {
    dbStore.clear()
    vi.clearAllMocks()
  })

  it('auth-m-9: storeToken / retrieveToken roundtrip with encryption', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
    // encryptString returns Buffer.from(`enc:${text}`), storeToken base64-encodes it
    // retrieveToken does Buffer.from(row.value, 'base64') → decryptString(buffer)
    // So decryptString receives the re-decoded buffer which is `enc:${text}`
    _storeToken('test-token-123')
    const retrieved = _retrieveToken()
    expect(retrieved).toBe('test-token-123')
    expect(mockSafeStorage.encryptString).toHaveBeenCalledWith('test-token-123')
    expect(mockSafeStorage.decryptString).toHaveBeenCalled()
  })

  it('auth-m-10: storeToken / retrieveToken fallback when encryption unavailable', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false)
    _storeToken('plain-token')
    const retrieved = _retrieveToken()
    expect(retrieved).toBe('plain-token')
    expect(mockSafeStorage.encryptString).not.toHaveBeenCalled()
  })

  it('auth-m-8 (partial): clearToken removes token from store', () => {
    _storeToken('token-to-clear')
    expect(_retrieveToken()).not.toBeNull()
    _clearToken()
    expect(_retrieveToken()).toBeNull()
  })

  it('retrieveToken returns null when no token stored', () => {
    expect(_retrieveToken()).toBeNull()
  })
})

describe('Auth — fetchGitHubUser', () => {
  beforeEach(() => {
    dbStore.clear()
    vi.clearAllMocks()
  })

  it('returns user on valid response and caches in DB', async () => {
    setupMockRequest([{
      statusCode: 200,
      body: JSON.stringify({ login: 'testuser', avatar_url: 'https://example.com/avatar.png', name: 'Test User' })
    }])
    const user = await _fetchGitHubUser('valid-token')
    expect(user).toEqual({ login: 'testuser', avatar_url: 'https://example.com/avatar.png', name: 'Test User' })
    expect(dbStore.get('auth_user')).toBeTruthy()
  })

  it('returns null when response has no login field', async () => {
    setupMockRequest([{ statusCode: 200, body: '{}' }])
    const user = await _fetchGitHubUser('bad-token')
    expect(user).toBeNull()
  })

  it('returns null on network error', async () => {
    mockRequest.mockImplementation((_options: unknown, _callback: unknown) => {
      const req = {
        on: vi.fn((event: string, cb: (err: Error) => void) => {
          if (event === 'error') setTimeout(() => cb(new Error('Network error')), 0)
          return req
        }),
        write: vi.fn(),
        end: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn()
      }
      return req
    })
    const user = await _fetchGitHubUser('token')
    expect(user).toBeNull()
  })
})

describe('Auth — IPC Handler Registration', () => {
  beforeEach(() => {
    dbStore.clear()
    vi.clearAllMocks()
    ipcHandlers.clear()
    registerAuthHandlers()
  })

  it('registers auth:status, auth:login, and auth:logout handlers', () => {
    expect(ipcHandlers.has('auth:status')).toBe(true)
    expect(ipcHandlers.has('auth:login')).toBe(true)
    expect(ipcHandlers.has('auth:logout')).toBe(true)
  })

  it('auth-m-6: auth:status returns authenticated when valid token + cached user', async () => {
    _storeToken('valid-token')
    dbStore.set('auth_user', JSON.stringify({ login: 'testuser', avatar_url: '', name: null }))

    const handler = ipcHandlers.get('auth:status') as Function
    const result = await handler({} as Electron.IpcMainInvokeEvent)
    expect(result).toEqual({
      authenticated: true,
      user: { login: 'testuser', avatar_url: '', name: null }
    })
  })

  it('auth-m-7: auth:status returns unauthenticated when no token', async () => {
    const handler = ipcHandlers.get('auth:status') as Function
    const result = await handler({} as Electron.IpcMainInvokeEvent)
    expect(result).toEqual({ authenticated: false, user: null })
  })

  it('auth-m-8: auth:logout clears token', async () => {
    _storeToken('token-to-logout')
    expect(_retrieveToken()).not.toBeNull()
    const handler = ipcHandlers.get('auth:logout') as Function
    await handler({} as Electron.IpcMainInvokeEvent)
    expect(_retrieveToken()).toBeNull()
  })

  it('auth-m-5: auth:login sends device code to renderer via IPC', async () => {
    const mockWin = { webContents: { send: vi.fn() } }
    mockBrowserWindow.fromWebContents.mockReturnValue(mockWin as never)

    const deviceCodeResponse = JSON.stringify({
      device_code: 'test-dc', user_code: 'TEST-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900, interval: 5
    })
    const tokenResponse = JSON.stringify({
      access_token: 'gho_test', token_type: 'bearer', scope: 'read:user'
    })
    const userResponse = JSON.stringify({
      login: 'testuser', avatar_url: 'https://example.com/a.png', name: 'Test'
    })

    setupMockRequest([
      { statusCode: 200, body: deviceCodeResponse },
      { statusCode: 200, body: tokenResponse },
      { statusCode: 200, body: userResponse }
    ])

    const handler = ipcHandlers.get('auth:login') as Function
    // Don't await — the handler is blocked on setTimeout for polling.
    // We just check that device code was sent to renderer synchronously.
    handler({ sender: {} } as Electron.IpcMainInvokeEvent)

    // httpPost for device code resolves synchronously in mock, so send happens immediately
    await new Promise((r) => setTimeout(r, 50))

    expect(mockWin.webContents.send).toHaveBeenCalledWith('auth:device-code', {
      userCode: 'TEST-1234',
      verificationUri: 'https://github.com/login/device'
    })
  }, 2000)

  it('auth-m-1: auth:login returns error when httpPost throws', async () => {
    mockBrowserWindow.fromWebContents.mockReturnValue({ webContents: { send: vi.fn() } } as never)
    mockRequest.mockImplementation(() => {
      const req = {
        on: vi.fn((event: string, cb: (err: Error) => void) => {
          if (event === 'error') Promise.resolve().then(() => cb(new Error('Network fail')))
          return req
        }),
        write: vi.fn(),
        end: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn()
      }
      return req
    })

    const handler = ipcHandlers.get('auth:login') as Function
    const result = await handler({ sender: {} } as Electron.IpcMainInvokeEvent)
    expect(result).toMatchObject({ success: false, error: 'Network fail' })
  })
})
