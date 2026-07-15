import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import { broadcastToMobile } from '../ws-server'
import { startActivity, endActivity } from '../activity-tracker'
import { parseProjectConfig } from '../project-handlers'
import { DEFAULT_VERIFY_COMMANDS } from '../../shared/code-changes'
import { getWorkspacePathForReport, loadInvestigationSettings } from './investigator'
import { debugLog } from '../debug-mode'
import type {
  RemoteEditVerificationDone,
  RemoteEditVerificationEvent,
  RemoteEditVerificationRun,
  RemoteEditVerificationStep,
  RemoteEditVerifyCommandConfig,
} from '../../shared/types'

const MAX_LOG_CHARS = 24000

// A project's ProjectConfig.verifyCommands overrides the default npm scripts below — lets
// projects that don't use npm, or that want a different command set, configure their own.
export function resolveVerifyCommands(reportId: string): RemoteEditVerifyCommandConfig[] {
  const report = getDatabase().prepare('SELECT project_id FROM error_reports WHERE id = ?').get(reportId) as
    | { project_id: string | null }
    | undefined
  if (!report?.project_id) return DEFAULT_VERIFY_COMMANDS
  const projectRow = getDatabase().prepare('SELECT config_json FROM projects WHERE id = ?').get(report.project_id) as
    | { config_json: string | null }
    | undefined
  const config = parseProjectConfig(projectRow?.config_json ?? null)
  return config.verifyCommands && config.verifyCommands.length > 0 ? config.verifyCommands : DEFAULT_VERIFY_COMMANDS
}

