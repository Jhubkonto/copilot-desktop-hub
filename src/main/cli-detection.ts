import { execFile } from 'child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, dirname, isAbsolute, join, relative } from 'path'
import { homedir } from 'os'
import type { CliInstallStatus, HermesProfileInfo, HermesAcpReadiness } from '../shared/types'
import { HERMES_DEFAULT_PROFILE } from '../shared/hermes'
import { safeHandle } from './safe-handle'
import { CODEX_DEFAULT_MODELS } from './cli-adapters/codex'
import { resolveCliPathAsync } from './cli-adapters/utils'
import { getCachedAnthropicModels } from './anthropic-models'
import { getCachedClaudeCliPtyModels } from './cli-adapters/claude-model-probe'

type CliModelOption = { id: string; label: string }

const CLAUDE_DEFAULT_MODELS: CliModelOption[] = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
]

function readCodexConfigModel(): string | null {
  try {
    const { readFileSync } = require('fs') as typeof import('fs')
    const tomlPath = join(homedir(), '.codex', 'config.toml')
    const content = readFileSync(tomlPath, 'utf8')
    const match = /^\s*model\s*=\s*["']?([^"'\s\n]+)["']?/m.exec(content)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

function readCodexCachedModels(): CliModelOption[] {
  try {
    const cachePath = join(homedir(), '.codex', 'models_cache.json')
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as {
      models?: Array<{
        slug?: unknown
        display_name?: unknown
        visibility?: unknown
        priority?: unknown
      }>
    }
    return (parsed.models ?? [])
      .filter((model) => model.visibility === 'list' && typeof model.slug === 'string')
      .sort((a, b) => {
        const aPriority = typeof a.priority === 'number' ? a.priority : Number.MAX_SAFE_INTEGER
        const bPriority = typeof b.priority === 'number' ? b.priority : Number.MAX_SAFE_INTEGER
        return aPriority - bPriority
      })
      .map((model) => ({
        id: model.slug as string,
        label: typeof model.display_name === 'string' ? model.display_name : model.slug as string,
      }))
  } catch {
    return []
  }
}

function withPreferredModelFirst(models: CliModelOption[], preferredModel: string | null): CliModelOption[] {
  if (!preferredModel) return models
  const existing = models.find((model) => model.id === preferredModel)
  if (existing) {
    return [existing, ...models.filter((model) => model.id !== preferredModel)]
  }
  return [{ id: preferredModel, label: preferredModel }, ...models]
}

function runCliVersion(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      if (error || typeof stdout !== 'string') {
        resolve(null)
        return
      }
      resolve(stdout.trim().split(/\r?\n/)[0] || null)
    })
  })
}

async function findCopilotCli(): Promise<CliInstallStatus> {
  // Try common CLI names
  const cliNames = ['github-copilot-cli', 'copilot']
  const isWindows = process.platform === 'win32'

  for (const name of cliNames) {
    // Shared resolver: capped timeout, CRLF-safe splitting, TTL-cached negatives.
    const cliPath = await resolveCliPathAsync(name)
    if (cliPath && existsSync(cliPath)) {
      const version = await runCliVersion(cliPath)
      return { installed: true, path: cliPath, version }
    }
  }

  // Check common install locations
  const commonPaths = isWindows
    ? [
        join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'GitHub Copilot CLI', 'copilot.exe'),
        join(process.env['PROGRAMFILES'] ?? '', 'GitHub Copilot CLI', 'copilot.exe')
      ]
    : [
        '/usr/local/bin/github-copilot-cli',
        '/usr/local/bin/copilot',
        join(process.env['HOME'] ?? '', '.local', 'bin', 'github-copilot-cli')
      ]

  for (const p of commonPaths) {
    if (p && existsSync(p)) {
      return { installed: true, path: p, version: null }
    }
  }

  return { installed: false, path: null, version: null }
}

async function findCli(command: string): Promise<CliInstallStatus> {
  // Single source of truth for "where is this CLI" — the same resolver the adapters spawn
  // through, so the install badge can never disagree with what a spawn will actually find.
  // The shared async resolver caps the probe timeout, splits CRLF safely, and TTL-caches
  // negatives; the existsSync guard still catches a CLI removed after a positive was cached.
  const cliPath = await resolveCliPathAsync(command)
  if (!cliPath || !existsSync(cliPath)) {
    return { installed: false, path: null, version: null }
  }

  const version = await runCliVersion(cliPath)

  return { installed: true, path: cliPath, version }
}

