import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  exists: vi.fn(() => true),
  stat: vi.fn((): { isFile: () => boolean; isDirectory: () => boolean } => ({ isFile: () => true, isDirectory: () => false })),
  open: vi.fn(() => 11),
  close: vi.fn(),
  realpath: vi.fn((path: string) => path),
  read: vi.fn((_fd: number, buffer: Buffer, _offset: number, length: number) => {
    const bytes = Buffer.from('# Notes\n')
    bytes.copy(buffer, 0, 0, Math.min(bytes.length, length))
    return Math.min(bytes.length, length)
  }),
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:/Users/test') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  dialog: {},
}))

vi.mock('../database', () => ({
  getDatabase: vi.fn(() => ({ prepare: vi.fn(() => ({ get: vi.fn(), run: vi.fn() })) })),
}))

vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  statSync: state.stat,
  existsSync: state.exists,
  readdirSync: vi.fn(() => []),
  openSync: state.open,
  readSync: state.read,
  closeSync: state.close,
  realpathSync: state.realpath,
}))

import { readTextFileForRemote } from '../file-handlers'

describe('readTextFileForRemote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.exists.mockReturnValue(true)
    state.stat.mockReturnValue({ isFile: () => true, isDirectory: () => false })
    state.read.mockImplementation((_fd: number, buffer: Buffer, _offset: number, length: number) => {
      const bytes = Buffer.from('# Notes\n')
      bytes.copy(buffer, 0, 0, Math.min(bytes.length, length))
      return Math.min(bytes.length, length)
    })
    state.realpath.mockImplementation((path: string) => path)
  })

  it('reads Markdown through a bounded descriptor and closes it', () => {
    expect(readTextFileForRemote('C:/project/README.md')).toEqual({
      path: 'C:/project/README.md',
      content: '# Notes\n',
      truncated: false,
    })
    expect(state.open).toHaveBeenCalledWith('C:/project/README.md', 'r')
    expect(state.close).toHaveBeenCalledWith(11)
  })

  it('rejects non-Markdown files before opening them', () => {
    expect(readTextFileForRemote('C:/project/secret.txt').error).toBe('Only Markdown files can be viewed')
    expect(state.open).not.toHaveBeenCalled()
  })

  it('returns a truncation marker without reading beyond the configured limit', () => {
    state.read.mockImplementation((_fd: number, buffer: Buffer, _offset: number, length: number) => {
      buffer.fill(97, 0, length)
      return length
    })

    const result = readTextFileForRemote('C:/project/large.md')
    expect(result.truncated).toBe(true)
    expect(result.content.endsWith('\n\n...[truncated]')).toBe(true)
    expect(state.read).toHaveBeenCalledWith(11, expect.any(Buffer), 0, 512_001, 0)
    expect(state.close).toHaveBeenCalledWith(11)
  })

  it('does not emit a replacement character when truncation meets a UTF-8 sequence', () => {
    state.read.mockImplementation((_fd: number, buffer: Buffer, _offset: number, length: number) => {
      buffer.fill(97, 0, length)
      // The first two bytes of a three-byte euro sign are inside the bounded read;
      // the final byte would be byte 512001 and must not be decoded as replacement text.
      buffer[511_999] = 0xe2
      buffer[512_000] = 0x82
      return length
    })

    const result = readTextFileForRemote('C:/project/utf8.md')
    expect(result.truncated).toBe(true)
    expect(result.content).not.toContain('\ufffd')
    expect(result.content).toContain('\n\n...[truncated]')
  })

  it('reports missing paths and directories clearly', () => {
    state.exists.mockReturnValueOnce(false)
    expect(readTextFileForRemote('C:/missing.md').error).toBe('File not found')

    state.stat.mockReturnValueOnce({ isFile: () => false, isDirectory: () => true })
    expect(readTextFileForRemote('C:/project/docs.md').error).toBe('Not a file')
  })

  it('rejects a path outside the explicitly authorized roots', () => {
    expect(readTextFileForRemote('C:/other/secret.md', ['C:/project'])).toEqual({
      path: 'C:/other/secret.md', content: '', truncated: false,
      error: 'This file is not available through the remote explorer',
    })
    expect(state.open).not.toHaveBeenCalled()
  })

  it('rejects directory listing outside the explicitly authorized roots', async () => {
    const { listDirectoryEntriesForRemote } = await import('../file-handlers')
    expect(listDirectoryEntriesForRemote('C:/other', ['C:/project']).error)
      .toBe('This location is not available through the remote explorer')
  })
})
