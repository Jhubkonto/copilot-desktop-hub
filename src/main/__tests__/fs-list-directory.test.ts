import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join, sep } from 'path'
import { tmpdir } from 'os'
import { listDirectoryEntries } from '../ipc-handlers'

// Helper — build a relative path that uses forward-slashes on all platforms
const rel = (...parts: string[]) => parts.join('/')

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'copilot-test-'))
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('listDirectoryEntries — basic structure', () => {
  it('r1-1: returns files and directories at the top level', () => {
    writeFileSync(join(tmpRoot, 'README.md'), '')
    mkdirSync(join(tmpRoot, 'src'))
    writeFileSync(join(tmpRoot, 'src', 'index.ts'), '')

    const entries = listDirectoryEntries(tmpRoot, 3, '')
    const names = entries.map((e) => e.name)
    expect(names).toContain('README.md')
    expect(names).toContain('src')
    expect(names).toContain('index.ts')
  })

  it('r1-2: file entries have type "file" and correct relativePath', () => {
    writeFileSync(join(tmpRoot, 'main.ts'), '')
    const entries = listDirectoryEntries(tmpRoot, 3, '')
    const file = entries.find((e) => e.name === 'main.ts')
    expect(file).toBeDefined()
    expect(file!.type).toBe('file')
    expect(file!.relativePath).toBe('main.ts')
  })

  it('r1-3: directory entries have type "dir" and correct relativePath', () => {
    mkdirSync(join(tmpRoot, 'components'))
    const entries = listDirectoryEntries(tmpRoot, 3, '')
    const dir = entries.find((e) => e.name === 'components')
    expect(dir).toBeDefined()
    expect(dir!.type).toBe('dir')
    expect(dir!.relativePath).toBe('components')
  })

  it('r1-4: nested file relativePath uses forward-slash separator', () => {
    mkdirSync(join(tmpRoot, 'src'))
    writeFileSync(join(tmpRoot, 'src', 'app.ts'), '')
    const entries = listDirectoryEntries(tmpRoot, 3, '')
    const nested = entries.find((e) => e.name === 'app.ts')
    expect(nested).toBeDefined()
    expect(nested!.relativePath).toBe(rel('src', 'app.ts'))
  })
})

describe('listDirectoryEntries — depth limiting', () => {
  beforeEach(() => {
    // depth1/depth2/depth3/depth4.txt
    mkdirSync(join(tmpRoot, 'depth1'))
    mkdirSync(join(tmpRoot, 'depth1', 'depth2'))
    mkdirSync(join(tmpRoot, 'depth1', 'depth2', 'depth3'))
    writeFileSync(join(tmpRoot, 'depth1', 'depth2', 'depth3', 'deep.txt'), '')
  })

  it('r1-5: depth=1 returns only top-level entries', () => {
    const entries = listDirectoryEntries(tmpRoot, 1, '')
    const names = entries.map((e) => e.name)
    expect(names).toContain('depth1')
    expect(names).not.toContain('depth2')
    expect(names).not.toContain('deep.txt')
  })

  it('r1-6: depth=2 returns one level of nesting', () => {
    const entries = listDirectoryEntries(tmpRoot, 2, '')
    const names = entries.map((e) => e.name)
    expect(names).toContain('depth1')
    expect(names).toContain('depth2')
    expect(names).not.toContain('depth3')
  })

  it('r1-7: depth=3 returns two levels of nesting but not the file at level 4', () => {
    const entries = listDirectoryEntries(tmpRoot, 3, '')
    const names = entries.map((e) => e.name)
    expect(names).toContain('depth3')
    expect(names).not.toContain('deep.txt')
  })

  it('r1-8: depth=4 returns all levels including the deepest file', () => {
    const entries = listDirectoryEntries(tmpRoot, 4, '')
    const names = entries.map((e) => e.name)
    expect(names).toContain('deep.txt')
  })
})

describe('listDirectoryEntries — ignored directories', () => {
  const IGNORED = [
    'node_modules', '.git', 'dist', '.next', '__pycache__',
    '.cache', 'coverage', '.nyc_output', 'build', 'out',
  ]

  for (const dir of IGNORED) {
    it(`r1-9: ignores "${dir}" directory`, () => {
      mkdirSync(join(tmpRoot, dir))
      writeFileSync(join(tmpRoot, dir, 'inside.txt'), '')
      const entries = listDirectoryEntries(tmpRoot, 3, '')
      const names = entries.map((e) => e.name)
      expect(names).not.toContain(dir)
      expect(names).not.toContain('inside.txt')
    })
  }

  it('r1-10: non-ignored directories alongside ignored ones are still returned', () => {
    mkdirSync(join(tmpRoot, 'node_modules'))
    mkdirSync(join(tmpRoot, 'src'))
    writeFileSync(join(tmpRoot, 'src', 'index.ts'), '')
    const entries = listDirectoryEntries(tmpRoot, 3, '')
    const names = entries.map((e) => e.name)
    expect(names).not.toContain('node_modules')
    expect(names).toContain('src')
    expect(names).toContain('index.ts')
  })
})

describe('listDirectoryEntries — edge cases', () => {
  it('r1-11: empty directory returns empty array', () => {
    const entries = listDirectoryEntries(tmpRoot, 3, '')
    expect(entries).toEqual([])
  })

  it('r1-12: depth=0 returns empty array', () => {
    writeFileSync(join(tmpRoot, 'file.ts'), '')
    const entries = listDirectoryEntries(tmpRoot, 0, '')
    expect(entries).toEqual([])
  })

  it('r1-13: relBase is prepended to relativePath of all entries', () => {
    writeFileSync(join(tmpRoot, 'util.ts'), '')
    const entries = listDirectoryEntries(tmpRoot, 3, 'parent')
    const entry = entries.find((e) => e.name === 'util.ts')
    expect(entry!.relativePath).toBe('parent/util.ts')
  })
})
