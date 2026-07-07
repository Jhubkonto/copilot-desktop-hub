import { randomUUID } from 'crypto'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import type {
  ManualWorkflowRunDetail,
  ManualWorkflowRunStatus,
  ManualWorkflowRunStep,
  ManualWorkflowRunSummary,
  ManualWorkflowSpec,
  ManualWorkflowStepStatus,
} from '../shared/types'

interface RunRow {
  id: string
  project_id: string
  title: string
  goal_summary: string
  assumptions_json: string
  model: string | null
  status: ManualWorkflowRunStatus
  created_at: number
  updated_at: number
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
  prompt: string
  expected_output: string
  depends_on_step_ids_json: string
  status: ManualWorkflowStepStatus
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

function rowToRunStep(row: StepRow): ManualWorkflowRunStep {
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
    prompt: row.prompt,
    expectedOutput: row.expected_output,
    dependsOnStepIds: dependsOnStepIds.length > 0 ? dependsOnStepIds : undefined,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

function computeStepCounts(steps: ManualWorkflowRunStep[]): ManualWorkflowRunSummary['stepCounts'] {
  return {
    total: steps.length,
    notStarted: steps.filter((s) => s.status === 'not_started').length,
    started: steps.filter((s) => s.status === 'started').length,
    done: steps.filter((s) => s.status === 'done').length,
  }
}

function rowToRunSummary(row: RunRow, stepCounts: ManualWorkflowRunSummary['stepCounts']): ManualWorkflowRunSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    goalSummary: row.goal_summary,
    model: row.model,
    status: row.status,
    stepCounts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function loadRunSteps(runId: string): ManualWorkflowRunStep[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM manual_workflow_run_steps WHERE run_id = ? ORDER BY step_index ASC')
    .all(runId) as StepRow[]
  return rows.map(rowToRunStep)
}

function insertSteps(runId: string, steps: ManualWorkflowSpec['steps']): void {
  const db = getDatabase()
  const insert = db.prepare(`
    INSERT INTO manual_workflow_run_steps (
      id, run_id, step_index, step_key, title, summary, agent_id, agent_name,
      prompt, expected_output, depends_on_step_ids_json, status, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_started', NULL, NULL)
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
      step.prompt,
      step.expectedOutput,
      JSON.stringify(step.dependsOnStepIds ?? []),
    )
  })
}

export function getManualWorkflowRun(runId: string): ManualWorkflowRunDetail | null {
  const row = getDatabase()
    .prepare('SELECT * FROM manual_workflow_runs WHERE id = ?')
    .get(runId) as RunRow | undefined
  if (!row) return null
  const steps = loadRunSteps(runId)
  return {
    ...rowToRunSummary(row, computeStepCounts(steps)),
    assumptions: parseJsonArray(row.assumptions_json),
    steps,
  }
}

export function listManualWorkflowRuns(projectId: string): ManualWorkflowRunSummary[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM manual_workflow_runs WHERE project_id = ? ORDER BY updated_at DESC')
    .all(projectId) as RunRow[]
  return rows.map((row) => rowToRunSummary(row, computeStepCounts(loadRunSteps(row.id))))
}

/**
 * Persists a generated spec. If `existingRunId` names a run whose steps are all still
 * `not_started` (or has none yet), it's replaced in place — otherwise a new run is created,
 * so an in-progress plan is never clobbered by a regeneration.
 */
export function saveManualWorkflowRunFromSpec(
  projectId: string,
  spec: ManualWorkflowSpec,
  model: string | null,
  existingRunId?: string | null,
): ManualWorkflowRunDetail {
  const db = getDatabase()
  const now = Date.now()
  const assumptionsJson = JSON.stringify(spec.assumptions ?? [])

  // Note: db.transaction(fn)()'s return value isn't reliable across this codebase's
  // sql.js test shim, so the resulting id is captured via this outer variable instead.
  let runId = ''
  db.transaction(() => {
    const existing = existingRunId
      ? db.prepare('SELECT * FROM manual_workflow_runs WHERE id = ? AND project_id = ?').get(existingRunId, projectId) as RunRow | undefined
      : undefined
    const existingSteps = existing ? loadRunSteps(existing.id) : []
    const canReplaceInPlace = existing && existingSteps.every((s) => s.status === 'not_started')

    if (existing && canReplaceInPlace) {
      db.prepare(`
        UPDATE manual_workflow_runs
        SET title = ?, goal_summary = ?, assumptions_json = ?, model = ?, status = 'active', updated_at = ?
        WHERE id = ?
      `).run(spec.title, spec.goalSummary, assumptionsJson, model, now, existing.id)
      db.prepare('DELETE FROM manual_workflow_run_steps WHERE run_id = ?').run(existing.id)
      insertSteps(existing.id, spec.steps)
      runId = existing.id
      return
    }

    const id = randomUUID()
    db.prepare(`
      INSERT INTO manual_workflow_runs (id, project_id, title, goal_summary, assumptions_json, model, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, projectId, spec.title, spec.goalSummary, assumptionsJson, model, now, now)
    insertSteps(id, spec.steps)
    runId = id
  })()

  const detail = getManualWorkflowRun(runId)
  if (!detail) throw new Error('Failed to save workflow run')
  return detail
}

export function updateManualWorkflowRunStepStatus(
  runId: string,
  stepDbId: string,
  status: ManualWorkflowStepStatus,
): ManualWorkflowRunDetail | null {
  const db = getDatabase()
  const stepRow = db.prepare('SELECT * FROM manual_workflow_run_steps WHERE id = ? AND run_id = ?')
    .get(stepDbId, runId) as StepRow | undefined
  if (!stepRow) return null

  const now = Date.now()
  db.transaction(() => {
    const nextStartedAt = status === 'not_started'
      ? null
      : status === 'started' && !stepRow.started_at
        ? now
        : stepRow.started_at
    const nextCompletedAt = status === 'done'
      ? now
      : status === 'not_started'
        ? null
        : stepRow.completed_at

    db.prepare(`
      UPDATE manual_workflow_run_steps
      SET status = ?, started_at = ?, completed_at = ?
      WHERE id = ?
    `).run(status, nextStartedAt, nextCompletedAt, stepDbId)

    const steps = loadRunSteps(runId)
    const allDone = steps.length > 0 && steps.every((s) => s.status === 'done')
    db.prepare(`
      UPDATE manual_workflow_runs
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(allDone ? 'completed' : 'active', now, runId)
  })()

  return getManualWorkflowRun(runId)
}

export function discardManualWorkflowRun(runId: string): boolean {
  const db = getDatabase()
  const row = db.prepare('SELECT id FROM manual_workflow_runs WHERE id = ?').get(runId) as { id: string } | undefined
  if (!row) return false
  db.prepare('DELETE FROM manual_workflow_runs WHERE id = ?').run(runId)
  return true
}

export function registerManualWorkflowRunHandlers(): void {
  safeHandle('manual-workflow-runs:save-spec', (_event, projectId: string, spec: ManualWorkflowSpec, model: string | null, existingRunId?: string | null) =>
    saveManualWorkflowRunFromSpec(projectId, spec, model, existingRunId))

  safeHandle('manual-workflow-runs:list', (_event, projectId: string) => listManualWorkflowRuns(projectId))

  safeHandle('manual-workflow-runs:get', (_event, runId: string) => getManualWorkflowRun(runId))

  safeHandle('manual-workflow-runs:update-step-status', (_event, runId: string, stepDbId: string, status: ManualWorkflowStepStatus) =>
    updateManualWorkflowRunStepStatus(runId, stepDbId, status))

  safeHandle('manual-workflow-runs:discard', (_event, runId: string) => discardManualWorkflowRun(runId))
}
