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

vi.mock('../database', () => ({ getDatabase: () => mockDb }))
vi.mock('https', () => ({ default: { request: mockHttpsRequest } }))

import { fetchAndCacheAnthropicModels, getCachedAnthropicModels } from '../anthropic-models'

function mockResponse(status: number, body: string): void {
  mockHttpsRequest.mockImplementationOnce((_options: unknown, callback: (res: EventEmitter) => void) => {
    const req = new EventEmitter() as EventEmitter & { write: (chunk: string) => void; end: () => void; setTimeout: (ms: number, cb: () => void) => void }
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

describe('fetchAndCacheAnthropicModels', () => {
  it('caches model ids from a successful response', async () => {
    mockResponse(200, JSON.stringify({ data: [{ id: 'claude-opus-4-8' }, { id: 'claude-sonnet-4-6' }] }))

    await fetchAndCacheAnthropicModels('sk-ant-test')

    expect(JSON.parse(mockDb._store.get('anthropic_models_cache')!)).toEqual([
      'claude-opus-4-8',
      'claude-sonnet-4-6',
    ])
  })

  it('does not write cache on non-200 response', async () => {
    mockResponse(401, JSON.stringify({ error: 'unauthorized' }))

    await fetchAndCacheAnthropicModels('bad-key')

    expect(mockDb._store.has('anthropic_models_cache')).toBe(false)
  })

  it('fails silently on network error', async () => {
    mockHttpsRequest.mockImplementationOnce(() => {
      throw new Error('network down')
    })

    await expect(fetchAndCacheAnthropicModels('sk-ant-test')).resolves.toBeUndefined()
    expect(mockDb._store.has('anthropic_models_cache')).toBe(false)
  })
})

describe('getCachedAnthropicModels', () => {
  it('returns empty array when no cache exists', () => {
    expect(getCachedAnthropicModels()).toEqual([])
  })

  it('returns labeled models from cache, falling back to id when unknown', () => {
    mockDb._store.set('anthropic_models_cache', JSON.stringify(['claude-opus-4.8', 'claude-unknown-future-model']))

    expect(getCachedAnthropicModels()).toEqual([
      { id: 'claude-opus-4.8', label: 'Claude Opus 4.8' },
      { id: 'claude-unknown-future-model', label: 'claude-unknown-future-model' },
    ])
  })

  it('returns empty array on malformed cache data', () => {
    mockDb._store.set('anthropic_models_cache', 'not valid json')
    expect(getCachedAnthropicModels()).toEqual([])
  })
})
