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

import { listHermesProfiles, hermesAcpReadiness } from '../cli-detection'

function writeProfile(name: string, files: Record<string, string>): void {
  const dir = join(fakeHome, '.hermes', 'profiles', name)
  mkdirSync(dir, { recursive: true })
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), content)
  }
}

describe('listHermesProfiles', () => {
  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'nexy-hermes-'))
  })

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true })
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
})

describe('hermesAcpReadiness', () => {
  let hermesBin = ''

  beforeEach(() => {
    execSyncMock.mockReset()
    spawnSyncMock.mockReset()
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
})
