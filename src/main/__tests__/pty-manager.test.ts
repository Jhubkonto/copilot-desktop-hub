import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSpawn, mockWebContentsFromId, mockBrowserWindowFromWebContents, mockPtyInstance } = vi.hoisted(() => {
  const ptyInstance = {
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  }

  return {
    mockSpawn: vi.fn(() => ptyInstance),
    mockWebContentsFromId: vi.fn(() => ({ id: 1 })),
    mockBrowserWindowFromWebContents: vi.fn(() => null),
    mockPtyInstance: ptyInstance,
  }
})

vi.mock('module', () => ({
  createRequire: vi.fn(() => ((specifier: string) => {
    if (specifier === 'node-pty') {
      return { spawn: mockSpawn }
    }
    throw new Error(`Unexpected require: ${specifier}`)
  })),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: mockBrowserWindowFromWebContents,
  },
  webContents: {
    fromId: mockWebContentsFromId,
  },
}))

import { cleanupAll, killPty, resizePty, spawnPty, writeToPty } from '../pty-manager'

beforeEach(() => {
  vi.clearAllMocks()
  cleanupAll()
})

describe('PTY Manager', () => {
  it('spawnPty returns a sessionId', () => {
    const id = spawnPty(1, 'bash', [], 'C:\\workspace', 80, 24)
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('writeToPty throws on wrong owner', () => {
    const id = spawnPty(1, 'bash', [], 'C:\\workspace', 80, 24)
    expect(() => writeToPty(2, id, 'hello')).toThrow('Unauthorized')
  })

  it('writeToPty succeeds for owner', () => {
    const id = spawnPty(1, 'bash', [], 'C:\\workspace', 80, 24)
    expect(() => writeToPty(1, id, 'hello')).not.toThrow()
    expect(mockPtyInstance.write).toHaveBeenCalledWith('hello')
  })

  it('resizePty throws on wrong owner', () => {
    const id = spawnPty(1, 'bash', [], 'C:\\workspace', 80, 24)
    expect(() => resizePty(2, id, 100, 30)).toThrow('Unauthorized')
  })

  it('killPty removes session', () => {
    const id = spawnPty(1, 'bash', [], 'C:\\workspace', 80, 24)
    killPty(1, id)
    expect(() => writeToPty(1, id, 'data')).toThrow('not found')
  })
})
