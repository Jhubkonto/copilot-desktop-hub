import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockDb, ipcHandlers, mockIpcMain, mockSafeStorage, mockHttpsRequest } = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const store = new Map<string, string>()

  const mockDb = {
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((...args: unknown[]) => {
        // Handle INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
        if (sql.includes('INSERT OR REPLACE INTO settings') && sql.includes('VALUES (?, ?)')) {
          store.set(args[0] as string, args[1] as string)
        }
        // Handle INSERT with hardcoded key: VALUES ('key', ?)
        const hardcodedInsert = sql.match(/VALUES\s*\('([^']+)',\s*\?\)/)
        if (sql.includes('INSERT OR REPLACE INTO settings') && hardcodedInsert) {
          store.set(hardcodedInsert[1], args[0] as string)
        }
        // Handle DELETE
        if (sql.includes('DELETE FROM settings')) {
          store.delete(args[0] as string)
          if (args[1]) store.delete(args[1] as string)
        }
        return { changes: 1 }
      }),
      get: vi.fn((...args: unknown[]): { value: string } | undefined => {
        // Parameterized: WHERE key = ?
        if (sql.includes('WHERE key = ?') && args[0]) {
          const val = store.get(args[0] as string)
          return val !== undefined ? { value: val } : undefined
        }
        // Hardcoded key: WHERE key = 'xyz'
        const hardcodedGet = sql.match(/WHERE key = '([^']+)'/)
        if (hardcodedGet) {
          const val = store.get(hardcodedGet[1])
          return val !== undefined ? { value: val } : undefined
        }
        return undefined
      }),
      all: vi.fn(() => [])
    })),
    _store: store
  }

  return {
    mockDb,
    ipcHandlers,
    mockIpcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcHandlers.set(channel, handler)
      }),
      removeHandler: vi.fn()
    },
    mockSafeStorage: {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((text: string) => Buffer.from(`enc:${text}`)),
      decryptString: vi.fn((buf: Buffer) => buf.toString().replace('enc:', ''))
    },
    mockHttpsRequest: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  safeStorage: mockSafeStorage
}))

vi.mock('../database', () => ({
  getDatabase: () => mockDb
}))

vi.mock('../safe-handle', () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    mockIpcMain.handle(channel, handler)
  }
}))

// Mock https module to avoid real network calls in test-key tests
vi.mock('https', () => ({
  default: {
    request: mockHttpsRequest
  }
}))

// ── Test helpers ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invokeHandler(channel: string, ...args: unknown[]): Promise<any> {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  const event = {}
  return handler(event, ...args)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Providers — IPC Handlers', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    ipcHandlers.clear()
    mockDb._store.clear()

    const mod = await import('../providers')
    mod.registerProviderHandlers()
  })

  describe('provider:set-key', () => {
    it('prov-m-1: encrypts and stores key', async () => {
      await invokeHandler('provider:set-key', 'openai', 'sk-test-key-123')

      // Should have stored encrypted key and encryption flag
      expect(mockDb._store.get('byok_openai_key')).toBeDefined()
      expect(mockDb._store.get('byok_openai_key_encrypted')).toBe('true')
    })

    it('stores plaintext when encryption unavailable', async () => {
      mockSafeStorage.isEncryptionAvailable.mockReturnValueOnce(false)
      await invokeHandler('provider:set-key', 'openai', 'sk-plain-key')

      expect(mockDb._store.get('byok_openai_key')).toBe('sk-plain-key')
      expect(mockDb._store.get('byok_openai_key_encrypted')).toBe('false')
    })
  })

  describe('provider:remove-key', () => {
    it('prov-m-2: deletes key from DB', async () => {
      // Store a key first
      mockDb._store.set('byok_openai_key', 'some-value')
      mockDb._store.set('byok_openai_key_encrypted', 'true')

      const result = await invokeHandler('provider:remove-key', 'openai')
      expect(result).toBe(true)
    })
  })

  describe('provider:has-key', () => {
    it('prov-m-3: returns true when key exists', async () => {
      mockDb._store.set('byok_openai_key', 'some-encrypted-value')
      const result = await invokeHandler('provider:has-key', 'openai')
      expect(result).toBe(true)
    })

    it('prov-m-4: returns false when no key', async () => {
      const result = await invokeHandler('provider:has-key', 'anthropic')
      expect(result).toBe(false)
    })
  })

  describe('provider:list', () => {
    it('prov-m-8: returns all configured providers', async () => {
      // Store an OpenAI key
      mockDb._store.set('byok_openai_key', 'some-value')

      const result = await invokeHandler('provider:list')
      expect(result).toHaveLength(4)

      const copilot = result.find((p: { name: string }) => p.name === 'copilot')
      expect(copilot.configured).toBe(true) // Always configured

      const openai = result.find((p: { name: string }) => p.name === 'openai')
      expect(openai.configured).toBe(true)

      const anthropic = result.find((p: { name: string }) => p.name === 'anthropic')
      expect(anthropic.configured).toBe(false)
    })
  })

  describe('provider:get/set-azure-endpoint', () => {
    it('set-azure-endpoint stores the value', async () => {
      const result = await invokeHandler('provider:set-azure-endpoint', 'https://myresource.openai.azure.com')
      expect(result).toBe(true)
      expect(mockDb._store.get('byok_azure_endpoint')).toBe('https://myresource.openai.azure.com')
    })

    it('get-azure-endpoint retrieves stored value', async () => {
      mockDb._store.set('byok_azure_endpoint', 'https://myresource.openai.azure.com')
      const ep = await invokeHandler('provider:get-azure-endpoint')
      expect(ep).toBe('https://myresource.openai.azure.com')
    })
  })
})
