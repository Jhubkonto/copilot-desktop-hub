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
  getWorkspacePath,
  resolveInsideWorkspace,
} from './self-heal/investigator'
import {
  runFix,
  emitFixEvent,
  getBackupDir,
} from './self-heal/fix-agent'
import {
  emitVerificationEvent,
  getVerificationRuns,
  runVerification,
} from './self-heal/verifier'
import { getOrCreateHistoryEntry, listHistory, updateHistoryEntry } from './self-heal/history'
import { sendSelfHealNotification } from './fcm-sender'
import { getDatabase } from './database'
import type {
  ErrorReportEntry,
  ErrorReportStatus,
  SelfHealFixDone,
  SelfHealFixEvent,
  SelfHealInvestigationSettings,
  SelfHealStagedFileDiff,
  SelfHealStagedFileEntry,
  SelfHealVerificationDone,
  SelfHealVerificationEvent,
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

export function registerSelfHealHandlers(mainWindow?: BrowserWindow): void {
  safeHandle('self-heal:get-investigation-settings', () => loadInvestigationSettings())

  safeHandle('self-heal:set-investigation-settings', (_event, input: SelfHealInvestigationSettings) =>
    saveInvestigationSettings(input)
  )

  safeHandle('self-heal:set-report-status', (_event, reportId: string, status: ErrorReportStatus) => {
    if (!['open', 'investigating', 'investigated', 'fixed', 'rejected'].includes(status)) return null
    const now = Date.now()
    getDatabase().prepare('UPDATE error_reports SET status = ?, updated_at = ? WHERE id = ?').run(status, now, reportId)
    return getDatabase().prepare('SELECT * FROM error_reports WHERE id = ?').get(reportId) as ErrorReportEntry | null
  })

  safeHandle('self-heal:start-investigation', async (_event, reportId: string) => {
    if (!mainWindow) throw new Error('Main window is not available')
    if (activeInvestigations.has(reportId)) return { reportId }
    activeInvestigations.add(reportId)
    getOrCreateHistoryEntry(reportId)
    const settings = loadInvestigationSettings()
    void runInvestigation(mainWindow, reportId, {
      onChunk: (chunk) => {
        emitInvestigationEvent(mainWindow, 'self-heal:investigation-chunk', { reportId, chunk })
      },
      onActivity: (activity) => {
        emitInvestigationEvent(mainWindow, 'self-heal:investigation-activity', activity)
      },
    })
      .then((result) => {
        emitInvestigationEvent(mainWindow, 'self-heal:investigation-done', result)
        const title = (getDatabase().prepare('SELECT title FROM error_reports WHERE id = ?').get(reportId) as { title: string } | undefined)?.title ?? ''
        updateHistoryEntry(reportId, {
          investigationModel: settings.model,
          investigationBackend: settings.backend,
          status: result.status === 'done' ? 'investigated' : 'failed',
          reportTitle: title,
        })
        if (result.status === 'done') {
          sendDesktopNotification('Self-Heal', `Investigation complete for "${title}". Review the plan.`)
          void sendSelfHealNotification(getDatabase(), { type: 'investigation-done', reportId, title })
        }
      })
      .finally(() => {
        activeInvestigations.delete(reportId)
      })
    return { reportId }
  })

  safeHandle('self-heal:start-fix', async (_event, reportId: string) => {
    if (!mainWindow) throw new Error('Main window is not available')
    if (activeFixRuns.has(reportId)) return { reportId }
    activeFixRuns.add(reportId)
    void runFix(mainWindow, reportId, {
      onEvent: (event: SelfHealFixEvent) => {
        emitFixEvent(mainWindow, 'self-heal:fix-event', event)
      },
    })
      .then((result: SelfHealFixDone) => {
        emitFixEvent(mainWindow, 'self-heal:fix-done', result)
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
        const failResult: SelfHealFixDone = {
          reportId,
          status: 'error',
          stagedFiles: [],
          error: errorMsg,
          completedAt,
        }
        emitFixEvent(mainWindow, 'self-heal:fix-done', failResult)
      })
      .finally(() => {
        activeFixRuns.delete(reportId)
      })
    return { reportId }
  })

  safeHandle('self-heal:get-staged-diff', (_event, reportId: string, relativePath: string) => {
    if (!reportId || !relativePath) return null
    const row = getDatabase()
      .prepare('SELECT diff_json FROM self_heal_diffs WHERE report_id = ? AND relative_path = ?')
      .get(reportId, relativePath) as { diff_json: string } | undefined
    if (!row) return null
    return { relativePath, ...(JSON.parse(row.diff_json) as { hunks: unknown[] }) } as SelfHealStagedFileDiff
  })

  safeHandle('self-heal:revert-staged-file', (_event, reportId: string, relativePath: string) => {
    if (!reportId || !relativePath) return false
    const db = getDatabase()
    const row = db
      .prepare('SELECT fix_staged_files FROM error_reports WHERE id = ?')
      .get(reportId) as { fix_staged_files: string } | undefined
    if (!row) return false

    const staged: SelfHealStagedFileEntry[] = JSON.parse(row.fix_staged_files || '[]')
    const entry = staged.find((f) => f.relativePath === relativePath)
    if (!entry) return false

    try {
      if (existsSync(entry.stagingPath)) unlinkSync(entry.stagingPath)
    } catch { /* staging file missing — continue */ }

    db.prepare('DELETE FROM self_heal_diffs WHERE report_id = ? AND relative_path = ?')
      .run(reportId, relativePath)

    const updated = staged.filter((f) => f.relativePath !== relativePath)
    const now = Date.now()
    db.prepare('UPDATE error_reports SET fix_staged_files = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(updated), now, reportId)
    return true
  })

  safeHandle('self-heal:commit-to-workspace', (_event, reportId: string) => {
    if (!reportId) return null
    const db = getDatabase()
    const row = db
      .prepare('SELECT fix_staged_files FROM error_reports WHERE id = ?')
      .get(reportId) as { fix_staged_files: string } | undefined
    if (!row) return null

    const staged: SelfHealStagedFileEntry[] = JSON.parse(row.fix_staged_files || '[]')
    if (staged.length === 0) return null

    const workspacePath = getWorkspacePath()
    const backupDir = getBackupDir(reportId)
    mkdirSync(backupDir, { recursive: true })

    const now = Date.now()
    db.prepare(`UPDATE error_reports SET fix_status = 'applying', updated_at = ? WHERE id = ?`).run(now, reportId)

    const appliedFiles: string[] = []
    const backupPaths: string[] = []
    const updatedStaged: SelfHealStagedFileEntry[] = staged.map((e) => ({ ...e }))

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
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      const completedAt = Date.now()
      db.prepare(
        `UPDATE error_reports SET fix_status = 'failed', fix_error = ?, fix_completed_at = ?, updated_at = ? WHERE id = ?`,
      ).run(errorMsg, completedAt, completedAt, reportId)
      return null
    }

    const completedAt = Date.now()
    db.prepare(
      `UPDATE error_reports SET fix_status = 'applied', status = 'fixed', fix_staged_files = ?, fix_completed_at = ?, updated_at = ? WHERE id = ?`,
    ).run(JSON.stringify(updatedStaged), completedAt, completedAt, reportId)

    updateHistoryEntry(reportId, { fixAppliedAt: completedAt, status: 'fix-applied' })
    return { appliedFiles, backupPaths }
  })

  safeHandle('self-heal:get-verification-runs', (_event, reportId: string) => {
    if (!reportId) return []
    return getVerificationRuns(reportId)
  })

  safeHandle('self-heal:start-verification', async (_event, reportId: string) => {
    if (!mainWindow) throw new Error('Main window is not available')
    if (activeVerificationRuns.has(reportId)) {
      const existing = getVerificationRuns(reportId)[0]
      return { reportId, runId: existing?.id ?? reportId }
    }
    activeVerificationRuns.add(reportId)
    const runId = `${reportId}-${Date.now()}`
    void runVerification(reportId, (event: SelfHealVerificationEvent) => {
      emitVerificationEvent(mainWindow, 'self-heal:verification-event', event)
    }, runId, async () => {
      const result = await runInvestigation(mainWindow, reportId, {
        onChunk: (chunk) => {
          emitInvestigationEvent(mainWindow, 'self-heal:investigation-chunk', { reportId, chunk })
        },
        onActivity: (activity) => {
          emitInvestigationEvent(mainWindow, 'self-heal:investigation-activity', activity)
        },
      })
      emitInvestigationEvent(mainWindow, 'self-heal:investigation-done', result)
    })
      .then((result: SelfHealVerificationDone) => {
        emitVerificationEvent(mainWindow, 'self-heal:verification-done', result)
        const title = (getDatabase().prepare('SELECT title FROM error_reports WHERE id = ?').get(reportId) as { title: string } | undefined)?.title ?? ''
        if (result.status === 'success') {
          updateHistoryEntry(reportId, { verificationPassed: true, status: 'verified' })
          sendDesktopNotification('Self-Heal', `Verification passed for "${title}". Ready to commit.`)
          void sendSelfHealNotification(getDatabase(), { type: 'verification-passed', reportId, title })
        } else {
          const failedStep = result.steps.find((s) => s.status === 'failed')?.command ?? null
          updateHistoryEntry(reportId, { verificationPassed: false, verificationFailedStep: failedStep, status: 'verify-failed' })
          sendDesktopNotification('Self-Heal', `Verification failed (${failedStep ?? 'unknown step'}) for "${title}".`)
          void sendSelfHealNotification(getDatabase(), { type: 'verification-failed', reportId, title, failedStep })
        }
      })
      .finally(() => {
        activeVerificationRuns.delete(reportId)
      })
    return { reportId, runId }
  })

  safeHandle('self-heal:get-history', () => listHistory())
}