const HERMES_DEFAULT_MODELS: CliModelOption[] = [
  { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Anthropic)' },
  { id: 'anthropic/claude-opus-4-8', label: 'Claude Opus 4.8 (Anthropic)' },
  { id: 'openrouter/auto', label: 'Auto (OpenRouter)' },
]

/**
 * Platform-native default Hermes home — `%LOCALAPPDATA%\hermes` on Windows,
 * `~/.hermes` on POSIX. Mirrors Hermes's `_get_platform_default_hermes_home()`.
 * `~/.hermes` is NOT the default on Windows, so hardcoding it there finds nothing.
 */
function platformDefaultHermesHome(): string {
  if (process.platform === 'win32') {
    const localAppData = (process.env['LOCALAPPDATA'] ?? '').trim()
    const base = localAppData || join(homedir(), 'AppData', 'Local')
    return join(base, 'hermes')
  }
  return join(homedir(), '.hermes')
}

/**
 * Resolve the Hermes root — the directory under which named profiles live
 * (`<root>/profiles/<name>`) and the default profile's `config.yaml` sits.
 * Mirrors Hermes's `get_default_hermes_root()`:
 *   - honors the `HERMES_HOME` env var (the user may relocate their whole home);
 *   - if `HERMES_HOME` is itself a profile dir (`<root>/profiles/<name>`), climbs
 *     back to `<root>` so all sibling profiles are still enumerable;
 *   - otherwise falls back to the platform-native default.
 */
function resolveHermesRoot(): string {
  const nativeHome = platformDefaultHermesHome()
  const envHome = (process.env['HERMES_HOME'] ?? '').trim()
  if (!envHome) return nativeHome
  // HERMES_HOME is the native home itself or a subdir of it (normal or profile mode).
  const rel = relative(nativeHome, envHome)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return nativeHome
  // Docker/custom relocation: if HERMES_HOME is `<root>/profiles/<name>`, root is the grandparent.
  if (basename(dirname(envHome)) === 'profiles') return dirname(dirname(envHome))
  // Otherwise HERMES_HOME itself is the root.
  return envHome
}

/**
 * Extracts a top-level YAML block's raw text (from `key:` up to the next line starting at
 * column 0) without a full YAML parser — Hermes's config.yaml nests `default`/`provider` under
 * `model:`, `auxiliary:`, etc. and a flat regex over the whole file would grab the wrong section.
 *
 * `content` is normalized to LF first: Hermes writes `config.yaml` with CRLF line endings on
 * Windows, and a `\r`-agnostic `^${key}:\\n` would never match `model:\r\n`, silently yielding
 * no models → the picker falls back to the hardcoded defaults for the wrong profile.
 */
function extractYamlBlock(content: string, key: string): string | null {
  const match = new RegExp(`^${key}:\\n((?:[ \\t]+.*\\n?)*)`, 'm').exec(content.replace(/\r\n/g, '\n'))
  return match?.[1] ?? null
}

function readYamlScalar(block: string, key: string): string | null {
  const match = new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n#]+?)["']?\\s*(?:#.*)?$`, 'm').exec(block)
  return match?.[1]?.trim() || null
}

/**
 * Resolves the `config.yaml` for a given Hermes profile. The synthetic `default`
 * profile (the no-`--profile` case) reads the root config; a named profile reads
 * its own isolated `<root>/profiles/<name>/config.yaml`. Mirrors how a
 * Nexy-launched `hermes --profile <name>` session resolves its own home.
 */
function hermesProfileConfigPath(profile?: string): string {
  const root = resolveHermesRoot()
  if (!profile || profile === HERMES_DEFAULT_PROFILE) return join(root, 'config.yaml')
  return join(root, 'profiles', profile, 'config.yaml')
}

/**
 * Hermes has no model-listing command (unlike Claude's PTY probe or Codex's models_cache.json) —
 * `config.yaml`'s `model.default`/`model.provider` and `fallback_providers` chain are the only
 * on-disk signal of what the user actually has configured, so this is the closest equivalent to
 * `readCodexConfigModel()`/`readCodexCachedModels()`. When a named profile is passed, its own
 * isolated `profiles/<name>/config.yaml` is read instead of the root/default config — otherwise a
 * profile-scoped agent shows the default profile's models (wrong provider/model in the picker).
 */
