import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { CliInstallStatus } from '../shared/types'
import { safeHandle } from './safe-handle'
import { CODEX_DEFAULT_MODELS } from './cli-adapters/codex'

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

export function detectAllClis(): Record<string, CliInstallStatus> {
  return {
    copilot: findCopilotCli(),
    claude: findCli('claude'),
    codex: findCli('codex'),
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
    return CLAUDE_DEFAULT_MODELS
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
}

export function checkCliOnStartup(): CliInstallStatus {
  cachedStatus = findCopilotCli()
  return cachedStatus
}
