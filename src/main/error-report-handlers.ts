import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import type {
  ErrorLogEntry,
  ErrorReportCaptureInput,
  ErrorReportCaptureResult,
  ErrorReportEntry,
} from '../shared/types'

interface ErrorLogRow {
  id: string
  source: ErrorLogEntry['source']
  level: ErrorLogEntry['level']
  message: string
  stack: string | null
  timestamp: number
}

function rowToErrorReport(row: Record<string, unknown>): ErrorReportEntry {
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description ?? ''),
    screenshot_path: typeof row.screenshot_path === 'string' ? row.screenshot_path : null,
    log_snapshot: typeof row.log_snapshot === 'string' ? row.log_snapshot : null,
    status: row.status as ErrorReportEntry['status'],
    app_version: typeof row.app_version === 'string' ? row.app_version : null,
    platform: typeof row.platform === 'string' ? row.platform : null,
    os_version: typeof row.os_version === 'string' ? row.os_version : null,
    investigation_markdown: typeof row.investigation_markdown === 'string' ? row.investigation_markdown : null,
    investigation_confidence: typeof row.investigation_confidence === 'string' ? row.investigation_confidence : null,
    investigation_root_cause: typeof row.investigation_root_cause === 'string' ? row.investigation_root_cause : null,
    investigation_affected_files: typeof row.investigation_affected_files === 'string' ? row.investigation_affected_files : '[]',
    investigation_started_at: typeof row.investigation_started_at === 'number' ? row.investigation_started_at : null,
    investigation_completed_at: typeof row.investigation_completed_at === 'number' ? row.investigation_completed_at : null,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  }
}

function normalizeTitle(title: unknown): string {
  const value = typeof title === 'string' ? title.trim() : ''
  return value || 'Bug report'
}

function normalizeDescription(description: unknown): string {
  return typeof description === 'string' ? description.trim() : ''
}

function readLogSnapshot(): string {
  const rows = getDatabase()
    .prepare('SELECT * FROM error_log ORDER BY timestamp DESC LIMIT 100')
    .all() as ErrorLogRow[]
  return JSON.stringify(rows.reverse(), null, 2)
}

function writeScreenshot(reportId: string, dataUrl?: string | null): string | null {
  if (!dataUrl) return null
  const match = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(dataUrl)
  if (!match) return null

  const extension = match[1].toLowerCase() === 'png' ? 'png' : 'jpg'
  const reportDir = path.join(app.getPath('userData'), 'error-reports', reportId)
  mkdirSync(reportDir, { recursive: true })
  const screenshotPath = path.join(reportDir, `screenshot.${extension}`)
  writeFileSync(screenshotPath, Buffer.from(match[2], 'base64'))
  return screenshotPath
}

export function createErrorReport(input: ErrorReportCaptureInput): ErrorReportCaptureResult {
  const id = randomUUID()
  const now = Date.now()
  const title = normalizeTitle(input.title)
  const description = normalizeDescription(input.description)
  const screenshotPath = input.includeScreenshot ? writeScreenshot(id, input.screenshotDataUrl) : null
  const logSnapshot = input.includeLog ? readLogSnapshot() : null

  getDatabase()
    .prepare(
      `INSERT INTO error_reports (
        id, title, description, screenshot_path, log_snapshot, status,
        app_version, platform, os_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      title,
      description,
      screenshotPath,
      logSnapshot,
      typeof app.getVersion === 'function' ? app.getVersion() : null,
      process.platform,
      os.release(),
      now,
      now,
    )

  return { reportId: id, screenshotPath, createdAt: now }
}

export function registerErrorReportHandlers(): void {
  safeHandle('error-report:capture', (_event, input: ErrorReportCaptureInput) => createErrorReport(input))

  safeHandle('error-report:list', (_event, limit?: number) => {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200))
    const rows = getDatabase()
      .prepare('SELECT * FROM error_reports ORDER BY created_at DESC LIMIT ?')
      .all(safeLimit) as Record<string, unknown>[]
    return rows.map(rowToErrorReport)
  })

  safeHandle('error-report:get', (_event, id: string) => {
    if (!id) return null
    const row = getDatabase()
      .prepare('SELECT * FROM error_reports WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined
    return row ? rowToErrorReport(row) : null
  })
}
