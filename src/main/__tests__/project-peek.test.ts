import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  exists: vi.fn(() => true),
  realpath: vi.fn((value: string) => value),
  readdir: vi.fn(() => ['README.md', 'diagram.png', 'src']),
  stat: vi.fn((value: string) => ({
    isDirectory: () => value.endsWith('src') || value.endsWith('project'),
    isFile: () => !value.endsWith('src') && !value.endsWith('project'),
    size: 42,
    mtimeMs: value.endsWith('README.md') ? 10 : 20,
  })),
}))

vi.mock('fs', () => ({
  existsSync: state.exists,
  realpathSync: state.realpath,
  readdirSync: state.readdir,
  statSync: state.stat,
}))

vi.mock('../file-handlers', () => ({
  isRemoteImagePath: (path: string) => /\.(png|jpe?g)$/i.test(path),
}))

import { listProjectPeekDirectory, resolveProjectPeekPath } from '../project-peek'

const source = {
  id: 'source-1', projectId: 'project-1', label: 'Nexy', localPath: 'C:\\project', enabled: true, isPrimary: true,
}

describe('Project Peek paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.exists.mockReturnValue(true)
    state.realpath.mockImplementation((value: string) => value)
  })

  it('resolves only safe source-relative paths', () => {
    expect(resolveProjectPeekPath(source.localPath, 'docs/README.md')).toBe('C:\\project\\docs\\README.md')
    expect(resolveProjectPeekPath(source.localPath, '../secret.md')).toBeNull()
    expect(resolveProjectPeekPath(source.localPath, '/etc/passwd')).toBeNull()
    expect(resolveProjectPeekPath(source.localPath, 'C:\\Windows\\win.ini')).toBeNull()
  })

  it('rejects symlinks that resolve outside the source root', () => {
    state.realpath.mockImplementation((value: string) => value === 'C:\\project\\linked.md' ? 'C:\\outside\\linked.md' : value)
    expect(resolveProjectPeekPath(source.localPath, 'linked.md')).toBeNull()
  })

  it('lists source-relative entries and filters documents without exposing desktop paths', () => {
    expect(listProjectPeekDirectory(source, '', 'documents')).toEqual({
      entries: [{
        name: 'README.md', relativePath: 'README.md', type: 'file', category: 'document',
        sizeBytes: 42, modifiedAt: 10, gitState: 'unknown',
      }],
      truncated: false,
    })
  })

  it('sorts recently changed entries newest first', () => {
    expect(listProjectPeekDirectory(source, '', 'recent')).toMatchObject({
      entries: [
        { name: 'diagram.png', relativePath: 'diagram.png', category: 'image', modifiedAt: 20 },
        { name: 'README.md', relativePath: 'README.md', category: 'document', modifiedAt: 10 },
      ],
    })
  })
})
