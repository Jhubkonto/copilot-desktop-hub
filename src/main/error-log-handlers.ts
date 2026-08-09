import { randomUUID } from 'crypto'
import { writeFileSync } from 'fs'
import { app, type BrowserWindow, type RenderProcessGoneDetails } from 'electron'
import log from 'electron-log/main'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import type { ErrorLogEntry, ErrorLogLevel, ErrorLogSource, RendererErrorInput } from '../shared/types'

const rendererConsoleBuffer: ErrorLogEntry[] = []
const MAX_RENDERER_BUFFER = 200
let mainWindow: BrowserWindow | null = null
let childProcessCaptureInstalled = false
const rendererRecoveryAttempts: number[] = []

// Persistent diagnostics are kept for one week, then swept. Long enough to investigate an
// intermittent failure a user reports "the other day", short enough that the log never grows
// unbounded. The sweep runs on startup and periodically thereafter.
const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const LOG_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000
let logRetentionTimer: NodeJS.Timeout | null = null

/** Deletes error-log rows older than the retention window. Best-effort — never throws. */
export function pruneErrorLog(now: number = Date.now()): number {
  try {
    const result = getDatabase()
      .prepare('DELETE FROM error_log WHERE timestamp < ?')
      .run(now - LOG_RETENTION_MS)
    return Number(result.changes ?? 0)
  } catch {
    return 0
  }
}

function normalizeLevel(level: unknown): ErrorLogLevel {
  if (level === 'error' || level === 3) return 'error'
  if (level === 'warn' || level === 'warning' || level === 2) return 'warn'
  if (level === 'debug') return 'debug'
  return 'info'
}

function rowToEntry(row: Record<string, unknown>): ErrorLogEntry {
  return {
    id: String(row.id),
    source: row.source as ErrorLogSource,
    level: row.level as ErrorLogLevel,
    message: String(row.message),
    stack: typeof row.stack === 'string' ? row.stack : null,
    timestamp: Number(row.timestamp),
  }
}

function getLogFilePath(): string | null {
  try {
    return log.transports.file.getFile().path
  } catch {
    return null
  }
}

export function recordErrorLogEntry(input: {
  source: ErrorLogSource
  level: ErrorLogLevel
  message: string
  stack?: string | null
  timestamp?: number
}): ErrorLogEntry {
  const entry: ErrorLogEntry = {
    id: randomUUID(),
    source: input.source,
    level: input.level,
    message: input.message,
    stack: input.stack ?? null,
    timestamp: input.timestamp ?? Date.now(),
  }

  try {
    const db = getDatabase()
    db.prepare(
      `INSERT INTO error_log (id, source, level, message, stack, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(entry.id, entry.source, entry.level, entry.message, entry.stack, entry.timestamp)
  } catch {
    // Error capture must never become the source of an app crash.
  }

  if (entry.source === 'renderer') {
    rendererConsoleBuffer.push(entry)
    if (rendererConsoleBuffer.length > MAX_RENDERER_BUFFER) {
      rendererConsoleBuffer.splice(0, rendererConsoleBuffer.length - MAX_RENDERER_BUFFER)
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('errors:new', entry)
  }

  return entry
}

export function initErrorLogCapture(win: BrowserWindow): void {
  mainWindow = win

  // Sweep expired entries immediately, then on a slow interval for long-running sessions.
  pruneErrorLog()
  if (!logRetentionTimer) {
    logRetentionTimer = setInterval(() => pruneErrorLog(), LOG_PRUNE_INTERVAL_MS)
    if (typeof logRetentionTimer.unref === 'function') logRetentionTimer.unref()
  }
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const levelName = normalizeLevel(level)
    if (levelName !== 'error' && levelName !== 'warn') return
    const location = sourceId ? `${String(sourceId)}:${String(line ?? '')}` : null
    recordErrorLogEntry({
      source: 'renderer',
      level: levelName,
      message: String(message ?? ''),
      stack: location,
    })
  })

  win.webContents.on('render-process-gone', (_event, details: RenderProcessGoneDetails) => {
    recordErrorLogEntry({
      source: 'main',
      level: 'error',
      message: `Renderer process exited: ${details.reason} (code ${details.exitCode}).`,
      stack: JSON.stringify(details),
    })
    if (!win.isDestroyed() && details.reason !== 'clean-exit') {
      // A gone renderer cannot display recovery UI. Reloading restores the workspace;
      // persisted conversation state is rehydrated by the normal startup path.
      const cutoff = Date.now() - 60_000
      while (rendererRecoveryAttempts[0] && rendererRecoveryAttempts[0] < cutoff) {
        rendererRecoveryAttempts.shift()
      }
      if (rendererRecoveryAttempts.length < 2) {
        rendererRecoveryAttempts.push(Date.now())
        setTimeout(() => {
          if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.reload()
        }, 250)
      } else {
        recordErrorLogEntry({
          source: 'main',
          level: 'error',
          message: 'Automatic renderer recovery stopped after two failures in one minute.',
        })
      }
    }
  })
  if (typeof win.on === 'function') {
    win.on('unresponsive', () => {
      recordErrorLogEntry({
        source: 'main',
        level: 'warn',
        message: 'The main Nexy window became unresponsive.',
      })
    })
  }

  if (!childProcessCaptureInstalled && app && typeof app.on === 'function') {
    childProcessCaptureInstalled = true
    app.on('child-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return
      recordErrorLogEntry({
        source: 'main',
        level: 'error',
        message: `Electron ${details.type} process exited: ${details.reason} (code ${details.exitCode}).`,
        stack: JSON.stringify(details),
      })
    })
  }
}

export function registerErrorLogHandlers(): void {
  safeHandle('errors:get-log-path', () => getLogFilePath())

  safeHandle('errors:get-recent', (_event, limit?: number) => {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500))
    const rows = getDatabase()
      .prepare('SELECT * FROM error_log ORDER BY timestamp DESC LIMIT ?')
      .all(safeLimit) as Record<string, unknown>[]
    return rows.map(rowToEntry).reverse()
  })

  safeHandle('errors:get-renderer-console', () => [...rendererConsoleBuffer])

  safeHandle('errors:record-renderer', (_event, input: RendererErrorInput) => {
    const message = typeof input?.message === 'string' ? input.message.trim() : ''
    return recordErrorLogEntry({
      source: 'renderer',
      level: input?.level === 'warn' ? 'warn' : 'error',
      message: message || 'Unknown renderer error',
      stack: typeof input?.stack === 'string' ? input.stack : null,
    })
  })

  safeHandle('errors:clear', () => {
    getDatabase().prepare('DELETE FROM error_log').run()
    rendererConsoleBuffer.length = 0
    const path = getLogFilePath()
    if (path) {
      try {
        writeFileSync(path, '', 'utf8')
      } catch {
        // DB clear still succeeded; log-file truncation is best effort.
      }
    }
    return true
  })
}