function readHermesConfigModels(profile?: string): CliModelOption[] {
  try {
    const yamlPath = hermesProfileConfigPath(profile)
    const content = readFileSync(yamlPath, 'utf8')
    const models: CliModelOption[] = []
    const seen = new Set<string>()
    const addModel = (provider: string | null, model: string | null) => {
      if (!model) return
      const id = provider && !model.includes('/') ? `${provider}/${model}` : model
      if (seen.has(id)) return
      seen.add(id)
      models.push({ id, label: provider ? `${model} (${provider})` : model })
    }

    const modelBlock = extractYamlBlock(content, 'model')
    if (modelBlock) {
      addModel(readYamlScalar(modelBlock, 'provider'), readYamlScalar(modelBlock, 'default'))
    }

    const fallbackBlock = extractYamlBlock(content, 'fallback_providers')
    if (fallbackBlock) {
      for (const entryBlock of fallbackBlock.split(/^\s*-\s*/m).slice(1)) {
        addModel(readYamlScalar(entryBlock, 'provider'), readYamlScalar(entryBlock, 'model'))
      }
    }

    return models
  } catch {
    return []
  }
}

/** First non-empty, non-heading line of a profile's SOUL.md, as a short description. */
function readHermesProfileDescription(profileDir: string): string | undefined {
  try {
    const soulPath = join(profileDir, 'SOUL.md')
    const content = readFileSync(soulPath, 'utf8').slice(0, 4096)
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      return line.length > 120 ? `${line.slice(0, 117)}…` : line
    }
  } catch {
    // No SOUL.md or unreadable — description is optional.
  }
  return undefined
}

/** Model/provider recorded in a single profile's config.yaml, if present. */
function readHermesProfileModel(profileDir: string): { model?: string; provider?: string } {
  try {
    const content = readFileSync(join(profileDir, 'config.yaml'), 'utf8')
    const modelBlock = extractYamlBlock(content, 'model')
    if (!modelBlock) return {}
    return {
      model: readYamlScalar(modelBlock, 'default') ?? undefined,
      provider: readYamlScalar(modelBlock, 'provider') ?? undefined,
    }
  } catch {
    return {}
  }
}

/**
 * Enumerates Hermes profiles by scanning `<hermes-root>/profiles/*` (each subdir is a
 * fully isolated HERMES_HOME). The root is resolved via {@link resolveHermesRoot} so the
 * platform-native location (`%LOCALAPPDATA%\hermes` on Windows) and a relocated
 * `HERMES_HOME` are both honored — hardcoding `~/.hermes` silently found nothing on
 * Windows. A synthetic `default` entry is always present — it is the no-`--profile` case
 * and may not correspond to a profiles/ subdirectory.
 *
 * Nexy-launched Hermes sessions inherit the selected profile's real home (memory,
 * skills, SOUL.md) — profiles are consumed, never managed, from here. Dir-scan is used
 * instead of `hermes profile list` (which has no `--json`) to avoid a subprocess on the
 * config-UI path. Fully try/catch-guarded → `[default]`-safe, like readHermesConfigModels().
 */
export function listHermesProfiles(): HermesProfileInfo[] {
  const defaultEntry: HermesProfileInfo = { name: HERMES_DEFAULT_PROFILE, isDefault: true }
  try {
    const profilesDir = join(resolveHermesRoot(), 'profiles')
    if (!existsSync(profilesDir)) return [defaultEntry]

    const named: HermesProfileInfo[] = []
    for (const entry of readdirSync(profilesDir)) {
      if (entry === HERMES_DEFAULT_PROFILE) continue
      const profileDir = join(profilesDir, entry)
      try {
        if (!statSync(profileDir).isDirectory()) continue
      } catch {
        continue
      }
      const { model, provider } = readHermesProfileModel(profileDir)
      named.push({
        name: entry,
        isDefault: false,
        model,
        provider,
        description: readHermesProfileDescription(profileDir),
      })
    }
    named.sort((a, b) => a.name.localeCompare(b.name))
    return [defaultEntry, ...named]
  } catch {
    return [defaultEntry]
  }
}

let cachedHermesReadiness: HermesAcpReadiness | null = null
let cachedHermesReadinessAt = 0
let hermesReadinessProbe: Promise<HermesAcpReadiness> | null = null

// Readiness reflects mutable state (credentials can be added, or expire, mid-session), so the
// cache is only trusted briefly. `force` bypasses the cache for a manual recheck.
const HERMES_READINESS_TTL_MS = 30_000

/**
 * Probes whether the installed Hermes CLI can actually serve ACP — "binary present" is
 * not the same as "ACP-ready" (credentials may be missing). Runs `hermes acp --check`
 * (readiness) and `hermes acp --version` (version string) with strict short timeouts and
 * `shell:false`. Result is cached for {@link HERMES_READINESS_TTL_MS}; pass `force` to
 * re-probe immediately on manual recheck.
 */
type CliProbeResult = { status: number | null; stdout: string; stderr: string; error?: Error }

