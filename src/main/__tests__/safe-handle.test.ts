import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Hoisted mocks ─────────────────────────────────────────── */
const { mockIpcMain } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    mockIpcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      _handlers: handlers
    }
  }
})

vi.mock('electron', () => ({
  ipcMain: mockIpcMain
}))

import { safeHandle } from '../safe-handle'

beforeEach(() => {
  vi.clearAllMocks()
})

async function invokeHandler(channel: string, ...args: unknown[]): Promise<any> {
  const handler = mockIpcMain._handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  const fakeEvent = { sender: { id: 1 } }
  return handler(fakeEvent, ...args)
}

describe('safeHandle', () => {
  it('registers a handler on ipcMain.handle', () => {
    safeHandle('test:channel', () => 'ok')
    expect(mockIpcMain.handle).toHaveBeenCalledWith('test:channel', expect.any(Function))
  })

  it('returns handler result on success', async () => {
    safeHandle('test:success', () => ({ data: 42 }))
    const result = await invokeHandler('test:success')
    expect(result).toEqual({ data: 42 })
  })

  it('returns { error } on thrown Error', async () => {
    safeHandle('test:error', () => {
      throw new Error('something broke')
    })
    const result = await invokeHandler('test:error')
    expect(result).toEqual({ error: 'something broke' })
  })

  it('returns { error: "Unknown error" } for non-Error throws', async () => {
    safeHandle('test:unknown', () => {
      throw 'string error'
    })
    const result = await invokeHandler('test:unknown')
    expect(result).toEqual({ error: 'Unknown error' })
  })

  it('handles async handlers that resolve', async () => {
    safeHandle('test:async', async () => {
      return { async: true }
    })
    const result = await invokeHandler('test:async')
    expect(result).toEqual({ async: true })
  })

  it('catches async handler rejections', async () => {
    safeHandle('test:async-err', async () => {
      throw new Error('async fail')
    })
    const result = await invokeHandler('test:async-err')
    expect(result).toEqual({ error: 'async fail' })
  })

  it('passes event and args to the underlying handler', async () => {
    const spy = vi.fn((_event, a: string, b: number) => `${a}-${b}`)
    safeHandle('test:args', spy)
    const result = await invokeHandler('test:args', 'hello', 42)
    expect(result).toBe('hello-42')
    expect(spy).toHaveBeenCalledWith(expect.anything(), 'hello', 42)
  })
})
