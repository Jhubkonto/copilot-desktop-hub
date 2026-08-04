import { copyFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import path from 'path'
import { Notification } from 'electron'
import type { BrowserWindow } from 'electron'
import { safeHandle } from './safe-handle'
import {
  emitInvestigationEvent,
  loadInvestigationSettings,
  runInvestigation,
  saveInvestigationSettings,
  getWorkspacePathForReport,
  resolveInsideWorkspace,
  recoverStuckInvestigations,
} from './remote-edit/investigator'
import {
  getBackupDir,
  recoverStuckFixRuns,
} from './remote-edit/fix-agent'
import {
  getVerificationRuns,
  recoverStuckVerificationRuns,
} from './remote-edit/verifier'
import { getHistoryEntryForReport, getOrCreateHistoryEntry, listHistory, updateHistoryEntry } from './remote-edit/history'
import { sendRemoteEditNotification } from './fcm-sender'
import { getDatabase } from './database'
import { getRemoteEditAuditDiff, inferProjectAuditTarget, recordProjectAuditChange } from './project-audit'
import { broadcastToMobile } from './ws-server'
import type {
  ErrorReportEntry,
  ErrorReportStatus,
  RemoteEditInvestigationActivity,
  RemoteEditInvestigationSettings,
  RemoteEditStagedFileDiff,
  RemoteEditStagedFileEntry,
} from '../shared/types'

function sendDesktopNotification(title: string, body: string): void {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body, silent: true }).show()
    }
  } catch { /* notifications not critical */ }
}

const activeInvestigations = new Set<string>()
const activeFixRuns = new Set<string>()
const activeVerificationRuns = new Set<string>()

// Live progress for in-flight investigations, keyed by reportId. Lets a renderer that mounts (or
// remounts, e.g. after navigating away and back) mid-run recover the running state and activity
// log via remote-edit:get-active-investigation instead of only relying on stream events it may
// have missed. Cleared once the run finishes (see the .finally() below).
const investigationProgress = new Map<string, { activity: RemoteEditInvestigationActivity[]; output: string }>()

/**
 * Tallies active investigation/fix/verification runs per project so the Projects list can show a
 * running indicator even when Project Settings (where the actual activity/plan UI lives) is
 * closed — previously there was no visibility into background Code Changes work outside that
 * one screen.
 */
export function computeActiveCodeChangesByProject(): Record<string, number> {
  const reportIds = new Set<string>([...activeInvestigations, ...activeFixRuns, ...activeVerificationRuns])
  if (reportIds.size === 0) return {}
  const placeholders = [...reportIds].map(() => '?').join(', ')
  const rows = getDatabase()
    .prepare(`SELECT id, project_id FROM error_reports WHERE id IN (${placeholders})`)
    .all(...reportIds) as { id: string; project_id: string | null }[]
  const counts: Record<string, number> = {}
  for (const row of rows) {
    if (!row.project_id) continue
    counts[row.project_id] = (counts[row.project_id] ?? 0) + 1
  }
  return counts
}

function broadcastActiveCodeChangesChanged(mainWindow?: BrowserWindow): void {
  const counts = computeActiveCodeChangesByProject()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('remote-edit:active-code-changes-changed', counts)
  }
  // Mirrors the self-heal:* naming Android's WsEventParser already recognizes for Code Changes
  // events (see the matching comment on emitInvestigationEvent in investigator.ts).
  broadcastToMobile({ event: 'self-heal:active-code-changes-changed', data: counts })
}

