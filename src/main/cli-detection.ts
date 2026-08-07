import { execSync, spawnSync } from 'child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { CliInstallStatus, HermesProfileInfo, HermesAcpReadiness } from '../shared/types'
import { HERMES_DEFAULT_PROFILE } from '../shared/hermes'
import { safeHandle } from './safe-handle'
import { CODEX_DEFAULT_MODELS } from './cli-adapters/codex'
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

function findCopilotCli(): CliInstallStatus {
  // Try common CLI names
  const cliNames = ['github-copilot-cli', 'copilot']
  const isWindows = process.platform === 'win32'

  for (const name of cliNames) {
    try {
      const whichCmd = isWindows ? `where ${name}` : `which ${name}`
      const cliPath = execSync(whichCmd, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim().split('\n')[0]

      if (cliPath && existsSync(cliPath)) {
        let version: string | null = null
        try {
          version = execSync(`${name} --version`, {
            encoding: 'utf-8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe']
          }).trim()
        } catch {
          // Version command may not be supported
        }
        return { installed: true, path: cliPath, version }
      }
    } catch {
      // Not found, try next name
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

function findCli(command: string): CliInstallStatus {
  const whichCmd = process.platform === 'win32' ? `where ${command}` : `which ${command}`

  try {
    const cliPath = execSync(whichCmd, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim().split(/\r?\n/)[0]

    if (!cliPath || !existsSync(cliPath)) {
      return { installed: false, path: null, version: null }
    }

    let version: string | null = null
    try {
      version = execSync(`${command} --version`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim().split(/\r?\n/)[0] || null
    } catch {
      // Version command may not be supported
    }

    return { installed: true, path: cliPath, version }
  } catch {
    return { installed: false, path: null, version: null }
  }
}

const HERMES_DEFAULT_MODELS: CliModelOption[] = [
  { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Anthropic)' },
  { id: 'anthropic/claude-opus-4-8', label: 'Claude Opus 4.8 (Anthropic)' },
  { id: 'openrouter/auto', label: 'Auto (OpenRouter)' },
]

/**
 * Extracts a top-level YAML block's raw text (from `key:` up to the next line starting at
 * column 0) without a full YAML parser — Hermes's config.yaml nests `default`/`provider` under
 * `model:`, `auxiliary:`, etc. and a flat regex over the whole file would grab the wrong section.
 */
function extractYamlBlock(content: string, key: string): string | null {
  const match = new RegExp(`^${key}:\\n((?:[ \\t]+.*\\n?)*)`, 'm').exec(content)
  return match?.[1] ?? null
}

function readYamlScalar(block: string, key: string): string | null {
  const match = new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n#]+?)["']?\\s*(?:#.*)?$`, 'm').exec(block)
  return match?.[1]?.trim() || null
}

/**
 * Hermes has no model-listing command (unlike Claude's PTY probe or Codex's models_cache.json) —
 * `~/.hermes/config.yaml`'s `model.default`/`model.provider` and `fallback_providers` chain are
 * the only on-disk signal of what the user actually has configured, so this is the closest
 * equivalent to `readCodexConfigModel()`/`readCodexCachedModels()`.
 */
function readHermesConfigModels(): CliModelOption[] {
  try {
    const yamlPath = join(homedir(), '.hermes', 'config.yaml')
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
 * Enumerates Hermes profiles by scanning `~/.hermes/profiles/*` (each subdir is a
 * fully isolated HERMES_HOME). A synthetic `default` entry is always present — it is
 * the no-`--profile` case and may not correspond to a profiles/ subdirectory.
 *
 * Nexy-launched Hermes sessions inherit the selected profile's real home (memory,
 * skills, SOUL.md) — profiles are consumed, never managed, from here. Dir-scan is used
 * instead of `hermes profile list` (which has no `--json`) to avoid a subprocess on the
 * config-UI path. Fully try/catch-guarded → `[default]`-safe, like readHermesConfigModels().
 */
export function listHermesProfiles(): HermesProfileInfo[] {
  const defaultEntry: HermesProfileInfo = { name: HERMES_DEFAULT_PROFILE, isDefault: true }
  try {
    const profilesDir = join(homedir(), '.hermes', 'profiles')
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

/**
 * Probes whether the installed Hermes CLI can actually serve ACP — "binary present" is
 * not the same as "ACP-ready" (credentials may be missing). Runs `hermes acp --check`
 * (readiness) and `hermes acp --version` (version string) with strict short timeouts and
 * `shell:false`. Result is cached; pass `force` to re-probe on manual recheck.
 */
export function hermesAcpReadiness(force = false): HermesAcpReadiness {
  if (cachedHermesReadiness && !force) return cachedHermesReadiness

  const executable = findCli('hermes').path
  if (!executable) {
    cachedHermesReadiness = { ready: false, detail: 'Hermes CLI not found on PATH.' }
    return cachedHermesReadiness
  }

  const run = (args: string[]) =>
    spawnSync(executable, args, { encoding: 'utf8', timeout: 3000, shell: false })

  let version: string | undefined
  try {
    const versionResult = run(['acp', '--version'])
    if (versionResult.status === 0 && typeof versionResult.stdout === 'string') {
      version = versionResult.stdout.trim().split(/\r?\n/)[0] || undefined
    }
  } catch {
    // Version is best-effort; readiness is decided by --check below.
  }

  try {
    const check = run(['acp', '--check'])
    if (check.error) {
      cachedHermesReadiness = { ready: false, version, detail: check.error.message }
    } else if (check.status === 0) {
      cachedHermesReadiness = { ready: true, version }
    } else {
      const detail =
        (typeof check.stderr === 'string' && check.stderr.trim()) ||
        (typeof check.stdout === 'string' && check.stdout.trim()) ||
        `hermes acp --check exited with code ${check.status ?? 'unknown'}`
      cachedHermesReadiness = { ready: false, version, detail }
    }
  } catch (err) {
    cachedHermesReadiness = {
      ready: false,
      version,
      detail: err instanceof Error ? err.message : String(err),
    }
  }

  return cachedHermesReadiness
}

export function detectAllClis(): Record<string, CliInstallStatus> {
  return {
    copilot: findCopilotCli(),
    claude: findCli('claude'),
    codex: findCli('codex'),
    hermes: findCli('hermes'),
    gh: findCli('gh'),
    ollama: findCli('ollama')
  }
}

export function getCliModels(backend: string): CliModelOption[] {
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
    const configuredModels = readHermesConfigModels()
    if (configuredModels.length === 0) return HERMES_DEFAULT_MODELS
    return [...configuredModels, ...HERMES_DEFAULT_MODELS.filter((m) => !configuredModels.some((c) => c.id === m.id))]
  }
  return []
}

let cachedStatus: CliInstallStatus | null = null

export function registerCliHandlers(): void {
  safeHandle('cli:check', () => {
    cachedStatus = findCopilotCli()
    return cachedStatus
  })

  safeHandle('cli:status', () => {
    if (!cachedStatus) {
      cachedStatus = findCopilotCli()
    }
    return cachedStatus
  })

  safeHandle('cli:detect-all', () => detectAllClis())

  safeHandle('cli:get-models', (_event, backend: string) => getCliModels(backend))

  safeHandle('hermes:list-profiles', () => listHermesProfiles())

  safeHandle('hermes:acp-readiness', (_event, force?: boolean) => hermesAcpReadiness(force ?? false))
}

export function checkCliOnStartup(): CliInstallStatus {
  cachedStatus = findCopilotCli()
  return cachedStatus
}
