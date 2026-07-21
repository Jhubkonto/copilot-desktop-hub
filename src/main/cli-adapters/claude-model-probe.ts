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
  // How long to wait for the "more models" submenu to render before re-requesting it once. A cold
  // PTY can settle the top-level menu and then stall opening the flyout, which would otherwise cost
  // the whole probe (and drop Opus). Kept well under probeTimeoutMs so a retry still has time.
  submenuTimeoutMs: 4000,
}

export function __setProbeTimingForTests(overrides: Partial<typeof TIMING> | null): void {
  if (!overrides) {
    TIMING.probeTimeoutMs = 15000
    TIMING.quietMs = 900
    TIMING.pollMs = 300
    TIMING.submenuTimeoutMs = 4000
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

const MORE_MODELS_PATTERN = /^\s*(?:❯\s*)?(\d+)\.\s+(?:more models|show more models|additional models)\b/i

/** Parses the "Select model" menu grid. Skips the "Default (recommended)" row since it mirrors
 *  an existing option, not a distinct one. Also detects a trailing "More models" row that opens
 *  a flyout submenu (e.g. Opus, when it isn't offered at the top level) and returns its row
 *  number so the caller can navigate into it and merge the extra entries. */
function parseModelMenu(grid: string): { models: CliModelOption[]; moreModelsRow: string | null } {
  const models: CliModelOption[] = []
  let moreModelsRow: string | null = null
  const rowPattern = /^\s*(?:❯\s*)?\d+\.\s+(\S.*?)\s{2,}(.+)$/
  for (const rawLine of grid.split('\n')) {
    const line = rawLine.replace(/✔/g, '').trimEnd()
    const moreMatch = MORE_MODELS_PATTERN.exec(line)
    if (moreMatch) {
      moreModelsRow = moreMatch[1]
      continue
    }
    const match = rowPattern.exec(line)
    if (!match) continue
    const alias = match[1].trim()
    if (/^Default\b/i.test(alias)) continue
    const rest = match[2].split('·')[0]?.trim()
    if (!rest) continue
    models.push({ id: alias.toLowerCase(), label: rest })
  }
  return { models, moreModelsRow }
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
      let stage: 'settle' | 'awaiting-menu' | 'awaiting-submenu' = 'settle'
      let topLevelModels: CliModelOption[] = []
      let moreModelsRowNum: string | null = null
      let submenuRequestedAt = 0
      let submenuRetried = false

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
            const { models, moreModelsRow } = parseModelMenu(grid)
            if (moreModelsRow) {
              topLevelModels = models
              moreModelsRowNum = moreModelsRow
              stage = 'awaiting-submenu'
              submenuRequestedAt = Date.now()
              ptyProcess?.write(`${moreModelsRow}\r`)
            } else {
              finish(models)
            }
          }
        } else if (stage === 'awaiting-submenu') {
          // The submenu resolves only once new data has arrived since we requested it AND the grid
          // shows more than the top-level rows — otherwise we'd re-parse the still-visible top-level
          // menu and finish without the flyout entries (e.g. Opus).
          if (lastDataAt > submenuRequestedAt && /Select model/i.test(grid)) {
            const { models: submenuModels } = parseModelMenu(grid)
            const merged = [...topLevelModels]
            for (const model of submenuModels) {
              if (!merged.some((m) => m.id === model.id)) merged.push(model)
            }
            const gainedEntries = merged.length > topLevelModels.length
            if (gainedEntries || submenuRetried) {
              finish(merged)
            } else if (Date.now() - submenuRequestedAt >= TIMING.submenuTimeoutMs) {
              // The flyout never produced new entries in time — re-request it once before giving up.
              submenuRetried = true
              submenuRequestedAt = Date.now()
              if (moreModelsRowNum) ptyProcess?.write(`${moreModelsRowNum}\r`)
            }
          } else if (Date.now() - submenuRequestedAt >= TIMING.submenuTimeoutMs) {
            // No usable submenu frame arrived at all (cold PTY stalled opening the flyout).
            if (submenuRetried) {
              // Second attempt also failed: fall back to the top-level models rather than nothing,
              // so the cache merge still preserves whatever we did see.
              finish(topLevelModels)
            } else {
              submenuRetried = true
              submenuRequestedAt = Date.now()
              if (moreModelsRowNum) ptyProcess?.write(`${moreModelsRowNum}\r`)
            }
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
    // Union with the existing cache rather than replacing it outright: a probe run that races the
    // "more models" submenu can settle on a subset of a previously-confirmed list (see the Opus
    // flicker bug), and silently regressing the cache would undo a known-good result.
    const previous = getCachedClaudeCliPtyModels()
    const merged = [...previous]
    for (const model of models) {
      if (!merged.some((m) => m.id === model.id)) merged.push(model)
    }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(CACHE_KEY, JSON.stringify(merged))
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
