import { randomUUID } from 'crypto'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import { inferProjectIdForWorkspace } from './project-audit'
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

export function rowToErrorReport(row: Record<string, unknown>): ErrorReportEntry {
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
    investigation_revision_notes: typeof row.investigation_revision_notes === 'string' ? row.investigation_revision_notes : null,
    investigation_started_at: typeof row.investigation_started_at === 'number' ? row.investigation_started_at : null,
    investigation_completed_at: typeof row.investigation_completed_at === 'number' ? row.investigation_completed_at : null,
    fix_status: (typeof row.fix_status === 'string' ? row.fix_status : 'none') as ErrorReportEntry['fix_status'],
    fix_staged_files: typeof row.fix_staged_files === 'string' ? row.fix_staged_files : '[]',
    fix_started_at: typeof row.fix_started_at === 'number' ? row.fix_started_at : null,
    fix_completed_at: typeof row.fix_completed_at === 'number' ? row.fix_completed_at : null,
    fix_error: typeof row.fix_error === 'string' ? row.fix_error : null,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    request_type: typeof row.request_type === 'string'
      ? row.request_type as ErrorReportEntry['request_type']
      : null,
    request_origin: typeof row.request_origin === 'string'
      ? row.request_origin as ErrorReportEntry['request_origin']
      : null,
    workspace_root: typeof row.workspace_root === 'string' ? row.workspace_root : null,
    project_id: typeof row.project_id === 'string' ? row.project_id : null,
    custom_type_label: typeof row.custom_type_label === 'string' ? row.custom_type_label : null,
    conversation_id: typeof row.conversation_id === 'string' ? row.conversation_id : null,
  }
}

function normalizeTitle(title: unknown): string {
  const value = typeof title === 'string' ? title.trim() : ''
  return value || 'Edit request'
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

function removeUserDataChild(...segments: string[]): void {
  const userData = path.resolve(app.getPath('userData'))
  const target = path.resolve(userData, ...segments)
  const relative = path.relative(userData, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return
  rmSync(target, { recursive: true, force: true })
}

const CODE_CHANGE_REF_PREFIX = '__code-change-ref:'

function parseCodeChangeRefContent(content: string): { reportId?: string } | null {
  if (!content.startsWith(CODE_CHANGE_REF_PREFIX)) return null
  try {
    return JSON.parse(content.slice(CODE_CHANGE_REF_PREFIX.length)) as { reportId?: string }
  } catch {
    return null
  }
}

function deleteCodeChangeRefMessages(reportId: string): void {
  const db = getDatabase()
  const rows = db.prepare(
    `SELECT id, content FROM messages
     WHERE role = 'system' AND content GLOB ?`,
  ).all(`${CODE_CHANGE_REF_PREFIX}*`) as Array<{ id: string; content: string }>
  const ids = rows
    .filter((row) => parseCodeChangeRefContent(row.content)?.reportId === reportId)
    .map((row) => row.id)
  if (ids.length === 0) return
  const deleteMessage = db.prepare('DELETE FROM messages WHERE id = ?')
  for (const id of ids) deleteMessage.run(id)
}

export function createErrorReport(input: ErrorReportCaptureInput): ErrorReportCaptureResult {
  const id = randomUUID()
  const now = Date.now()
  const title = normalizeTitle(input.title)
  const description = normalizeDescription(input.description)
  const screenshotPath = input.includeScreenshot ? writeScreenshot(id, input.screenshotDataUrl) : null
  const logSnapshot = input.includeLog ? readLogSnapshot() : null
  const requestType = ['edit', 'refactor', 'bugfix', 'feature', 'investigation', 'custom'].includes(input.requestType ?? '')
    ? input.requestType!
    : null
  const requestOrigin = ['chat', 'android', 'manual', 'build-failure', 'legacy-bug-report'].includes(input.origin ?? '')
    ? input.origin!
    : null
  const customTypeLabel = requestType === 'custom' ? (input.customTypeLabel?.trim() || null) : null
  const workspaceRoot = input.workspaceRoot?.trim() || null
  const resolvedProjectId = input.projectId?.trim()
    || (workspaceRoot ? inferProjectIdForWorkspace(workspaceRoot) : null)
  const conversationId = input.conversationId?.trim() || null

  getDatabase()
    .prepare(
      `INSERT INTO error_reports (
        id, title, description, screenshot_path, log_snapshot, status,
        app_version, platform, os_version, request_type, request_origin,
        workspace_root, project_id, custom_type_label, conversation_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      requestType,
      requestOrigin,
      workspaceRoot,
      resolvedProjectId || null,
      customTypeLabel,
      conversationId,
      now,
      now,
    )

  return { reportId: id, screenshotPath, createdAt: now }
}

const NON_TERMINAL_STATUSES = ['open', 'investigating', 'investigated']

/** Finds a still-in-progress code change request already linked to this conversation, if any,
 * so /code-change can reuse it instead of creating a duplicate on repeated invocation. */
export function findActiveCodeChangeForConversation(conversationId: string): ErrorReportEntry | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM error_reports WHERE conversation_id = ? AND status IN (${NON_TERMINAL_STATUSES.map(() => '?').join(',')})
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(conversationId, ...NON_TERMINAL_STATUSES) as Record<string, unknown> | undefined
  return row ? rowToErrorReport(row) : null
}

export function deleteErrorReport(reportId: string): boolean {
  if (!reportId) return false

  const db = getDatabase()
  const row = db
    .prepare('SELECT id FROM error_reports WHERE id = ?')
    .get(reportId) as { id: string } | undefined
  if (!row) return false

  db.transaction(() => {
    db.prepare('DELETE FROM remote_edit_diffs WHERE report_id = ?').run(reportId)
    db.prepare('DELETE FROM remote_edit_verification_runs WHERE report_id = ?').run(reportId)
    db.prepare('DELETE FROM remote_edit_recovery_runs WHERE report_id = ?').run(reportId)
    db.prepare('DELETE FROM remote_edit_history WHERE report_id = ?').run(reportId)
    deleteCodeChangeRefMessages(reportId)
    db.prepare('DELETE FROM error_reports WHERE id = ?').run(reportId)
  })()

  removeUserDataChild('error-reports', reportId)
  removeUserDataChild('remote-edit', 'staging', reportId)
  removeUserDataChild('remote-edit', 'backups', reportId)

  return true
}

export function registerErrorReportHandlers(): void {
  safeHandle('error-report:capture', (_event, input: ErrorReportCaptureInput) => createErrorReport(input))

  safeHandle('error-report:list', (_event, limit?: number, projectId?: string) => {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200))
    const rows = projectId
      ? getDatabase()
        .prepare('SELECT * FROM error_reports WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(projectId, safeLimit) as Record<string, unknown>[]
      : getDatabase()
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

  safeHandle('error-report:delete', (_event, id: string) => deleteErrorReport(id))

  safeHandle('error-report:find-active-for-conversation', (_event, conversationId: string) => {
    if (!conversationId) return null
    return findActiveCodeChangeForConversation(conversationId)
  })
}
