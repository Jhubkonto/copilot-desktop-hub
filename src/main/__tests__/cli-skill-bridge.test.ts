import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false }, BrowserWindow: class {} }))
vi.mock('../database', () => ({ getDatabase: vi.fn() }))
vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))

const { homedirMock } = vi.hoisted(() => ({ homedirMock: vi.fn<() => string>() }))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: homedirMock, default: { ...actual, homedir: homedirMock } }
})

import {
  bridgeSkillsForCliRun,
  bridgeSkillsToRoot,
  cleanupManagedSkillsInRoot,
  cliSkillsRoot,
  releaseBridgedSkills,
} from '../cli-skill-bridge'
import type { SkillConfig } from '../../shared/types'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  homedirMock.mockReset()
})

function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

/** Creates a managed skill package on disk and returns a SkillConfig pointing at it. */
function makeSkill(id: string, slug: string, extraFile?: { path: string; body: string }): SkillConfig {
  const base = tempDir('nexy-managed-')
  const pkg = join(base, slug)
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'SKILL.md'), `---\nname: ${slug}\ndescription: Use ${slug}.\n---\n\n# ${slug}\n`, 'utf8')
  if (extraFile) {
    mkdirSync(join(pkg, extraFile.path, '..'), { recursive: true })
    writeFileSync(join(pkg, extraFile.path), extraFile.body, 'utf8')
  }
  return {
    id,
    name: slug,
    icon: '✨',
    description: `Use ${slug}.`,
    instructions: '',
    tags: [],
    tools: {
      fileEdit: { enabled: false, approval: 'always-ask', instructions: '' },
      terminal: { enabled: false, approval: 'always-ask', instructions: '' },
      webFetch: { enabled: false, approval: 'always-ask', instructions: '' },
    },
    mcpServers: [],
    mcpToolOverrides: [],
    mcpServerTrust: [],
    knowledge: [],
    packagePath: pkg,
    scope: 'user',
    source: 'nexy',
    validationStatus: 'valid',
    frontmatter: { name: slug },
  }
}

describe('cliSkillsRoot', () => {
  const savedEnv = { CODEX_HOME: process.env.CODEX_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR }
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('maps CLI backends to their harness skills directories and ignores others', () => {
    homedirMock.mockReturnValue('/home/tester')
    delete process.env.CODEX_HOME
    delete process.env.CLAUDE_CONFIG_DIR
    expect(cliSkillsRoot('claude-cli')).toBe(join('/home/tester', '.claude', 'skills'))
    expect(cliSkillsRoot('codex-cli')).toBe(join('/home/tester', '.codex', 'skills'))
    expect(cliSkillsRoot('hermes-cli')).toBeNull()
    expect(cliSkillsRoot('anthropic')).toBeNull()
  })

  it('honours CODEX_HOME and CLAUDE_CONFIG_DIR overrides', () => {
    homedirMock.mockReturnValue(tempDir('nexy-home-'))
    const codexHome = tempDir('nexy-codex-home-')
    const claudeHome = tempDir('nexy-claude-home-')
    process.env.CODEX_HOME = codexHome
    process.env.CLAUDE_CONFIG_DIR = claudeHome
    expect(cliSkillsRoot('codex-cli')).toBe(join(codexHome, 'skills'))
    expect(cliSkillsRoot('claude-cli')).toBe(join(claudeHome, 'skills'))
  })

  it('ignores a blank override and falls back to the default home', () => {
    homedirMock.mockReturnValue('/home/tester')
    process.env.CODEX_HOME = '   '
    expect(cliSkillsRoot('codex-cli')).toBe(join('/home/tester', '.codex', 'skills'))
  })
})

