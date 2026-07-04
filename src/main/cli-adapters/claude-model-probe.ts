import { createRequire } from 'module'
import type { IPty, spawn as ptySpawnType } from 'node-pty'
import type { Terminal as TerminalType } from '@xterm/headless'
import { app } from 'electron'
import { resolveCliPath } from './utils'
import { getDatabase } from '../database'

// Loaded via createRequire rather than a native ESM import: Electron's embedded Node ESM loader
// has been observed to crash (cjsPreparseModuleExports on an undefined module) when statically
// importing these CJS packages directly, even though plain Node handles both imports fine.
const require = createRequire(import.meta.url)
const ptySpawn = (require('node-pty').spawn) as typeof ptySpawnType
const Terminal = (require('@xterm/headless').Terminal) as typeof TerminalType

const CACHE_KEY = 'claude_cli_pty_models_cache'
const COLS = 120
const ROWS = 40

/** Overridable only from tests, to avoid multi-second real-timer waits in the suite. */
const TIMING = {
  probeTimeoutMs: 15000,
  quietMs: 900,
  pollMs: 300,
}

export function __setProbeTimingForTests(overrides: Partial<typeof TIMING> | null): void {
  if (!overrides) {
    TIMING.probeTimeoutMs = 15000
    TIMING.quietMs = 900
    TIMING.pollMs = 300
    return
  }
  Object.assign(TIMING, overrides)
}

export type CliModelOption = { id: string; label: string }

function snapshotGrid(term: TerminalType): string {
  const lines: string[] = []
  for (let i = 0; i < term.rows; i++) {
    const line = term.buffer.active.getLine(i)
    lines.push(line ? line.translateToString(true) : '')
  }
  return lines.join('\n')
}

/** Parses the "Select model" menu grid (top-level only, per product decision — the
 *  "More models" flyout needs extra keystroke navigation and is deliberately not captured).
 *  Skips the "Default (recommended)" row since it mirrors an existing option, not a distinct one. */
function parseModelMenu(grid: string): CliModelOption[] {
  const models: CliModelOption[] = []
  const rowPattern = /^\s*(?:❯\s*)?\d+\.\s+(\S.*?)\s{2,}(.+)$/
  for (const rawLine of grid.split('\n')) {
    const line = rawLine.replace(/✔/g, '').trimEnd()
    const match = rowPattern.exec(line)
    if (!match) continue
    const alias = match[1].trim()
    if (/^Default\b/i.test(alias)) continue
    const rest = match[2].split('·')[0]?.trim()
    if (!rest) continue
    models.push({ id: alias.toLowerCase(), label: rest })
  }
  return models
}

let inFlightProbe: Promise<CliModelOption[]> | null = null

export function probeClaudeCliModels(): Promise<CliModelOption[]> {
  if (inFlightProbe) return inFlightProbe
  inFlightProbe = runProbe().finally(() => {
    inFlightProbe = null
  })
  return inFlightProbe
}

async function runProbe(): Promise<CliModelOption[]> {
  const claudePath = resolveCliPath('claude')
  if (!claudePath) return []

  return new Promise<CliModelOption[]>((resolve) => {
    let settled = false
    let ptyProcess: IPty | null = null
    let checker: ReturnType<typeof setInterval> | null = null
    let hardTimeout: ReturnType<typeof setTimeout> | null = null

    const finish = (result: CliModelOption[]) => {
      if (settled) return
      settled = true
      if (checker) clearInterval(checker)
      if (hardTimeout) clearTimeout(hardTimeout)
      try { ptyProcess?.write('\x1b') } catch { /* ignore */ }
      try { ptyProcess?.kill() } catch { /* ignore */ }
      resolve(result)
    }

    try {
      const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true })
      ptyProcess = ptySpawn(claudePath, ['--strict-mcp-config'], {
        name: 'xterm-color',
        cols: COLS,
        rows: ROWS,
        cwd: app.getPath('temp'),
        env: process.env as Record<string, string>,
      })

      let lastDataAt = Date.now()
      let stage: 'settle' | 'awaiting-menu' = 'settle'

      ptyProcess.onData((chunk) => {
        lastDataAt = Date.now()
        term.write(chunk)
      })

      ptyProcess.onExit(() => finish([]))

      checker = setInterval(() => {
        if (Date.now() - lastDataAt < TIMING.quietMs) return
        const grid = snapshotGrid(term)

        if (stage === 'settle') {
          if (/trust this folder/i.test(grid)) {
            ptyProcess?.write('\r')
          } else if (/New MCP server found/i.test(grid)) {
            ptyProcess?.write('\x1b')
          } else if (/^❯/m.test(grid) || grid.includes('for shortcuts')) {
            stage = 'awaiting-menu'
            ptyProcess?.write('/model\r')
          }
        } else if (stage === 'awaiting-menu') {
          if (/Select model/i.test(grid)) {
            finish(parseModelMenu(grid))
          }
        }
      }, TIMING.pollMs)

      hardTimeout = setTimeout(() => finish([]), TIMING.probeTimeoutMs)
    } catch {
      finish([])
    }
  })
}

export function cacheClaudeCliPtyModels(models: CliModelOption[]): void {
  if (models.length === 0) return
  try {
    const db = getDatabase()
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(CACHE_KEY, JSON.stringify(models))
  } catch { /* fail silently — stale cache is acceptable */ }
}

export function getCachedClaudeCliPtyModels(): CliModelOption[] {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(CACHE_KEY) as { value: string } | undefined
    if (!row) return []
    return JSON.parse(row.value) as CliModelOption[]
  } catch { return [] }
}
