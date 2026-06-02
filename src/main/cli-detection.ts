import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type { CliInstallStatus } from '../shared/types'
import { safeHandle } from './safe-handle'

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
    gh: findCli('gh'),
    ollama: findCli('ollama')
  }
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
}

export function checkCliOnStartup(): CliInstallStatus {
  cachedStatus = findCopilotCli()
  return cachedStatus
}
