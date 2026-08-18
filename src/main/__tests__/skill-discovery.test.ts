import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false }, BrowserWindow: class {} }))
vi.mock('../database', () => ({ getDatabase: vi.fn() }))
vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))

import { hashSkillPackage } from '../skill-packages'
import {
  discoverSkillPackages,
  projectSkillDiscoveryRoots,
  userSkillDiscoveryRoots,
  type SkillDiscoveryRoot,
} from '../skill-discovery'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'nexy-skill-discovery-'))
  roots.push(root)
  return root
}

function writePackage(rootDir: string, slug: string, description = `Use ${slug} when relevant.`): string {
  const pkg = join(rootDir, slug)
  mkdirSync(pkg, { recursive: true })
  writeFileSync(
    join(pkg, 'SKILL.md'),
    `---\nname: ${slug}\ndescription: ${description}\n---\n\n# ${slug}\n\nDo the thing.\n`,
    'utf8',
  )
  return pkg
}

function root(path: string): SkillDiscoveryRoot {
  return { path, label: path, scope: 'user', source: 'filesystem' }
}

describe('skill discovery roots', () => {
  it('builds user roots for the standard harness locations', async () => {
    const built = await userSkillDiscoveryRoots()
    expect(built.map((r) => r.source)).toEqual(expect.arrayContaining(['claude', 'codex', 'filesystem']))
    expect(built.every((r) => r.scope === 'user')).toBe(true)
    expect(built.some((r) => r.label === '~/.claude/skills')).toBe(true)
  })

  it('discovers skills from Hermes profile roots when HERMES_HOME is relocated', async () => {
    const saved = process.env.HERMES_HOME
    const hermesHome = tempRoot()
    mkdirSync(join(hermesHome, 'profiles', 'local', 'skills'), { recursive: true })
    try {
      process.env.HERMES_HOME = join(hermesHome, 'profiles', 'local')
      const built = await userSkillDiscoveryRoots()
      expect(built).toContainEqual(expect.objectContaining({
        path: join(hermesHome, 'profiles', 'local', 'skills'),
        source: 'hermes',
      }))
    } finally {
      if (saved === undefined) delete process.env.HERMES_HOME
      else process.env.HERMES_HOME = saved
    }
  })

  it('honours CODEX_HOME / CLAUDE_CONFIG_DIR overrides and labels them by absolute path', async () => {
    const saved = { CODEX_HOME: process.env.CODEX_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR }
    const codexHome = tempRoot()
    const claudeHome = tempRoot()
    try {
      process.env.CODEX_HOME = codexHome
      process.env.CLAUDE_CONFIG_DIR = claudeHome
      const built = await userSkillDiscoveryRoots()
      const codex = built.find((r) => r.source === 'codex')!
      const claude = built.find((r) => r.source === 'claude')!
      expect(codex.path).toBe(join(codexHome, 'skills'))
      expect(codex.label).toBe(join(codexHome, 'skills'))
      expect(claude.path).toBe(join(claudeHome, 'skills'))
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })

  it('builds project roots per source directory and skips blank paths', () => {
    const built = projectSkillDiscoveryRoots(['/repo/one', '', '   '])
    expect(built).toHaveLength(2)
    expect(built.every((r) => r.scope === 'project')).toBe(true)
    expect(built.map((r) => r.source)).toEqual(['claude', 'filesystem'])
  })
})

describe('discoverSkillPackages', () => {
  it('finds valid SKILL.md packages and ignores non-package directories', async () => {
    const dir = tempRoot()
    writePackage(dir, 'release-notes')
    mkdirSync(join(dir, 'not-a-skill'), { recursive: true }) // no SKILL.md

    const found = await discoverSkillPackages([root(dir)], new Set())
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ name: 'release-notes', validationStatus: 'valid', alreadyImported: false })
    expect(found[0].validationErrors).toEqual([])
    expect(found[0].description).toContain('release-notes')
    expect(found[0].importable).toBe(true)
  })

  it('finds packages nested below category directories', async () => {
    const dir = tempRoot()
    writePackage(join(dir, 'coding'), 'issue-writer')

    const found = await discoverSkillPackages([root(dir)], new Set())
    expect(found).toHaveLength(1)
    expect(found[0].name).toBe('issue-writer')
  })

  it('flags packages whose content hash matches a managed skill as alreadyImported', async () => {
    const dir = tempRoot()
    const pkg = writePackage(dir, 'changelog')
    const hash = hashSkillPackage(pkg)

    const found = await discoverSkillPackages([root(dir)], new Set([hash]))
    expect(found[0].alreadyImported).toBe(true)
  })

  it('reports a malformed package as invalid instead of throwing', async () => {
    const dir = tempRoot()
    const pkg = join(dir, 'broken')
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(pkg, 'SKILL.md'), 'no frontmatter here', 'utf8')

    const found = await discoverSkillPackages([root(dir)], new Set())
    expect(found).toHaveLength(1)
    expect(found[0].validationStatus).toBe('invalid')
    expect(found[0].validationErrors).toContain('description is required and must explain when to use the skill')
    expect(found[0].importable).toBe(true)
  })

  it('deduplicates a package reachable from multiple roots', async () => {
    const dir = tempRoot()
    writePackage(dir, 'shared')
    const found = await discoverSkillPackages([root(dir), root(dir)], new Set())
    expect(found).toHaveLength(1)
  })

  it('skips symlinked entries', async () => {
    const dir = tempRoot()
    const real = writePackage(dir, 'real-skill')
    try {
      symlinkSync(real, join(dir, 'linked-skill'), 'dir')
    } catch {
      return // symlink creation can require privileges on Windows; the real package still validates the scan
    }
    const found = await discoverSkillPackages([root(dir)], new Set())
    expect(found).toHaveLength(1)
    expect(found[0].name).toBe('real-skill')
  })

  it('returns nothing for roots that do not exist', async () => {
    await expect(discoverSkillPackages([root(join(tmpdir(), 'nexy-missing-root-xyz'))], new Set())).resolves.toEqual([])
  })
})
