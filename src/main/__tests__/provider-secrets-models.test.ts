import { EventEmitter } from 'events'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockHttpsRequest } = vi.hoisted(() => {
  const store = new Map<string, string>()
  const mockDb = {
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT OR REPLACE INTO settings') && sql.includes('VALUES (?, ?)')) {
          store.set(args[0] as string, args[1] as string)
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
    _store: store,
  }
  return { mockDb, mockHttpsRequest: vi.fn() }
})

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../database', () => ({ getDatabase: () => mockDb }))
vi.mock('https', () => ({ default: { request: mockHttpsRequest } }))

import {
  fetchAndCacheOpenAIModels,
  fetchAndCacheGeminiModels,
  fetchAndCacheAzureModels,
  getCachedProviderModels,
} from '../provider-secrets'

function mockResponse(status: number, body: string): void {
  mockHttpsRequest.mockImplementationOnce((_options: unknown, callback: (res: EventEmitter) => void) => {
    const req = new EventEmitter() as EventEmitter & { write: (c: string) => void; end: () => void; setTimeout: (ms: number, cb: () => void) => void }
    req.write = vi.fn()
    req.setTimeout = vi.fn()
    req.end = vi.fn(() => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number }
      res.statusCode = status
      callback(res)
      res.emit('data', Buffer.from(body))
      res.emit('end')
    })
    return req
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb._store.clear()
})

describe('fetchAndCacheOpenAIModels', () => {
  it('caches model ids on success', async () => {
    mockResponse(200, JSON.stringify({ data: [{ id: 'gpt-5.5' }, { id: 'gpt-6' }] }))
    await fetchAndCacheOpenAIModels('sk-test')
    expect(getCachedProviderModels('openai_models_cache')).toEqual(['gpt-5.5', 'gpt-6'])
  })

  it('does not write cache on non-200', async () => {
    mockResponse(401, '{}')
    await fetchAndCacheOpenAIModels('bad')
    expect(getCachedProviderModels('openai_models_cache')).toEqual([])
  })
})

describe('fetchAndCacheGeminiModels', () => {
  it('strips the models/ prefix so ids match registry spelling', async () => {
    mockResponse(200, JSON.stringify({ data: [{ id: 'models/gemini-2.5-pro' }, { id: 'gemini-3-flash' }] }))
    await fetchAndCacheGeminiModels('key')
    expect(getCachedProviderModels('gemini_models_cache')).toEqual(['gemini-2.5-pro', 'gemini-3-flash'])
  })
})

describe('fetchAndCacheAzureModels', () => {
  it('caches deployment ids from the endpoint listing', async () => {
    mockResponse(200, JSON.stringify({ data: [{ id: 'gpt-4o' }] }))
    await fetchAndCacheAzureModels('key', 'https://my-resource.openai.azure.com/')
    expect(getCachedProviderModels('azure_models_cache')).toEqual(['gpt-4o'])
  })
})
