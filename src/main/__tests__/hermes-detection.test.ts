import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Standard main-process boilerplate — cli-detection transitively pulls these in.
vi.mock('electron', () => ({ app: { isPackaged: false }, BrowserWindow: class {} }))
vi.mock('../database', () => ({ getDatabase: vi.fn() }))
vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))

// child_process is mocked so readiness probing is deterministic (per CLAUDE.md ESM rule).
const { execSyncMock, spawnSyncMock } = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
  spawnSyncMock: vi.fn(),
}))
vi.mock('child_process', () => ({ execSync: execSyncMock, spawnSync: spawnSyncMock }))

// os.homedir is redirected to a temp fixture root; keep tmpdir real.
let fakeHome = ''
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => fakeHome }
})

import { listHermesProfiles, hermesAcpReadiness, getCliModels } from '../cli-detection'
import { clearCliPathCache } from '../cli-adapters/utils'

function writeProfile(name: string, files: Record<string, string>): void {
  const dir = join(fakeHome, '.hermes', 'profiles', name)
  mkdirSync(dir, { recursive: true })
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), content)
  }
}

describe('listHermesProfiles', () => {
  // The dev machine sets HERMES_HOME to a real path (%LOCALAPPDATA%\hermes) and on Windows
  // the platform default is not ~/.hermes — both would make resolveHermesRoot() escape the
  // fixture. Pin HERMES_HOME to the fixture root so enumeration is hermetic on every platform.
  const savedHermesHome = process.env['HERMES_HOME']

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'nexy-hermes-'))
    process.env['HERMES_HOME'] = join(fakeHome, '.hermes')
  })

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true })
    if (savedHermesHome === undefined) delete process.env['HERMES_HOME']
    else process.env['HERMES_HOME'] = savedHermesHome
    execSyncMock.mockReset()
    spawnSyncMock.mockReset()
  })

  it('synthesizes a default entry when no profiles dir exists', () => {
    const profiles = listHermesProfiles()
    expect(profiles).toEqual([{ name: 'default', isDefault: true }])
  })

  it('enumerates named profiles with model/provider and SOUL description', () => {
    writeProfile('localllm', {
      'config.yaml': 'model:\n  provider: ollama\n  default: qwen3\n',
      'SOUL.md': '# Heading\n\nA local-first coding assistant.\n',
    })
    writeProfile('localllm-iso', {
      'config.yaml': 'model:\n  provider: anthropic\n  default: claude-opus-4-8\n',
    })

    const profiles = listHermesProfiles()

    expect(profiles[0]).toEqual({ name: 'default', isDefault: true })
    // Named profiles are sorted and follow the default entry.
    expect(profiles.map((p) => p.name)).toEqual(['default', 'localllm', 'localllm-iso'])

    const localllm = profiles.find((p) => p.name === 'localllm')!
    expect(localllm).toMatchObject({
      isDefault: false,
      model: 'qwen3',
      provider: 'ollama',
      description: 'A local-first coding assistant.',
    })

    const iso = profiles.find((p) => p.name === 'localllm-iso')!
    expect(iso).toMatchObject({ model: 'claude-opus-4-8', provider: 'anthropic' })
    expect(iso.description).toBeUndefined()
  })

  it('ignores a profiles/default subdir (default is always synthetic) and non-directories', () => {
    writeProfile('default', { 'config.yaml': 'model:\n  default: ignored\n' })
    mkdirSync(join(fakeHome, '.hermes', 'profiles'), { recursive: true })
    writeFileSync(join(fakeHome, '.hermes', 'profiles', 'stray.txt'), 'not a profile')
    writeProfile('real', {})

    const profiles = listHermesProfiles()
    expect(profiles.map((p) => p.name)).toEqual(['default', 'real'])
    // The synthetic default carries no model from the on-disk default/ dir.
    expect(profiles.find((p) => p.name === 'default')!.model).toBeUndefined()
  })

  it('honors a relocated HERMES_HOME instead of hardcoding ~/.hermes', () => {
    // Regression: HERMES_HOME points at a custom root (as on native Windows,
    // %LOCALAPPDATA%\hermes). Profiles there must still be found.
    const customRoot = join(fakeHome, 'AppData', 'Local', 'hermes')
    mkdirSync(join(customRoot, 'profiles', 'localllm'), { recursive: true })
    writeFileSync(
      join(customRoot, 'profiles', 'localllm', 'config.yaml'),
      'model:\n  provider: ollama\n  default: qwen3\n',
    )
    process.env['HERMES_HOME'] = customRoot

    const profiles = listHermesProfiles()
    expect(profiles.map((p) => p.name)).toEqual(['default', 'localllm'])
  })

  it('climbs from a profile-mode HERMES_HOME to enumerate sibling profiles', () => {
    // HERMES_HOME may point at a specific profile dir (<root>/profiles/<name>); the
    // enumerator should still see all siblings under <root>/profiles.
    const root = join(fakeHome, 'AppData', 'Local', 'hermes')
    for (const name of ['localllm', 'localllm-iso']) {
      mkdirSync(join(root, 'profiles', name), { recursive: true })
    }
    process.env['HERMES_HOME'] = join(root, 'profiles', 'localllm')

    const profiles = listHermesProfiles()
    expect(profiles.map((p) => p.name)).toEqual(['default', 'localllm', 'localllm-iso'])
  })
})