function createInitialSteps(commands: RemoteEditVerifyCommandConfig[]): RemoteEditVerificationStep[] {
  return commands.map((command) => ({
    command: command.id,
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

// activeVerificationRuns (remote-edit-handlers.ts) is a fresh, empty in-memory Set on every
// process start, so any run row still at status='running' at startup was interrupted by a crash
// or restart mid-command — there is no code path that could otherwise leave it there. Marks it
// failed (skipping any step that never got to report a real outcome) so the existing
// verificationFailed UI in RemoteEditDiffViewer.tsx (Revise patch / Re-run verification) picks it
// up unchanged, instead of the run staying silently stuck "running" forever.
export function recoverStuckVerificationRuns(): void {
  const now = Date.now()
  const stuck = getDatabase()
    .prepare(`SELECT id, steps_json FROM remote_edit_verification_runs WHERE status = 'running'`)
    .all() as { id: string; steps_json: string }[]
  for (const run of stuck) {
    const steps = (JSON.parse(run.steps_json || '[]') as RemoteEditVerificationStep[]).map((step) =>
      step.status === 'running' || step.status === 'pending'
        ? { ...step, status: 'skipped' as const, completedAt: now }
        : step,
    )
    getDatabase()
      .prepare(
        `UPDATE remote_edit_verification_runs SET status = 'failed', steps_json = ?, completed_at = ?, error = ? WHERE id = ?`,
      )
      .run(JSON.stringify(steps), now, 'The app was closed or restarted during verification.', run.id)
  }
}

function runVerifyCommand(
  workspacePath: string,
  command: RemoteEditVerifyCommandConfig,
  onLine: (line: string) => void,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command.command, [], { cwd: workspacePath, shell: true })
    child.stdout?.on('data', (chunk: Buffer) => onLine(chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => onLine(chunk.toString('utf8')))
    child.on('error', (error) => {
      onLine(`${error.message}\n`)
      resolve(1)
    })
    child.on('close', (code) => resolve(code ?? 1))
  })
}

// See the matching comment on emitInvestigationEvent in investigator.ts — the Android client only
// recognizes "self-heal:*" event names, so the mobile broadcast needs translating from the
// "remote-edit:*" channel param used for desktop's webContents.send.
const MOBILE_EVENT_NAMES: Record<string, string> = {
  'remote-edit:verification-event': 'self-heal:verification-event',
  'remote-edit:verification-done': 'self-heal:verification-done',
}

export function emitVerificationEvent(
  win: BrowserWindow | undefined,
  channel: 'remote-edit:verification-event' | 'remote-edit:verification-done',
  payload: unknown,
): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
  broadcastToMobile({ event: MOBILE_EVENT_NAMES[channel], data: payload })
}

export async function runVerification(
  reportId: string,
  emit: (event: RemoteEditVerificationEvent) => void,
  initialRunId?: string,
  reinvestigate?: () => Promise<void>,
): Promise<RemoteEditVerificationDone> {
  const activityId = `remote-edit:${reportId}`
  const reportRow = getDatabase().prepare('SELECT project_id, conversation_id FROM error_reports WHERE id = ?').get(reportId) as { project_id: string | null; conversation_id: string | null } | undefined
  startActivity({
    id: activityId,
    kind: 'remote-edit',
    label: 'Verifying code change…',
    projectId: reportRow?.project_id ?? undefined,
    conversationId: reportRow?.conversation_id ?? undefined,
  })
  try {
    return await runVerificationInner(reportId, emit, initialRunId, reinvestigate)
  } finally {
    endActivity(activityId)
  }
}

async function runVerificationInner(
  reportId: string,
  emit: (event: RemoteEditVerificationEvent) => void,
  initialRunId?: string,
  reinvestigate?: () => Promise<void>,
): Promise<RemoteEditVerificationDone> {
  const workspacePath = getWorkspacePathForReport(reportId)
  const settings = loadInvestigationSettings(reportId)
  debugLog('code-change', `verify dispatch: reportId=${reportId} backend=${settings.backend} model=${settings.model}`)
  const verifyCommands = resolveVerifyCommands(reportId)

  const run: RemoteEditVerificationRun = {
    id: initialRunId ?? randomUUID(),
    reportId,
    status: 'running',
    steps: createInitialSteps(verifyCommands),
    startedAt: Date.now(),
    completedAt: null,
    retryCount: 0,
  }
  persistRun(run)
  emit({ reportId, runId: run.id, status: 'running', label: 'Verification started' })

  let failed = false
  for (const commandConfig of verifyCommands) {
    const command = commandConfig.id
    const step = run.steps.find((s) => s.command === command)!
    step.status = 'running'
    step.startedAt = Date.now()
    persistRun(run)
    emit({ reportId, runId: run.id, command, status: 'running', label: `${commandConfig.label} started` })

    const exitCode = await runVerifyCommand(workspacePath, commandConfig, (line) => {
      step.log = appendLog(step.log, line)
      persistRun(run)
      emit({ reportId, runId: run.id, command, status: 'running', line, label: `${commandConfig.label} output` })
    })

    step.exitCode = exitCode
    step.completedAt = Date.now()
    step.status = exitCode === 0 ? 'success' : 'failed'
    persistRun(run)
    emit({ reportId, runId: run.id, command, status: step.status, exitCode, label: `${commandConfig.label} ${step.status}` })

    if (exitCode !== 0) {
      failed = true
      run.error = `${commandConfig.label} failed with exit code ${exitCode}`
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

  if (!failed) {
    return {
      reportId,
      runId: run.id,
      status: 'success',
      steps: run.steps,
      retryCount: 0,
      completedAt: run.completedAt,
    }
  }

  // Deliberately does not loop back into another verify attempt: re-running the exact same npm
  // scripts against the exact same already-applied files can only ever fail identically, since
  // nothing here regenerates or re-applies the patch. Auto-regenerating and re-applying without
  // a fresh human review pass would bypass the "Mark reviewed" gate that Apply to workspace
  // otherwise requires (see remote-edit:mark-file-reviewed) — so a failed verification always
  // ends the run here. If retries are configured, one reinvestigation still runs to fold the
  // failure context into the plan, so a human revising the patch has useful diagnosis to work
  // from, but the user must manually regenerate/re-review/re-apply and re-verify.
  if (settings.retryLimit > 0) {
    appendFailureContext(reportId, run)
    emit({ reportId, runId: run.id, status: 'failed', label: `${run.error}; re-investigating for the next patch revision` })
    if (reinvestigate) {
      try {
        await reinvestigate()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        emit({ reportId, runId: run.id, status: 'failed', label: `Re-investigation failed: ${message}` })
      }
    }
  }

  return {
    reportId,
    runId: run.id,
    status: 'failed',
    steps: run.steps,
    retryCount: 0,
    error: run.error ?? 'Verification failed',
    completedAt: run.completedAt ?? Date.now(),
  }
}
