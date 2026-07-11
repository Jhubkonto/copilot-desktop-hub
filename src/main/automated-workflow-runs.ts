import { randomUUID } from 'crypto'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import type {
  AutomatedWorkflowConfirmationMode,
  AutomatedWorkflowRunDetail,
  AutomatedWorkflowRunStatus,
  AutomatedWorkflowRunStep,
  AutomatedWorkflowRunSummary,
  AutomatedWorkflowSpec,
  AutomatedWorkflowStepStatus,
} from '../shared/types'

interface RunRow {
  id: string
  project_id: string | null
  title: string
  goal_summary: string
  assumptions_json: string
  model: string | null
  status: AutomatedWorkflowRunStatus
  confirmation_mode: AutomatedWorkflowConfirmationMode
  current_step_id: string | null
  error: string | null
  created_at: number
  updated_at: number
  scheduled_run_id: string | null
  spec_sort_order: number | null
}

interface StepRow {
  id: string
  run_id: string
  step_index: number
  step_key: string
  title: string
  summary: string
  agent_id: string | null
  agent_name: string | null
  model: string | null
  prompt: string
  expected_output: string
  depends_on_step_ids_json: string
  status: AutomatedWorkflowStepStatus
  attempt: number
  output: string
  error: string | null
  conversation_id: string | null
  started_at: number | null
  completed_at: number | null
}

function parseJsonArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function rowToRunStep(row: StepRow): AutomatedWorkflowRunStep {
  const dependsOnStepIds = parseJsonArray(row.depends_on_step_ids_json)
  return {
    id: row.step_key,
    dbId: row.id,
    runId: row.run_id,
    stepIndex: row.step_index,
    title: row.title,
    summary: row.summary,
    agentId: row.agent_id ?? undefined,
    agentName: row.agent_name ?? undefined,
    model: row.model ?? undefined,
    prompt: row.prompt,
    expectedOutput: row.expected_output,
    dependsOnStepIds: dependsOnStepIds.length > 0 ? dependsOnStepIds : undefined,
    status: row.status,
    attempt: row.attempt,
    output: row.output,
    error: row.error,
    conversationId: row.conversation_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

function computeStepCounts(steps: AutomatedWorkflowRunStep[]): AutomatedWorkflowRunSummary['stepCounts'] {
  return {
    total: steps.length,
    pending: steps.filter((s) => s.status === 'pending').length,
    running: steps.filter((s) => s.status === 'running').length,
    awaitingConfirmation: steps.filter((s) => s.status === 'awaiting_confirmation').length,
    done: steps.filter((s) => s.status === 'done').length,
    failed: steps.filter((s) => s.status === 'failed').length,
    skipped: steps.filter((s) => s.status === 'skipped').length,
  }
}

function rowToRunSummary(row: RunRow, stepCounts: AutomatedWorkflowRunSummary['stepCounts']): AutomatedWorkflowRunSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    goalSummary: row.goal_summary,
    model: row.model,
    status: row.status,
    confirmationMode: row.confirmation_mode,
    currentStepId: row.current_step_id,
    lastError: row.error,
    stepCounts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function loadRunSteps(runId: string): AutomatedWorkflowRunStep[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM automated_workflow_run_steps WHERE run_id = ? ORDER BY step_index ASC')
    .all(runId) as StepRow[]
  return rows.map(rowToRunStep)
}

function insertSteps(runId: string, steps: AutomatedWorkflowSpec['steps']): void {
  const db = getDatabase()
  const insert = db.prepare(`
    INSERT INTO automated_workflow_run_steps (
      id, run_id, step_index, step_key, title, summary, agent_id, agent_name, model,
      prompt, expected_output, depends_on_step_ids_json, status, attempt, output, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', NULL, NULL)
  `)
  steps.forEach((step, index) => {
    insert.run(
      randomUUID(),
      runId,
      index,
      step.id,
      step.title,
      step.summary,
      step.agentId ?? null,
      step.agentName ?? null,
      step.model ?? null,
      step.prompt,
      step.expectedOutput,
      JSON.stringify(step.dependsOnStepIds ?? []),
    )
  })
}

export function getAutomatedWorkflowRun(runId: string): AutomatedWorkflowRunDetail | null {
  const row = getDatabase()
    .prepare('SELECT * FROM automated_workflow_runs WHERE id = ?')
    .get(runId) as RunRow | undefined
  if (!row) return null
  const steps = loadRunSteps(runId)
  return {
    ...rowToRunSummary(row, computeStepCounts(steps)),
    assumptions: parseJsonArray(row.assumptions_json),
    steps,
  }
}

export function listAutomatedWorkflowRuns(projectId: string | null): AutomatedWorkflowRunSummary[] {
  // `IS ?` (not `= ?`) — SQL `=` never matches NULL, so a project-less run would be silently
  // excluded from both `listAutomatedWorkflowRuns(null)` and `listAutomatedWorkflowRuns('some-id')`
  // if this used `=`. `IS` is NULL-safe in SQLite.
  const rows = getDatabase()
    .prepare('SELECT * FROM automated_workflow_runs WHERE project_id IS ? ORDER BY updated_at DESC')
    .all(projectId) as RunRow[]
  return rows.map((row) => rowToRunSummary(row, computeStepCounts(loadRunSteps(row.id))))
}

/** Every run regardless of project — backs the global, top-level Automated Workflows pane/screen. */
export function listAllAutomatedWorkflowRuns(): AutomatedWorkflowRunSummary[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM automated_workflow_runs ORDER BY updated_at DESC')
    .all() as RunRow[]
  return rows.map((row) => rowToRunSummary(row, computeStepCounts(loadRunSteps(row.id))))
}

/**
 * Persists a generated spec. If `existingRunId` names a run whose steps are all still
 * `pending` (or has none yet), it's replaced in place — otherwise a new run is created,
 * so an in-progress plan is never clobbered by a regeneration. `projectId` is nullable — a
 * project-less run is a fully supported, self-contained Automated Workflow (see
 * src/roadmap-new/). `scheduledRunId`/`specSortOrder` tag a run spawned by a schedule firing
 * (see scheduler-engine.ts), used only for that path's retry-idempotency guard — omitted for
 * every other (user-driven) creation path.
 */
export function saveAutomatedWorkflowRunFromSpec(
  projectId: string | null,
  spec: AutomatedWorkflowSpec,
  model: string | null,
  existingRunId?: string | null,
  scheduleTag?: { scheduledRunId: string; specSortOrder: number },
): AutomatedWorkflowRunDetail {
  const db = getDatabase()
  const now = Date.now()
  const assumptionsJson = JSON.stringify(spec.assumptions ?? [])

  // Note: db.transaction(fn)()'s return value isn't reliable across this codebase's
  // sql.js test shim, so the resulting id is captured via this outer variable instead.
  let runId = ''
  db.transaction(() => {
    const existing = existingRunId
      ? db.prepare('SELECT * FROM automated_workflow_runs WHERE id = ? AND project_id IS ?').get(existingRunId, projectId) as RunRow | undefined
      : undefined
    const existingSteps = existing ? loadRunSteps(existing.id) : []
    const canReplaceInPlace = existing && existingSteps.every((s) => s.status === 'pending')

    if (existing && canReplaceInPlace) {
      db.prepare(`
        UPDATE automated_workflow_runs
        SET title = ?, goal_summary = ?, assumptions_json = ?, model = ?, status = 'pending',
            current_step_id = NULL, error = NULL, updated_at = ?
        WHERE id = ?
      `).run(spec.title, spec.goalSummary, assumptionsJson, model, now, existing.id)
      db.prepare('DELETE FROM automated_workflow_run_steps WHERE run_id = ?').run(existing.id)
      insertSteps(existing.id, spec.steps)
      runId = existing.id
      return
    }

    const id = randomUUID()
    db.prepare(`
      INSERT INTO automated_workflow_runs
        (id, project_id, title, goal_summary, assumptions_json, model, status, confirmation_mode, created_at, updated_at, scheduled_run_id, spec_sort_order)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', 'gated', ?, ?, ?, ?)
    `).run(id, projectId, spec.title, spec.goalSummary, assumptionsJson, model, now, now, scheduleTag?.scheduledRunId ?? null, scheduleTag?.specSortOrder ?? null)
    insertSteps(id, spec.steps)
    runId = id
  })()

  const detail = getAutomatedWorkflowRun(runId)
  if (!detail) throw new Error('Failed to save workflow run')
  return detail
}

/** Looks up a run already spawned for a given schedule firing + attached-spec position — the
 *  retry-idempotency guard scheduler-engine.ts uses so a retried scheduled_runs row doesn't
 *  re-execute a workflow spec that already completed under an earlier attempt of the same run. */
export function findAutomatedWorkflowRunByScheduleTag(scheduledRunId: string, specSortOrder: number): AutomatedWorkflowRunDetail | null {
  const row = getDatabase()
    .prepare('SELECT id FROM automated_workflow_runs WHERE scheduled_run_id = ? AND spec_sort_order = ?')
    .get(scheduledRunId, specSortOrder) as { id: string } | undefined
  return row ? getAutomatedWorkflowRun(row.id) : null
}

/**
 * Manual CRUD status update — used directly until the Phase B executor (automated-workflow-executor.ts)
 * lands and takes over driving `running`/`awaiting_confirmation` transitions itself. Recomputes the
 * parent run's status as a pure function of its steps, same as the old manual-click-through design did.
 */
export function updateAutomatedWorkflowRunStepStatus(
  runId: string,
  stepDbId: string,
  status: AutomatedWorkflowStepStatus,
): AutomatedWorkflowRunDetail | null {
  const db = getDatabase()
  const stepRow = db.prepare('SELECT * FROM automated_workflow_run_steps WHERE id = ? AND run_id = ?')
    .get(stepDbId, runId) as StepRow | undefined
  if (!stepRow) return null

  const now = Date.now()
  db.transaction(() => {
    const isTerminal = status === 'done' || status === 'failed' || status === 'skipped' || status === 'cancelled'
    const nextStartedAt = status === 'pending'
      ? null
      : !stepRow.started_at
        ? now
        : stepRow.started_at
    const nextCompletedAt = isTerminal ? now : status === 'pending' ? null : stepRow.completed_at

    db.prepare(`
      UPDATE automated_workflow_run_steps
      SET status = ?, started_at = ?, completed_at = ?
      WHERE id = ?
    `).run(status, nextStartedAt, nextCompletedAt, stepDbId)

    const steps = loadRunSteps(runId)
    const anyFailed = steps.some((s) => s.status === 'failed')
    const allDone = steps.length > 0 && steps.every((s) => s.status === 'done' || s.status === 'skipped')
    const runStatus: AutomatedWorkflowRunStatus = anyFailed ? 'failed' : allDone ? 'done' : 'pending'
    db.prepare(`
      UPDATE automated_workflow_runs
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(runStatus, now, runId)
  })()

  return getAutomatedWorkflowRun(runId)
}

export function discardAutomatedWorkflowRun(runId: string): boolean {
  const db = getDatabase()
  const row = db.prepare('SELECT id FROM automated_workflow_runs WHERE id = ?').get(runId) as { id: string } | undefined
  if (!row) return false
  // No ON DELETE CASCADE — run_id is a plain TEXT column, not a FOREIGN KEY (see migration 67's
  // comment: a REFERENCES clause here breaks the backfill INSERT on upgrade paths where the
  // referenced table doesn't exist yet) — so steps are deleted explicitly instead.
  db.transaction(() => {
    db.prepare('DELETE FROM automated_workflow_run_steps WHERE run_id = ?').run(runId)
    db.prepare('DELETE FROM automated_workflow_runs WHERE id = ?').run(runId)
  })()
  return true
}

export function registerAutomatedWorkflowRunHandlers(): void {
  safeHandle('automated-workflow-runs:save-spec', (_event, projectId: string | null, spec: AutomatedWorkflowSpec, model: string | null, existingRunId?: string | null) =>
    saveAutomatedWorkflowRunFromSpec(projectId, spec, model, existingRunId))

  safeHandle('automated-workflow-runs:list', (_event, projectId: string | null) => listAutomatedWorkflowRuns(projectId))

  safeHandle('automated-workflow-runs:list-all', () => listAllAutomatedWorkflowRuns())

  safeHandle('automated-workflow-runs:get', (_event, runId: string) => getAutomatedWorkflowRun(runId))

  safeHandle('automated-workflow-runs:update-step-status', (_event, runId: string, stepDbId: string, status: AutomatedWorkflowStepStatus) =>
    updateAutomatedWorkflowRunStepStatus(runId, stepDbId, status))

  safeHandle('automated-workflow-runs:discard', (_event, runId: string) => discardAutomatedWorkflowRun(runId))
}