export function applyStagedPatchToWorkspace(
  reportId: string,
): { appliedFiles: string[]; backupPaths: string[] } | { error: string } | null {
  if (!reportId) return null
  const db = getDatabase()
  const row = db
    .prepare('SELECT fix_staged_files FROM error_reports WHERE id = ?')
    .get(reportId) as { fix_staged_files: string } | undefined
  if (!row) return null

  const staged: RemoteEditStagedFileEntry[] = JSON.parse(row.fix_staged_files || '[]')
  if (staged.length === 0) return null

  const workspacePath = getWorkspacePathForReport(reportId)
  const reportMeta = db.prepare(
    'SELECT title, project_id FROM error_reports WHERE id = ?'
  ).get(reportId) as { title: string; project_id: string | null } | undefined
  const backupDir = getBackupDir(reportId)
  mkdirSync(backupDir, { recursive: true })

  const now = Date.now()
  db.prepare(`UPDATE error_reports SET fix_status = 'applying', updated_at = ? WHERE id = ?`).run(now, reportId)

  const appliedFiles: string[] = []
  const backupPaths: string[] = []
  const updatedStaged: RemoteEditStagedFileEntry[] = staged.map((e) => ({ ...e }))
  // Audit entries are recorded only after every file has copied successfully (see the success
  // path below) — recording them eagerly per-file used to mean a mid-loop failure left audit
  // rows claiming files were modified/created that the catch block below then rolls back,
  // silently making the audit trail wrong about what's actually on disk.
  const pendingAudit: { relativePath: string; hadExistingFile: boolean }[] = []

  try {
    for (let i = 0; i < staged.length; i++) {
      const entry = staged[i]
      const workspaceFilePath = resolveInsideWorkspace(workspacePath, entry.relativePath)
      const backupPath = path.join(backupDir, entry.relativePath)
      const hadExistingFile = existsSync(workspaceFilePath)

      if (hadExistingFile) {
        mkdirSync(path.dirname(backupPath), { recursive: true })
        copyFileSync(workspaceFilePath, backupPath)
        updatedStaged[i] = { ...updatedStaged[i], backupPath }
        backupPaths.push(backupPath)
      }

      mkdirSync(path.dirname(workspaceFilePath), { recursive: true })
      copyFileSync(entry.stagingPath, workspaceFilePath)
      appliedFiles.push(entry.relativePath)
      pendingAudit.push({ relativePath: entry.relativePath, hadExistingFile })
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    const completedAt = Date.now()

    // Roll back every file that was successfully copied to the workspace before the failure, so
    // a mid-apply crash never leaves the workspace in a half-applied state that's neither the
    // original code nor the full patch. A file that existed before (has a backup) is restored
    // from it; a file newly created by this apply (no backup — it didn't exist before) is
    // deleted. Best-effort: a rollback failure doesn't mask the original error, which is what
    // actually gets surfaced to the user via fix_error either way.
    for (const relativePath of appliedFiles) {
      const entry = updatedStaged.find((e) => e.relativePath === relativePath)
      const workspaceFilePath = resolveInsideWorkspace(workspacePath, relativePath)
      try {
        if (entry?.backupPath && existsSync(entry.backupPath)) {
          copyFileSync(entry.backupPath, workspaceFilePath)
        } else if (existsSync(workspaceFilePath)) {
          unlinkSync(workspaceFilePath)
        }
      } catch { /* best-effort rollback */ }
    }

    db.prepare(
      `UPDATE error_reports SET fix_status = 'failed', fix_error = ?, fix_completed_at = ?, updated_at = ? WHERE id = ?`,
    ).run(errorMsg, completedAt, completedAt, reportId)
    return { error: errorMsg }
  }

  for (const { relativePath, hadExistingFile } of pendingAudit) {
    const auditTarget = inferProjectAuditTarget(path.join(workspacePath, relativePath), reportMeta?.project_id)
    const diffRow = db
      .prepare('SELECT diff_json FROM remote_edit_diffs WHERE report_id = ? AND relative_path = ?')
      .get(reportId, relativePath) as { diff_json: string } | undefined
    recordProjectAuditChange({
      sessionId: `remote-edit:${reportId}`,
      ...(auditTarget ?? { projectId: reportMeta?.project_id ?? null, relativePath }),
      title: reportMeta?.title?.trim() || `Remote edit ${reportId}`,
      source: 'remote-edit',
      status: hadExistingFile ? 'modified' : 'created',
      lastOperation: 'apply',
      diff: diffRow?.diff_json ? (JSON.parse(diffRow.diff_json) as { hunks: unknown[] }) : null,
    })
  }

  const completedAt = Date.now()
  db.prepare(
    `UPDATE error_reports SET fix_status = 'applied', status = 'completed', fix_staged_files = ?, fix_completed_at = ?, updated_at = ? WHERE id = ?`,
  ).run(JSON.stringify(updatedStaged), completedAt, completedAt, reportId)

  updateHistoryEntry(reportId, { fixAppliedAt: completedAt, status: 'fix-applied' })
  return { appliedFiles, backupPaths }
}

// Call once at app startup, before any renderer can observe Code Changes state. The in-memory
// activeInvestigations/activeFixRuns/activeVerificationRuns Sets below always start empty on a
// fresh process, so any DB row still parked in a "running" state from a previous process was
// interrupted by a crash or restart, not an actually-in-progress run — without this sweep those
// rows stayed permanently stuck (e.g. CodeChangeDetailView.tsx's resumedInBackground guard
// disabling the Plan button forever, with no way to retry except deleting the request).
export function recoverStuckCodeChanges(): void {
  recoverStuckInvestigations()
  recoverStuckFixRuns()
  recoverStuckVerificationRuns()
}

// The gate blocking "Apply to workspace" until every staged file is marked reviewed used to be
// computed purely from renderer-local React state, discarded the moment the chat card unmounted
// (e.g. navigating to another conversation and back) — the persisted RemoteEditStagedFileEntry.
// reviewed field existed but was never actually written to. This is the single write path for
// it, shared by both the desktop IPC handler and the Android WS command below.
export function markStagedFileReviewed(reportId: string, relativePath: string): boolean {
  if (!reportId || !relativePath) return false
  const db = getDatabase()
  const row = db
    .prepare('SELECT fix_staged_files FROM error_reports WHERE id = ?')
    .get(reportId) as { fix_staged_files: string } | undefined
  if (!row) return false

  const staged: RemoteEditStagedFileEntry[] = JSON.parse(row.fix_staged_files || '[]')
  const index = staged.findIndex((f) => f.relativePath === relativePath)
  if (index === -1) return false

  staged[index] = { ...staged[index], reviewed: true }
  const now = Date.now()
  db.prepare('UPDATE error_reports SET fix_staged_files = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(staged), now, reportId)
  return true
}

export function registerRemoteEditHandlers(mainWindow?: BrowserWindow): void {
  // Runs once, here, since this function itself only runs once per process (real startup via
  // ipc-handlers.ts, or once per test "startup") — see recoverStuckCodeChanges's own comment for
  // why any row still in a "running" state at this point must have been interrupted.
  recoverStuckCodeChanges()

  safeHandle('remote-edit:get-investigation-settings', () => loadInvestigationSettings())

  safeHandle('remote-edit:set-investigation-settings', (_event, input: RemoteEditInvestigationSettings) =>
    saveInvestigationSettings(input)
  )

  safeHandle('remote-edit:set-report-status', (_event, reportId: string, status: ErrorReportStatus) => {
    if (!['open', 'investigating', 'investigated', 'completed', 'rejected'].includes(status)) return null
    const now = Date.now()
    getDatabase().prepare('UPDATE error_reports SET status = ?, updated_at = ? WHERE id = ?').run(status, now, reportId)
    return getDatabase().prepare('SELECT * FROM error_reports WHERE id = ?').get(reportId) as ErrorReportEntry | null
  })

  safeHandle('remote-edit:get-active-investigation', (_event, reportId: string) => {
    const progress = investigationProgress.get(reportId)
    return {
      running: activeInvestigations.has(reportId),
      activity: progress?.activity ?? [],
      output: progress?.output ?? '',
    }
  })

  safeHandle('remote-edit:get-active-code-changes', () => computeActiveCodeChangesByProject())

  safeHandle('remote-edit:start-investigation', async (_event, reportId: string, revisionNotes?: string) => {
    if (!mainWindow) throw new Error('Main window is not available')
    if (activeInvestigations.has(reportId)) return { reportId }
    activeInvestigations.add(reportId)
    investigationProgress.set(reportId, { activity: [], output: '' })
    broadcastActiveCodeChangesChanged(mainWindow)
    getOrCreateHistoryEntry(reportId)
    const settings = loadInvestigationSettings()
    void runInvestigation(mainWindow, reportId, {
      onChunk: (chunk) => {
        const progress = investigationProgress.get(reportId)
        if (progress) progress.output += chunk
        emitInvestigationEvent(mainWindow, 'remote-edit:investigation-chunk', { reportId, chunk })
      },
      onActivity: (activity) => {
        const progress = investigationProgress.get(reportId)
        if (progress) progress.activity = [...progress.activity.slice(-49), activity]
        emitInvestigationEvent(mainWindow, 'remote-edit:investigation-activity', activity)
      },
    }, revisionNotes)
      .then((result) => {
        emitInvestigationEvent(mainWindow, 'remote-edit:investigation-done', result)
        const title = (getDatabase().prepare('SELECT title FROM error_reports WHERE id = ?').get(reportId) as { title: string } | undefined)?.title ?? ''
        updateHistoryEntry(reportId, {
          investigationModel: settings.model,
          investigationBackend: settings.backend,
          status: result.status === 'done' ? 'investigated' : 'failed',
          reportTitle: title,
        })
        if (result.status === 'done') {
          sendDesktopNotification('Code Changes', `Planning complete for "${title}". Review the proposed approach.`)
          void sendRemoteEditNotification(getDatabase(), { type: 'investigation-done', reportId, title })
        }
      })
      .finally(() => {
        activeInvestigations.delete(reportId)
        investigationProgress.delete(reportId)
        broadcastActiveCodeChangesChanged(mainWindow)
      })
    return { reportId }
  })

  safeHandle('remote-edit:get-staged-diff', (_event, reportId: string, relativePath: string) => {
    if (!reportId || !relativePath) return null
    const row = getDatabase()
      .prepare('SELECT diff_json FROM remote_edit_diffs WHERE report_id = ? AND relative_path = ?')
      .get(reportId, relativePath) as { diff_json: string } | undefined
    if (row) {
      return { relativePath, ...(JSON.parse(row.diff_json) as { hunks: unknown[] }) } as RemoteEditStagedFileDiff
    }
    return getRemoteEditAuditDiff(reportId, relativePath)
  })

  safeHandle('remote-edit:get-verification-runs', (_event, reportId: string) => {
    if (!reportId) return []
    return getVerificationRuns(reportId)
  })

  safeHandle('remote-edit:get-history', () => listHistory())
  safeHandle('remote-edit:get-history-for-report', (_event, reportId: string) => getHistoryEntryForReport(reportId))
}
