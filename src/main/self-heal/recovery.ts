import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import path from 'path'
import { app, type BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import { safeHandle } from '../safe-handle'
import { broadcastToMobile } from '../ws-server'
import { getWorkspacePath, resolveInsideWorkspace } from './investigator'
import { getSelfHealGitStatus } from './git-ops'
import { updateHistoryEntry } from './history'
import type {
  ErrorReportEntry,
  SelfHealRecoveryBackupFile,
  SelfHealRecoveryEvent,
  SelfHealRecoveryPreReloadState,
  SelfHealRecoveryRun,
  SelfHealRelaunchResult,
  SelfHealReloadStartResult,
  SelfHealReloadPrepareResult,
  SelfHealStartupConfirmationResult,
  SelfHealStagedFileEntry,
} from '../../shared/types'

const PENDING_RECOVERY_SETTING = 'self_heal_pending_recovery_id'

function readReport(reportId: string): ErrorReportEntry | null {
  return getDatabase()
    .prepare('SELECT * FROM error_reports WHERE id = ?')
    .get(reportId) as ErrorReportEntry | undefined ?? null
}

function latestVerificationPassed(reportId: string): boolean {
  const row = getDatabase()
    .prepare('SELECT status FROM self_heal_verification_runs WHERE report_id = ? ORDER BY started_at DESC LIMIT 1')
    .get(reportId) as { status: string } | undefined
  return row?.status === 'success'
}

function readWorkspaceVersion(): string | null {
  try {
    const pkgPath = path.join(getWorkspacePath(), 'package.json')
    if (!existsSync(pkgPath)) return null
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

function rowToRecovery(row: Record<string, unknown>): SelfHealRecoveryRun {
  return {
    id: String(row.id),
    reportId: String(row.report_id),
    status: row.status as SelfHealRecoveryRun['status'],
    targetCommitSha: typeof row.target_commit_sha === 'string' ? row.target_commit_sha : null,
    targetVersion: typeof row.target_version === 'string' ? row.target_version : null,
    backupManifest: JSON.parse(String(row.backup_manifest_json || '[]')) as SelfHealRecoveryBackupFile[],
    preReloadState: JSON.parse(String(row.pre_reload_state_json || '{}')) as SelfHealRecoveryPreReloadState,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    confirmedAt: typeof row.confirmed_at === 'number' ? row.confirmed_at : null,
    rollbackAt: typeof row.rollback_at === 'number' ? row.rollback_at : null,
    error: typeof row.error === 'string' ? row.error : undefined,
  }
}

function persistRecovery(run: SelfHealRecoveryRun): void {
  getDatabase()
    .prepare(
      `INSERT OR REPLACE INTO self_heal_recovery_runs
       (id, report_id, status, target_commit_sha, target_version, backup_manifest_json,
        pre_reload_state_json, created_at, updated_at, confirmed_at, rollback_at, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.id,
      run.reportId,
      run.status,
      run.targetCommitSha,
      run.targetVersion,
      JSON.stringify(run.backupManifest),
      JSON.stringify(run.preReloadState),
      run.createdAt,
      run.updatedAt,
      run.confirmedAt,
      run.rollbackAt,
      run.error ?? null,
    )
}

function updateRecoveryStatus(
  run: SelfHealRecoveryRun,
  status: SelfHealRecoveryRun['status'],
  error?: string,
): SelfHealRecoveryRun {
  const updated: SelfHealRecoveryRun = {
    ...run,
    status,
    updatedAt: Date.now(),
    confirmedAt: status === 'confirmed' ? Date.now() : run.confirmedAt,
    error,
  }
  persistRecovery(updated)
  return updated
}

export function getRecoveryRuns(reportId: string): SelfHealRecoveryRun[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM self_heal_recovery_runs WHERE report_id = ? ORDER BY created_at DESC LIMIT 10')
    .all(reportId) as Record<string, unknown>[]
  return rows.map(rowToRecovery)
}

function getRecoveryRun(recoveryId: string): SelfHealRecoveryRun | null {
  const row = getDatabase()
    .prepare('SELECT * FROM self_heal_recovery_runs WHERE id = ?')
    .get(recoveryId) as Record<string, unknown> | undefined
  return row ? rowToRecovery(row) : null
}

export async function prepareReload(reportId: string): Promise<SelfHealReloadPrepareResult> {
  const report = readReport(reportId)
  const gitStatus = await getSelfHealGitStatus(reportId)
  const staged = report ? JSON.parse(report.fix_staged_files || '[]') as SelfHealStagedFileEntry[] : []
  const backupManifest = staged.map((file) => ({
    relativePath: file.relativePath,
    backupPath: file.backupPath ?? null,
  }))
  const targetVersion = readWorkspaceVersion()
  const preReloadState: SelfHealRecoveryPreReloadState = {
    branch: gitStatus.branch,
    commitSha: gitStatus.commitSha,
    dirty: gitStatus.dirty,
    version: targetVersion,
  }

  let reason: string | undefined
  if (!report) reason = 'Report was not found'
  else if (report.fix_status !== 'applied') reason = 'Fix must be applied before reload preparation'
  else if (!latestVerificationPassed(reportId)) reason = 'Verification must pass before reload preparation'
  else if (!gitStatus.isRepo) reason = gitStatus.error ?? 'Workspace is not a git repository'
  else if (gitStatus.dirty) reason = 'Workspace must be clean after committing the fix'
  else if (backupManifest.length === 0) reason = 'No backup manifest is available for rollback'

  if (reason) {
    return { reportId, recovery: null, canReload: false, reason }
  }

  const now = Date.now()
  const recovery: SelfHealRecoveryRun = {
    id: randomUUID(),
    reportId,
    status: 'prepared',
    targetCommitSha: gitStatus.commitSha,
    targetVersion,
    backupManifest,
    preReloadState,
    createdAt: now,
    updatedAt: now,
    confirmedAt: null,
    rollbackAt: null,
  }
  persistRecovery(recovery)
  return { reportId, recovery, canReload: true }
}

function insertReloadBuildRecord(run: SelfHealRecoveryRun): string {
  const buildId = randomUUID()
  const now = Date.now()
  getDatabase()
    .prepare(
      `INSERT INTO build_records
        (id, workspace_path, commit_sha, branch, version, platform, command, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, 'package', 'running', ?)`,
    )
    .run(
      buildId,
      getWorkspacePath(),
      run.targetCommitSha,
      run.preReloadState.branch,
      run.targetVersion,
      process.platform,
      now,
    )
  return buildId
}

function finishReloadBuildRecord(buildId: string, exitCode: number, logTail: string): void {
  const status = exitCode === 0 ? 'success' : 'failed'
  getDatabase()
    .prepare(
      `UPDATE build_records
       SET status = ?, exit_code = ?, finished_at = ?, log_tail = ?
       WHERE id = ?`,
    )
    .run(status, exitCode, Date.now(), logTail.slice(-4096), buildId)
}

export async function startReload(
  recoveryId: string,
  emit?: (event: SelfHealRecoveryEvent) => void,
): Promise<SelfHealReloadStartResult> {
  const run = getRecoveryRun(recoveryId)
  if (!run) {
    return { reportId: '', recoveryId, started: false, buildId: null, recovery: null, error: 'Recovery run was not found' }
  }
  if (run.status !== 'prepared') {
    return { reportId: run.reportId, recoveryId, started: false, buildId: null, recovery: run, error: 'Recovery run is not prepared' }
  }

  const buildId = insertReloadBuildRecord(run)
  const reloading = updateRecoveryStatus(run, 'reloading')
  emit?.({
    reportId: run.reportId,
    recoveryId,
    type: 'reload',
    label: 'Packaging fixed app for reload',
    status: 'reloading',
  })

  const workspacePath = getWorkspacePath()
  const child = spawn('npm', ['run', 'package'], { cwd: workspacePath, shell: true })
  const logLines: string[] = []

  child.stdout?.on('data', (chunk: Buffer) => logLines.push(chunk.toString('utf8')))
  child.stderr?.on('data', (chunk: Buffer) => logLines.push(chunk.toString('utf8')))
  child.on('error', (error) => {
    finishReloadBuildRecord(buildId, 1, `${logLines.join('')}\n${error.message}`)
    const failed = updateRecoveryStatus(reloading, 'failed', error.message)
    emit?.({
      reportId: run.reportId,
      recoveryId,
      type: 'reload',
      label: `Reload package failed: ${error.message}`,
      status: failed.status,
      error: error.message,
    })
  })
  child.on('close', (code) => {
    const exitCode = code ?? 1
    finishReloadBuildRecord(buildId, exitCode, logLines.join(''))
    if (exitCode === 0) {
      emit?.({
        reportId: run.reportId,
        recoveryId,
        type: 'reload',
        label: 'Package complete. Relaunch approval required.',
        status: 'reloading',
      })
      return
    }
    const failed = updateRecoveryStatus(reloading, 'failed', `Package failed with exit code ${exitCode}`)
    emit?.({
      reportId: run.reportId,
      recoveryId,
      type: 'reload',
      label: failed.error ?? 'Reload package failed',
      status: failed.status,
      error: failed.error,
    })
  })

  return { reportId: run.reportId, recoveryId, started: true, buildId, recovery: reloading }
}

export function approveRelaunch(recoveryId: string): SelfHealRelaunchResult {
  const run = getRecoveryRun(recoveryId)
  if (!run) return { reportId: '', recoveryId, scheduled: false, error: 'Recovery run was not found' }
  if (run.status !== 'reloading') {
    return { reportId: run.reportId, recoveryId, scheduled: false, error: 'Recovery run is not waiting for relaunch' }
  }
  getDatabase()
    .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(PENDING_RECOVERY_SETTING, recoveryId)
  broadcastToMobile({ event: 'self-heal:reloading', data: { recoveryId } })
  app.relaunch()
  app.exit(0)
  return { reportId: run.reportId, recoveryId, scheduled: true }
}

export function confirmStartupAfterRelaunch(
  emit?: (event: SelfHealRecoveryEvent) => void,
): SelfHealStartupConfirmationResult {
  const row = getDatabase()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(PENDING_RECOVERY_SETTING) as { value: string } | undefined
  const recoveryId = row?.value
  if (!recoveryId) return { confirmed: false, recovery: null }

  const run = getRecoveryRun(recoveryId)
  if (!run) {
    getDatabase().prepare('DELETE FROM settings WHERE key = ?').run(PENDING_RECOVERY_SETTING)
    return { confirmed: false, recovery: null, error: 'Pending recovery run was not found' }
  }

  if (run.status !== 'reloading') {
    getDatabase().prepare('DELETE FROM settings WHERE key = ?').run(PENDING_RECOVERY_SETTING)
    return { confirmed: false, recovery: run, error: 'Pending recovery run is not reloading' }
  }

  const confirmed = updateRecoveryStatus(run, 'confirmed')
  getDatabase().prepare('DELETE FROM settings WHERE key = ?').run(PENDING_RECOVERY_SETTING)
  emit?.({
    reportId: confirmed.reportId,
    recoveryId: confirmed.id,
    type: 'confirm',
    label: 'Startup confirmed after self-heal reload',
    status: confirmed.status,
  })
  updateHistoryEntry(confirmed.reportId, { reloaded: true, status: 'reloaded' })
  return { confirmed: true, recovery: confirmed }
}

export async function rollbackHeal(
  recoveryId: string,
  emit?: (event: SelfHealRecoveryEvent) => void,
): Promise<{ rolledBack: boolean; error?: string }> {
  const run = getRecoveryRun(recoveryId)
  if (!run) return { rolledBack: false, error: 'Recovery run not found' }
  if (!['reloading', 'confirmed', 'rollback-required'].includes(run.status)) {
    return { rolledBack: false, error: 'Nothing to roll back' }
  }

  const workspacePath = getWorkspacePath()
  const pending = updateRecoveryStatus(run, 'rollback-required')
  emit?.({ reportId: run.reportId, recoveryId, type: 'rollback', label: 'Rolling back to pre-heal state', status: 'rollback-required' })

  try {
    for (const entry of run.backupManifest) {
      if (!entry.backupPath) continue
      const dest = resolveInsideWorkspace(workspacePath, entry.relativePath)
      mkdirSync(path.dirname(dest), { recursive: true })
      copyFileSync(entry.backupPath, dest)
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    updateRecoveryStatus(pending, 'failed', error)
    emit?.({ reportId: run.reportId, recoveryId, type: 'rollback', label: `Rollback failed: ${error}`, status: 'failed', error })
    return { rolledBack: false, error }
  }

  updateRecoveryStatus(pending, 'rolled-back')
  emit?.({ reportId: run.reportId, recoveryId, type: 'rollback', label: 'Rollback complete', status: 'rolled-back' })
  updateHistoryEntry(run.reportId, { rolledBack: true, status: 'rolled-back' })
  return { rolledBack: true }
}

function emitRecoveryEvent(win: BrowserWindow | undefined, event: SelfHealRecoveryEvent): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send('self-heal:recovery-event', event)
  }
  broadcastToMobile({ event: 'self-heal:recovery-event', data: event })
}

export function registerSelfHealRecoveryHandlers(mainWindow?: BrowserWindow): void {
  safeHandle('self-heal:get-recovery-runs', (_event, reportId: string) => {
    if (!reportId) return []
    return getRecoveryRuns(reportId)
  })

  safeHandle('self-heal:prepare-reload', async (_event, reportId: string) => {
    const result = await prepareReload(reportId)
    emitRecoveryEvent(mainWindow, {
      reportId,
      recoveryId: result.recovery?.id,
      type: 'prepare',
      label: result.canReload ? 'Reload preparation saved' : result.reason ?? 'Reload preparation failed',
      status: result.recovery?.status,
      error: result.reason,
    })
    return result
  })

  safeHandle('self-heal:start-reload', async (_event, recoveryId: string) => {
    const result = await startReload(recoveryId, (event) => emitRecoveryEvent(mainWindow, event))
    if (!result.started) {
      emitRecoveryEvent(mainWindow, {
        reportId: result.reportId,
        recoveryId,
        type: 'reload',
        label: result.error ?? 'Reload could not be started',
        status: result.recovery?.status,
        error: result.error,
      })
    }
    return result
  })

  safeHandle('self-heal:approve-relaunch', (_event, recoveryId: string) => approveRelaunch(recoveryId))

  safeHandle('self-heal:confirm-startup', () =>
    confirmStartupAfterRelaunch((event) => emitRecoveryEvent(mainWindow, event)),
  )

  safeHandle('self-heal:rollback', async (_event, recoveryId: string) => {
    return rollbackHeal(recoveryId, (event) => emitRecoveryEvent(mainWindow, event))
  })
}