describe('bridgeSkillsToRoot', () => {
  it('copies a skill package and marks it as Nexy-managed', () => {
    const root = tempDir('nexy-cli-skills-')
    const skill = makeSkill('s1', 'release-notes', { path: 'references/guide.md', body: 'ref body' })

    const bridged = bridgeSkillsToRoot(root, [skill])

    expect(bridged).toHaveLength(1)
    const target = join(root, 'release-notes')
    expect(bridged[0].targetPath).toBe(target)
    expect(existsSync(join(target, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(target, 'references', 'guide.md'))).toBe(true)
    const marker = JSON.parse(readFileSync(join(target, '.nexy-managed.json'), 'utf8'))
    expect(marker).toMatchObject({ managedBy: 'nexy', skillId: 's1' })
  })

  it('re-bridging the same skill overwrites the prior copy in place', () => {
    const root = tempDir('nexy-cli-skills-')
    bridgeSkillsToRoot(root, [makeSkill('s1', 'changelog', { path: 'notes.md', body: 'v1' })])
    bridgeSkillsToRoot(root, [makeSkill('s1', 'changelog', { path: 'notes.md', body: 'v2' })])

    expect(readFileSync(join(root, 'changelog', 'notes.md'), 'utf8')).toBe('v2')
  })

  it('never overwrites a user-owned directory of the same slug', () => {
    const root = tempDir('nexy-cli-skills-')
    const userDir = join(root, 'shared')
    mkdirSync(userDir, { recursive: true })
    writeFileSync(join(userDir, 'SKILL.md'), '# user owned', 'utf8')

    const bridged = bridgeSkillsToRoot(root, [makeSkill('s1', 'shared')])

    expect(readFileSync(join(userDir, 'SKILL.md'), 'utf8')).toBe('# user owned')
    expect(existsSync(join(userDir, '.nexy-managed.json'))).toBe(false)
    expect(bridged[0].targetPath).toBe(join(root, 'shared-nexy'))
  })

  it('skips skills without a materialised package', () => {
    const root = tempDir('nexy-cli-skills-')
    const skill = makeSkill('s1', 'ok')
    const broken = { ...makeSkill('s2', 'broken'), packagePath: join(tmpdir(), 'nexy-does-not-exist-xyz') }

    const bridged = bridgeSkillsToRoot(root, [skill, broken])
    expect(bridged.map((b) => b.skillId)).toEqual(['s1'])
  })
})

describe('cleanupManagedSkillsInRoot', () => {
  it('removes Nexy-managed directories but leaves user skills intact', () => {
    const root = tempDir('nexy-cli-skills-')
    const userDir = join(root, 'user-skill')
    mkdirSync(userDir, { recursive: true })
    writeFileSync(join(userDir, 'SKILL.md'), '# user', 'utf8')
    bridgeSkillsToRoot(root, [makeSkill('s1', 'bridged-one'), makeSkill('s2', 'bridged-two')])

    const removed = cleanupManagedSkillsInRoot(root)

    expect(removed).toBe(2)
    expect(existsSync(userDir)).toBe(true)
    expect(readdirSync(root)).toEqual(['user-skill'])
  })
})

describe('bridgeSkillsForCliRun reference counting', () => {
  it('keeps a shared package until the last run releases it', () => {
    const home = tempDir('nexy-home-')
    homedirMock.mockReturnValue(home)
    const target = join(home, '.claude', 'skills', 'shared-skill')

    // Two concurrent runs bridge the same skill through the ref-counted public path.
    const runA = bridgeSkillsForCliRun('claude-cli', [makeSkill('s1', 'shared-skill')])
    const runB = bridgeSkillsForCliRun('claude-cli', [makeSkill('s1', 'shared-skill')])
    expect(existsSync(target)).toBe(true)

    // Run A finishing must not pull the skill out from under still-running run B.
    releaseBridgedSkills(runA)
    expect(existsSync(target)).toBe(true)

    releaseBridgedSkills(runB)
    expect(existsSync(target)).toBe(false)
  })

  it('returns nothing for a backend without on-disk skill discovery', () => {
    homedirMock.mockReturnValue(tempDir('nexy-home-'))
    expect(bridgeSkillsForCliRun('hermes-cli', [makeSkill('s1', 'x')])).toEqual([])
  })
})
