import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import { broadcastToMobile } from '../ws-server'
import { getWorkspacePathForReport, loadInvestigationSettings } from './investigator'
import type {
  RemoteEditVerificationCommand,
  RemoteEditVerificationDone,
  RemoteEditVerificationEvent,
  RemoteEditVerificationRun,
  RemoteEditVerificationStep,
} from '../../shared/types'

const VERIFY_COMMANDS: RemoteEditVerificationCommand[] = ['typecheck', 'lint', 'test', 'build']
const MAX_LOG_CHARS = 24000

function createInitialSteps(): RemoteEditVerificationStep[] {
  return VERIFY_COMMANDS.map((command) => ({
    command,
    status: 'pending',
    exitCode: null,
    log: '',
    startedAt: null,
    completedAt: null,
  }))
}

function appendLog(existing: string, line: string): string {
  const next = `${existing}${line}`
  return next.length > MAX_LOG_CHARS ? next.slice(next.length - MAX_LOG_CHARS) : next
}

function persistRun(run: RemoteEditVerificationRun): void {
  getDatabase()
    .prepare(
      `INSERT OR REPLACE INTO remote_edit_verification_runs
       (id, report_id, status, steps_json, started_at, completed_at, retry_count, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.id,
      run.reportId,
      run.status,
      JSON.stringify(run.steps),
      run.startedAt,
      run.completedAt,
      run.retryCount,
      run.error ?? null,
    )
}

function appendFailureContext(reportId: string, run: RemoteEditVerificationRun): void {
  const failedSteps = run.steps.filter((step) => step.status === 'failed')
  if (failedSteps.length === 0) return

  const context = failedSteps
    .map((step) => {
      const log = step.log.trim().slice(-4000)
      return `### ${step.command} failed\nExit code: ${step.exitCode ?? 'unknown'}\n\n\`\`\`\n${log}\n\`\`\``
    })
    .join('\n\n')

  getDatabase()
    .prepare(
      `UPDATE error_reports
       SET investigation_markdown = COALESCE(investigation_markdown, '') || ?
       WHERE id = ?`,
    )
    .run(`\n\n## Verification failure context\n${context}\n`, reportId)
}

function rowToRun(row: Record<string, unknown>): RemoteEditVerificationRun {
  return {
    id: String(row.id),
    reportId: String(row.report_id),
    status: row.status as RemoteEditVerificationRun['status'],
    steps: JSON.parse(String(row.steps_json || '[]')) as RemoteEditVerificationStep[],
    startedAt: Number(row.started_at),
    completedAt: typeof row.completed_at === 'number' ? row.completed_at : null,
    retryCount: Number(row.retry_count ?? 0),
    error: typeof row.error === 'string' ? row.error : undefined,
  }
}

export function getVerificationRuns(reportId: string): RemoteEditVerificationRun[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM remote_edit_verification_runs WHERE report_id = ? ORDER BY started_at DESC LIMIT 10')
    .all(reportId) as Record<string, unknown>[]
  return rows.map(rowToRun)
}

function runNpmScript(
  workspacePath: string,
  command: RemoteEditVerificationCommand,
  onLine: (line: string) => void,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', command], { cwd: workspacePath, shell: true })
    child.stdout?.on('data', (chunk: Buffer) => onLine(chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => onLine(chunk.toString('utf8')))
    child.on('error', (error) => {
      onLine(`${error.message}\n`)
      resolve(1)
    })
    child.on('close', (code) => resolve(code ?? 1))
  })
}

export function emitVerificationEvent(
  win: BrowserWindow | undefined,
  channel: 'remote-edit:verification-event' | 'remote-edit:verification-done',
  payload: unknown,
): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
  broadcastToMobile({ event: channel, data: payload })
}

export async function runVerification(
  reportId: string,
  emit: (event: RemoteEditVerificationEvent) => void,
  initialRunId?: string,
  reinvestigate?: () => Promise<void>,
): Promise<RemoteEditVerificationDone> {
  const workspacePath = getWorkspacePathForReport(reportId)
  const settings = loadInvestigationSettings()
  const maxRetries = settings.retryLimit
  let finalRun: RemoteEditVerificationRun | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const run: RemoteEditVerificationRun = {
      id: attempt === 0 && initialRunId ? initialRunId : randomUUID(),
      reportId,
      status: 'running',
      steps: createInitialSteps(),
      startedAt: Date.now(),
      completedAt: null,
      retryCount: attempt,
    }
    persistRun(run)
    finalRun = run
    emit({ reportId, runId: run.id, status: 'running', label: attempt > 0 ? `Retrying verification (${attempt}/${maxRetries})` : 'Verification started' })

    let failed = false
    for (const command of VERIFY_COMMANDS) {
      const step = run.steps.find((s) => s.command === command)!
      step.status = 'running'
      step.startedAt = Date.now()
      persistRun(run)
      emit({ reportId, runId: run.id, command, status: 'running', label: `${command} started` })

      const exitCode = await runNpmScript(workspacePath, command, (line) => {
        step.log = appendLog(step.log, line)
        persistRun(run)
        emit({ reportId, runId: run.id, command, status: 'running', line, label: `${command} output` })
      })

      step.exitCode = exitCode
      step.completedAt = Date.now()
      step.status = exitCode === 0 ? 'success' : 'failed'
      persistRun(run)
      emit({ reportId, runId: run.id, command, status: step.status, exitCode, label: `${command} ${step.status}` })

      if (exitCode !== 0) {
        failed = true
        run.error = `${command} failed with exit code ${exitCode}`
        const remaining = run.steps.filter((s) => s.status === 'pending')
        for (const skipped of remaining) {
          skipped.status = 'skipped'
          skipped.completedAt = Date.now()
        }
        break
      }
    }

    run.status = failed ? 'failed' : 'success'
    run.completedAt = Date.now()
    persistRun(run)
    finalRun = run

    if (!failed) {
      const done: RemoteEditVerificationDone = {
        reportId,
        runId: run.id,
        status: 'success',
        steps: run.steps,
        retryCount: attempt,
        completedAt: run.completedAt,
      }
      return done
    }

    if (attempt < maxRetries) {
      appendFailureContext(reportId, run)
      emit({ reportId, runId: run.id, status: 'failed', label: `${run.error}; re-investigating` })
      if (reinvestigate) {
        try {
          await reinvestigate()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          emit({ reportId, runId: run.id, status: 'failed', label: `Re-investigation failed: ${message}` })
        }
      }
      continue
    }
  }

  const failedRun = finalRun!
  return {
    reportId,
    runId: failedRun.id,
    status: 'failed',
    steps: failedRun.steps,
    retryCount: failedRun.retryCount,
    error: failedRun.error ?? 'Verification failed',
    completedAt: failedRun.completedAt ?? Date.now(),
  }
}