function runHermesProbe(executable: string, args: string[]): Promise<CliProbeResult> {
  return new Promise((resolve) => {
    execFile(executable, args, {
      encoding: 'utf8',
      timeout: 3000,
      shell: false,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      const code = error ? (error as NodeJS.ErrnoException).code : undefined
      const status = error && typeof code === 'number' ? code : error ? null : 0
      resolve({
        status,
        stdout: typeof stdout === 'string' ? stdout : '',
        stderr: typeof stderr === 'string' ? stderr : '',
        error: error ?? undefined,
      })
    })
  })
}

export async function hermesAcpReadiness(force = false): Promise<HermesAcpReadiness> {
  if (cachedHermesReadiness && !force && Date.now() - cachedHermesReadinessAt < HERMES_READINESS_TTL_MS) {
    return cachedHermesReadiness
  }
  if (hermesReadinessProbe && !force) return hermesReadinessProbe

  cachedHermesReadinessAt = Date.now()
  hermesReadinessProbe = (async () => {
    const executable = (await findCli('hermes')).path
    if (!executable) {
      cachedHermesReadiness = { ready: false, detail: 'Hermes CLI not found on PATH.' }
      return cachedHermesReadiness
    }

    const versionResult = await runHermesProbe(executable, ['acp', '--version'])
    const version = versionResult.status === 0
      ? versionResult.stdout.trim().split(/\r?\n/)[0] || undefined
      : undefined
    const check = await runHermesProbe(executable, ['acp', '--check'])
    if (check.status === 0) {
      cachedHermesReadiness = { ready: true, version }
    } else {
      const detail = check.stderr.trim() || check.stdout.trim() || check.error?.message ||
        `hermes acp --check exited with code ${check.status ?? 'unknown'}`
      cachedHermesReadiness = { ready: false, version, detail }
    }
    return cachedHermesReadiness
  })()

  try {
    return await hermesReadinessProbe
  } finally {
    hermesReadinessProbe = null
  }
}

export function detectCli(command: string): Promise<CliInstallStatus> {
  return findCli(command)
}

export async function detectAllClis(): Promise<Record<string, CliInstallStatus>> {
  const [copilot, claude, codex, hermes, gh, ollama] = await Promise.all([
    findCopilotCli(),
    findCli('claude'),
    findCli('codex'),
    findCli('hermes'),
    findCli('gh'),
    findCli('ollama'),
  ])
  return { copilot, claude, codex, hermes, gh, ollama }
}

export function getCliModels(backend: string, hermesProfile?: string): CliModelOption[] {
  if (backend === 'codex-cli') {
    const cachedModels = readCodexCachedModels()
    if (cachedModels.length > 0) {
      const preferredModel = readCodexConfigModel()
      return preferredModel && cachedModels.some((model) => model.id === preferredModel)
        ? withPreferredModelFirst(cachedModels, preferredModel)
        : cachedModels
    }
    return withPreferredModelFirst(CODEX_DEFAULT_MODELS, readCodexConfigModel())
  }
  if (backend === 'claude-cli') {
    const ptyProbed = getCachedClaudeCliPtyModels()
    if (ptyProbed.length > 0) return ptyProbed
    const anthropicApi = getCachedAnthropicModels()
    if (anthropicApi.length > 0) return anthropicApi
    return CLAUDE_DEFAULT_MODELS
  }
  if (backend === 'hermes-cli') {
    const configuredModels = readHermesConfigModels(hermesProfile)
    if (configuredModels.length === 0) return HERMES_DEFAULT_MODELS
    return [...configuredModels, ...HERMES_DEFAULT_MODELS.filter((m) => !configuredModels.some((c) => c.id === m.id))]
  }
  return []
}

let cachedStatus: CliInstallStatus | null = null

export function registerCliHandlers(): void {
  safeHandle('cli:check', async () => {
    cachedStatus = await findCopilotCli()
    return cachedStatus
  })

  safeHandle('cli:status', async () => {
    if (!cachedStatus) {
      cachedStatus = await findCopilotCli()
    }
    return cachedStatus
  })

  safeHandle('cli:detect-all', () => detectAllClis())

  safeHandle('cli:get-models', (_event, backend: string, hermesProfile?: string) =>
    getCliModels(backend, hermesProfile),
  )

  safeHandle('hermes:list-profiles', () => listHermesProfiles())

  safeHandle('hermes:acp-readiness', (_event, force?: boolean) => hermesAcpReadiness(force ?? false))
}

export async function checkCliOnStartup(): Promise<CliInstallStatus> {
  cachedStatus = await findCopilotCli()
  return cachedStatus
}