describe('getCliModels(hermes-cli) profile scoping', () => {
  const savedHermesHome = process.env['HERMES_HOME']

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'nexy-hermes-models-'))
    process.env['HERMES_HOME'] = join(fakeHome, '.hermes')
    // Root/default config points at a distinct model (not one of the hardcoded HERMES_DEFAULT_MODELS,
    // so a leak from the default config is unambiguously detectable); a named profile points at a local model.
    mkdirSync(join(fakeHome, '.hermes'), { recursive: true })
    writeFileSync(
      join(fakeHome, '.hermes', 'config.yaml'),
      'model:\n  provider: anthropic\n  default: claude-root-only\n',
    )
    writeProfile('localllm', {
      'config.yaml': 'model:\n  provider: openai-api\n  default: Qwen3.6-35B-A3B-AWQ-4bit\n',
    })
  })

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true })
    if (savedHermesHome === undefined) delete process.env['HERMES_HOME']
    else process.env['HERMES_HOME'] = savedHermesHome
  })

  it('reads the named profile config, not the default, when a profile is passed', () => {
    const models = getCliModels('hermes-cli', 'localllm')
    expect(models[0]).toEqual({
      id: 'openai-api/Qwen3.6-35B-A3B-AWQ-4bit',
      label: 'Qwen3.6-35B-A3B-AWQ-4bit (openai-api)',
    })
    // The default profile's Anthropic model must not leak into a profile-scoped list.
    expect(models.some((m) => m.id === 'anthropic/claude-root-only')).toBe(false)
  })

  it('parses a CRLF-terminated profile config (Hermes writes CRLF on Windows)', () => {
    // Regression: config.yaml written with CRLF made the YAML block regex miss `model:\r\n`,
    // so the profile reported no models and the picker fell back to the hardcoded defaults.
    writeProfile('crlf', {
      'config.yaml': 'model:\r\n  provider: openai-api\r\n  default: Qwen3.6-35B-A3B-AWQ-4bit\r\n',
    })
    const models = getCliModels('hermes-cli', 'crlf')
    expect(models[0]).toEqual({
      id: 'openai-api/Qwen3.6-35B-A3B-AWQ-4bit',
      label: 'Qwen3.6-35B-A3B-AWQ-4bit (openai-api)',
    })
  })

  it('reads the root config for the default (or omitted) profile', () => {
    for (const models of [getCliModels('hermes-cli'), getCliModels('hermes-cli', 'default')]) {
      expect(models[0]).toEqual({
        id: 'anthropic/claude-root-only',
        label: 'claude-root-only (anthropic)',
      })
    }
  })
})

describe('hermesAcpReadiness', () => {
  let hermesBin = ''

  beforeEach(() => {
    execSyncMock.mockReset()
    spawnSyncMock.mockReset()
    // findCli('hermes') now resolves through the shared resolveCliPath cache; clear it so a
    // negative from the "binary absent" case doesn't leak (within its 15s TTL) into the next.
    clearCliPathCache()
    // findCli('hermes') resolves via where/which then verifies existsSync(path),
    // so point it at a real temp file that stands in for the hermes binary.
    const dir = mkdtempSync(join(tmpdir(), 'nexy-hermes-bin-'))
    hermesBin = join(dir, 'hermes')
    writeFileSync(hermesBin, '')
    execSyncMock.mockReturnValue(`${hermesBin}\n`)
  })

  afterEach(() => {
    rmSync(join(hermesBin, '..'), { recursive: true, force: true })
  })

  afterAll(() => {
    execSyncMock.mockReset()
    spawnSyncMock.mockReset()
  })

  it('reports not-ready when the binary is absent', () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('not found')
    })
    const readiness = hermesAcpReadiness(true)
    expect(readiness.ready).toBe(false)
    expect(readiness.detail).toMatch(/not found/i)
  })

  it('reports ready with version when acp --check exits 0', () => {
    spawnSyncMock.mockImplementation((_exe: string, args: string[]) => {
      if (args.includes('--version')) return { status: 0, stdout: 'hermes 0.17.0\n', stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    })
    const readiness = hermesAcpReadiness(true)
    expect(readiness).toEqual({ ready: true, version: 'hermes 0.17.0' })
  })

  it('reports not-ready with stderr detail on non-zero check exit', () => {
    spawnSyncMock.mockImplementation((_exe: string, args: string[]) => {
      if (args.includes('--version')) return { status: 0, stdout: 'hermes 0.17.0\n', stderr: '' }
      return { status: 1, stdout: '', stderr: 'no provider credentials configured\n' }
    })
    const readiness = hermesAcpReadiness(true)
    expect(readiness.ready).toBe(false)
    expect(readiness.version).toBe('hermes 0.17.0')
    expect(readiness.detail).toBe('no provider credentials configured')
  })

  it('caches the result until force re-probe', () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    hermesAcpReadiness(true)
    const callsAfterForce = spawnSyncMock.mock.calls.length
    hermesAcpReadiness() // cached — no new spawn
    expect(spawnSyncMock.mock.calls.length).toBe(callsAfterForce)
    hermesAcpReadiness(true) // force — re-probes
    expect(spawnSyncMock.mock.calls.length).toBeGreaterThan(callsAfterForce)
  })

  it('re-probes automatically once the cache TTL lapses, without an explicit force', () => {
    vi.useFakeTimers()
    try {
      spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '' })
      hermesAcpReadiness(true)
      const baseline = spawnSyncMock.mock.calls.length
      hermesAcpReadiness() // still within TTL — served from cache
      expect(spawnSyncMock.mock.calls.length).toBe(baseline)
      vi.advanceTimersByTime(31_000) // past the 30s readiness TTL
      hermesAcpReadiness() // stale — re-probes even without force (e.g. credentials since added)
      expect(spawnSyncMock.mock.calls.length).toBeGreaterThan(baseline)
    } finally {
      vi.useRealTimers()
    }
  })
})
