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
} from './remote-edit/investigator'
import {
  runFix,
  emitFixEvent,
  getBackupDir,
} from './remote-edit/fix-agent'
import {
  emitVerificationEvent,
  getVerificationRuns,
  runVerification,
} from './remote-edit/verifier'
import { getOrCreateHistoryEntry, listHistory, updateHistoryEntry } from './remote-edit/history'
import { prepareReload } from './remote-edit/recovery'
import { sendRemoteEditNotification } from './fcm-sender'
import { getDatabase } from './database'
import { getRemoteEditAuditDiff, inferProjectIdForWorkspace, recordProjectAuditChange } from './project-audit'
import { broadcastToMobile } from './ws-server'
import type {
  ErrorReportEntry,
  ErrorReportStatus,
  RemoteEditFixDone,
  RemoteEditFixEvent,
  RemoteEditInvestigationActivity,
  RemoteEditInvestigationSettings,
  RemoteEditStagedFileDiff,
  RemoteEditStagedFileEntry,
  RemoteEditVerificationDone,
  RemoteEditVerificationEvent,
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
  const projectId = inferProjectIdForWorkspace(workspacePath)
  const reportMeta = db.prepare(
    'SELECT title FROM error_reports WHERE id = ?'
  ).get(reportId) as { title: string } | undefined
  const backupDir = getBackupDir(reportId)
  mkdirSync(backupDir, { recursive: true })

  const now = Date.now()
  db.prepare(`UPDATE error_reports SET fix_status = 'applying', updated_at = ? WHERE id = ?`).run(now, reportId)

  const appliedFiles: string[] = []
  const backupPaths: string[] = []
  const updatedStaged: RemoteEditStagedFileEntry[] = staged.map((e) => ({ ...e }))

  try {
    for (let i = 0; i < staged.length; i++) {
      const entry = staged[i]
      const workspaceFilePath = resolveInsideWorkspace(workspacePath, entry.relativePath)
      const backupPath = path.join(backupDir, entry.relativePath)

      if (existsSync(workspaceFilePath)) {
        mkdirSync(path.dirname(backupPath), { recursive: true })
        copyFileSync(workspaceFilePath, backupPath)
        updatedStaged[i] = { ...updatedStaged[i], backupPath }
        backupPaths.push(backupPath)
      }

      mkdirSync(path.dirname(workspaceFilePath), { recursive: true })
      copyFileSync(entry.stagingPath, workspaceFilePath)
      appliedFiles.push(entry.relativePath)

      const diffRow = db
        .prepare('SELECT diff_json FROM remote_edit_diffs WHERE report_id = ? AND relative_path = ?')
        .get(reportId, entry.relativePath) as { diff_json: string } | undefined
      recordProjectAuditChange({
        sessionId: `remote-edit:${reportId}`,
        projectId,
        title: reportMeta?.title?.trim() || `Remote edit ${reportId}`,
        source: 'remote-edit',
        relativePath: entry.relativePath,
        status: existsSync(backupPath) ? 'modified' : 'created',
        lastOperation: 'apply',
        diff: diffRow?.diff_json ? (JSON.parse(diffRow.diff_json) as { hunks: unknown[] }) : null,
      })
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    const completedAt = Date.now()
    db.prepare(
      `UPDATE error_reports SET fix_status = 'failed', fix_error = ?, fix_completed_at = ?, updated_at = ? WHERE id = ?`,
    ).run(errorMsg, completedAt, completedAt, reportId)
    return { error: errorMsg }
  }

  const completedAt = Date.now()
  db.prepare(
    `UPDATE error_reports SET fix_status = 'applied', status = 'fixed', fix_staged_files = ?, fix_completed_at = ?, updated_at = ? WHERE id = ?`,
  ).run(JSON.stringify(updatedStaged), completedAt, completedAt, reportId)

  updateHistoryEntry(reportId, { fixAppliedAt: completedAt, status: 'fix-applied' })
  return { appliedFiles, backupPaths }
}

export function registerRemoteEditHandlers(mainWindow?: BrowserWindow): void {
  safeHandle('remote-edit:get-investigation-settings', () => loadInvestigationSettings())

  safeHandle('remote-edit:set-investigation-settings', (_event, input: RemoteEditInvestigationSettings) =>
    saveInvestigationSettings(input)
  )

  safeHandle('remote-edit:set-report-status', (_event, reportId: string, status: ErrorReportStatus) => {
    if (!['open', 'investigating', 'investigated', 'fixed', 'rejected'].includes(status)) return null
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

  safeHandle('remote-edit:start-fix', async (_event, reportId: string) => {
    if (!mainWindow) throw new Error('Main window is not available')
    if (activeFixRuns.has(reportId)) return { reportId }
    activeFixRuns.add(reportId)
    broadcastActiveCodeChangesChanged(mainWindow)
    void runFix(mainWindow, reportId, {
      onEvent: (event: RemoteEditFixEvent) => {
        emitFixEvent(mainWindow, 'remote-edit:fix-event', event)
      },
    })
      .then((result: RemoteEditFixDone) => {
        emitFixEvent(mainWindow, 'remote-edit:fix-done', result)
        if (result.status === 'done') {
          updateHistoryEntry(reportId, { status: 'fix-staged' })
        }
      })
      .catch((err: unknown) => {
        const completedAt = Date.now()
        const errorMsg = err instanceof Error ? err.message : String(err)
        getDatabase()
          .prepare(
            `UPDATE error_reports SET fix_status = 'failed', fix_error = ?, fix_completed_at = ?, updated_at = ? WHERE id = ?`,
          )
          .run(errorMsg, completedAt, completedAt, reportId)
        const failResult: RemoteEditFixDone = {
          reportId,
          status: 'error',
          stagedFiles: [],
          error: errorMsg,
          completedAt,
        }
        emitFixEvent(mainWindow, 'remote-edit:fix-done', failResult)
      })
      .finally(() => {
        activeFixRuns.delete(reportId)
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

  safeHandle('remote-edit:revert-staged-file', (_event, reportId: string, relativePath: string) => {
    if (!reportId || !relativePath) return false
    const db = getDatabase()
    const row = db
      .prepare('SELECT fix_staged_files FROM error_reports WHERE id = ?')
      .get(reportId) as { fix_staged_files: string } | undefined
    if (!row) return false

    const staged: RemoteEditStagedFileEntry[] = JSON.parse(row.fix_staged_files || '[]')
    const entry = staged.find((f) => f.relativePath === relativePath)
    if (!entry) return false

    try {
      if (existsSync(entry.stagingPath)) unlinkSync(entry.stagingPath)
    } catch { /* staging file missing — continue */ }

    db.prepare('DELETE FROM remote_edit_diffs WHERE report_id = ? AND relative_path = ?')
      .run(reportId, relativePath)

    const updated = staged.filter((f) => f.relativePath !== relativePath)
    const now = Date.now()
    db.prepare('UPDATE error_reports SET fix_staged_files = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(updated), now, reportId)
    return true
  })

  safeHandle('remote-edit:commit-to-workspace', (_event, reportId: string) => {
    const result = applyStagedPatchToWorkspace(reportId)
    if (result && 'error' in result) return null
    return result
  })

  safeHandle('remote-edit:get-verification-runs', (_event, reportId: string) => {
    if (!reportId) return []
    return getVerificationRuns(reportId)
  })

  safeHandle('remote-edit:start-verification', async (_event, reportId: string) => {
    if (!mainWindow) throw new Error('Main window is not available')
    if (activeVerificationRuns.has(reportId)) {
      const existing = getVerificationRuns(reportId)[0]
      return { reportId, runId: existing?.id ?? reportId }
    }
    activeVerificationRuns.add(reportId)
    broadcastActiveCodeChangesChanged(mainWindow)
    const runId = `${reportId}-${Date.now()}`
    void runVerification(reportId, (event: RemoteEditVerificationEvent) => {
      emitVerificationEvent(mainWindow, 'remote-edit:verification-event', event)
    }, runId, async () => {
      const result = await runInvestigation(mainWindow, reportId, {
        onChunk: (chunk) => {
          emitInvestigationEvent(mainWindow, 'remote-edit:investigation-chunk', { reportId, chunk })
        },
        onActivity: (activity) => {
          emitInvestigationEvent(mainWindow, 'remote-edit:investigation-activity', activity)
        },
      })
      emitInvestigationEvent(mainWindow, 'remote-edit:investigation-done', result)
    })
      .then((result: RemoteEditVerificationDone) => {
        emitVerificationEvent(mainWindow, 'remote-edit:verification-done', result)
        const title = (getDatabase().prepare('SELECT title FROM error_reports WHERE id = ?').get(reportId) as { title: string } | undefined)?.title ?? ''
        if (result.status === 'success') {
          updateHistoryEntry(reportId, { verificationPassed: true, status: 'verified' })
          sendDesktopNotification('Code Changes', `Verification passed for "${title}". Ready to commit.`)
          void sendRemoteEditNotification(getDatabase(), { type: 'verification-passed', reportId, title })
        } else {
          const failedStep = result.steps.find((s) => s.status === 'failed')?.command ?? null
          updateHistoryEntry(reportId, { verificationPassed: false, verificationFailedStep: failedStep, status: 'verify-failed' })
          sendDesktopNotification('Code Changes', `Verification failed (${failedStep ?? 'unknown step'}) for "${title}".`)
          void sendRemoteEditNotification(getDatabase(), { type: 'verification-failed', reportId, title, failedStep })
        }
        // Capture the backup manifest regardless of verification outcome — "Undo this change" is
        // a pure file restore and doesn't require verification to have passed (see prepareReload()
        // in recovery.ts). This ensures a recovery run always exists once a patch has been applied
        // and verified, so undo is reachable on both platforms even after a failed verification.
        void prepareReload(reportId).catch(() => {})
      })
      .finally(() => {
        activeVerificationRuns.delete(reportId)
        broadcastActiveCodeChangesChanged(mainWindow)
      })
    return { reportId, runId }
  })

  safeHandle('remote-edit:get-history', () => listHistory())
}
