import { randomUUID } from 'crypto'
import { getDatabase } from '../database'
import type { RemoteEditHistoryEntry } from '../../shared/types'

interface HistoryRow {
  id: string
  report_id: string
  report_title: string
  investigation_model: string | null
  investigation_backend: string | null
  investigation_rounds: number
  fix_applied_at: number | null
  verification_passed: number
  verification_failed_step: string | null
  committed: number
  commit_sha: string | null
  pushed: number
  reloaded: number
  rolled_back: number
  status: string
  created_at: number
  updated_at: number
}

function rowToEntry(row: HistoryRow): RemoteEditHistoryEntry {
  return {
    id: row.id,
    reportId: row.report_id,
    reportTitle: row.report_title,
    investigationModel: row.investigation_model,
    investigationBackend: row.investigation_backend,
    investigationRounds: row.investigation_rounds,
    fixAppliedAt: row.fix_applied_at,
    verificationPassed: row.verification_passed === 1,
    verificationFailedStep: row.verification_failed_step,
    committed: row.committed === 1,
    commitSha: row.commit_sha,
    pushed: row.pushed === 1,
    reloaded: row.reloaded === 1,
    rolledBack: row.rolled_back === 1,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getOrCreateHistoryEntry(reportId: string): RemoteEditHistoryEntry {
  const db = getDatabase()
  const existing = db
    .prepare('SELECT * FROM remote_edit_history WHERE report_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(reportId) as HistoryRow | undefined
  if (existing) return rowToEntry(existing)

  const reportRow = db.prepare('SELECT title FROM error_reports WHERE id = ?').get(reportId) as
    | { title: string }
    | undefined
  const now = Date.now()
  const id = randomUUID()
  db.prepare(
    `INSERT INTO remote_edit_history
     (id, report_id, report_title, status, created_at, updated_at)
     VALUES (?, ?, ?, 'investigating', ?, ?)`,
  ).run(id, reportId, reportRow?.title ?? '', now, now)

  return rowToEntry(
    db.prepare('SELECT * FROM remote_edit_history WHERE id = ?').get(id) as HistoryRow,
  )
}

export function updateHistoryEntry(
  reportId: string,
  fields: Partial<Omit<RemoteEditHistoryEntry, 'id' | 'reportId' | 'createdAt'>>,
): void {
  const db = getDatabase()
  const existing = db
    .prepare('SELECT id FROM remote_edit_history WHERE report_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(reportId) as { id: string } | undefined
  if (!existing) {
    getOrCreateHistoryEntry(reportId)
    updateHistoryEntry(reportId, fields)
    return
  }

  const setClauses: string[] = ['updated_at = ?']
  const values: unknown[] = [Date.now()]

  if (fields.reportTitle !== undefined) { setClauses.push('report_title = ?'); values.push(fields.reportTitle) }
  if (fields.investigationModel !== undefined) { setClauses.push('investigation_model = ?'); values.push(fields.investigationModel) }
  if (fields.investigationBackend !== undefined) { setClauses.push('investigation_backend = ?'); values.push(fields.investigationBackend) }
  if (fields.investigationRounds !== undefined) { setClauses.push('investigation_rounds = ?'); values.push(fields.investigationRounds) }
  if (fields.fixAppliedAt !== undefined) { setClauses.push('fix_applied_at = ?'); values.push(fields.fixAppliedAt) }
  if (fields.verificationPassed !== undefined) { setClauses.push('verification_passed = ?'); values.push(fields.verificationPassed ? 1 : 0) }
  if (fields.verificationFailedStep !== undefined) { setClauses.push('verification_failed_step = ?'); values.push(fields.verificationFailedStep) }
  if (fields.committed !== undefined) { setClauses.push('committed = ?'); values.push(fields.committed ? 1 : 0) }
  if (fields.commitSha !== undefined) { setClauses.push('commit_sha = ?'); values.push(fields.commitSha) }
  if (fields.pushed !== undefined) { setClauses.push('pushed = ?'); values.push(fields.pushed ? 1 : 0) }
  if (fields.reloaded !== undefined) { setClauses.push('reloaded = ?'); values.push(fields.reloaded ? 1 : 0) }
  if (fields.rolledBack !== undefined) { setClauses.push('rolled_back = ?'); values.push(fields.rolledBack ? 1 : 0) }
  if (fields.status !== undefined) { setClauses.push('status = ?'); values.push(fields.status) }

  values.push(existing.id)
  db.prepare(`UPDATE remote_edit_history SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
}

export function listHistory(limit = 50): RemoteEditHistoryEntry[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM remote_edit_history ORDER BY created_at DESC LIMIT ?')
    .all(limit) as HistoryRow[]
  return rows.map(rowToEntry)
}
