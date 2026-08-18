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
  AutomatedWorkflowStep,
  AutomatedWorkflowStepKind,
  AutomatedWorkflowStepStatus,
  AutomatedWorkflowTemplateDetail,
  AutomatedWorkflowTemplateSummary,
  WorkflowArtifactBinding,
  WorkflowArtifactBindingRecord,
  WorkflowDeliverableDefinition,
  WorkflowManagedStepState,
  WorkflowPublishAction,
  WorkflowPublishDestination,
  WorkflowPublishPreview,
  WorkflowReviewRecord,
  WorkflowReviewSource,
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
  template_id: string | null
}

interface TemplateRow {
  id: string
  project_id: string | null
  title: string
  goal_summary: string
  assumptions_json: string
  steps_json: string
  model: string | null
  source_run_id: string | null
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
  kind: AutomatedWorkflowStepKind | null
  input_bindings_json: string
  deliverables_json: string
  review_source_json: string | null
  publish_destination_json: string | null
  include_project_instructions: number
}

function parseJsonArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function parseJsonValue<T>(json: string | null, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}

function mapBindingRow(row: Record<string, unknown>): WorkflowArtifactBindingRecord {
  return {
    id: String(row.id), runId: String(row.run_id), stepDbId: String(row.step_id),
    stepAttempt: Number(row.step_attempt), bindingName: String(row.binding_name),
    direction: String(row.direction) as WorkflowArtifactBindingRecord['direction'],
    artifactId: String(row.artifact_id), artifactVersionId: String(row.artifact_version_id),
    sourceStepDbId: row.source_step_id == null ? null : String(row.source_step_id),
    staleAt: row.stale_at == null ? null : Number(row.stale_at), createdAt: Number(row.created_at),
  }
}

function mapReviewRow(row: Record<string, unknown>): WorkflowReviewRecord {
  return {
    id: String(row.id), runId: String(row.run_id), stepDbId: String(row.step_id),
    artifactVersionId: String(row.artifact_version_id),
    decision: String(row.decision) as WorkflowReviewRecord['decision'],
    reviewedByClient: String(row.reviewed_by_client) as WorkflowReviewRecord['reviewedByClient'],
    reviewedAt: Number(row.reviewed_at),
    supersededAt: row.superseded_at == null ? null : Number(row.superseded_at),
  }
}

function mapPreviewRow(row: Record<string, unknown>): WorkflowPublishPreview {
  return {
    id: String(row.id), runId: String(row.run_id), stepDbId: String(row.step_id),
    artifactVersionId: String(row.artifact_version_id), projectSourceId: String(row.project_source_id),
    relativePath: String(row.relative_path),
    destinationChecksum: row.destination_checksum == null ? null : String(row.destination_checksum),
    diffText: String(row.diff_text), createdAt: Number(row.created_at),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    invalidatedAt: row.invalidated_at == null ? null : Number(row.invalidated_at),
  }
}

function mapActionRow(row: Record<string, unknown>): WorkflowPublishAction {
  return {
    id: String(row.id), previewId: String(row.preview_id), idempotencyKey: String(row.idempotency_key),
    status: String(row.status) as WorkflowPublishAction['status'],
    approvedByClient: String(row.approved_by_client) as WorkflowPublishAction['approvedByClient'],
    approvedAt: Number(row.approved_at), startedAt: row.started_at == null ? null : Number(row.started_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
    resultChecksum: row.result_checksum == null ? null : String(row.result_checksum),
    error: row.error == null ? null : String(row.error),
  }
}

function loadManagedStepState(step: AutomatedWorkflowRunStep): WorkflowManagedStepState | undefined {
  if (!step.kind) return undefined
  const db = getDatabase()
  const bindings = (db.prepare(`SELECT * FROM automated_workflow_step_artifacts
    WHERE run_id = ? AND step_id = ? ORDER BY created_at, id`).all(step.runId, step.dbId) as Record<string, unknown>[])
    .map(mapBindingRow)
  const currentBinding = [...bindings].reverse().find((binding) =>
    binding.stepAttempt === step.attempt && binding.staleAt === null &&
    (binding.direction === 'output' || step.kind === 'review' || step.kind === 'publish'))
  const versionRow = currentBinding
    ? db.prepare(`SELECT av.id, av.artifact_id, av.version_number, av.title, av.created_at,
        af.relative_path, af.media_type, af.size_bytes, af.checksum
      FROM artifact_versions av JOIN artifact_files af ON af.version_id = av.id
      WHERE av.id = ? ORDER BY CASE af.role WHEN 'primary' THEN 0 ELSE 1 END, af.relative_path LIMIT 1`)
      .get(currentBinding.artifactVersionId) as Record<string, unknown> | undefined
    : undefined
  const latestReviewRow = db.prepare(`SELECT * FROM automated_workflow_reviews
    WHERE run_id = ? AND step_id = ? ORDER BY reviewed_at DESC LIMIT 1`).get(step.runId, step.dbId) as Record<string, unknown> | undefined
  const previewRow = db.prepare(`SELECT * FROM automated_workflow_publish_previews
    WHERE run_id = ? AND step_id = ? ORDER BY created_at DESC LIMIT 1`).get(step.runId, step.dbId) as Record<string, unknown> | undefined
  const actionRow = previewRow
    ? db.prepare('SELECT * FROM automated_workflow_publish_actions WHERE preview_id = ? ORDER BY approved_at DESC LIMIT 1')
      .get(String(previewRow.id)) as Record<string, unknown> | undefined
    : undefined
  return {
    isManaged: true,
    isStale: bindings.some((binding) => binding.stepAttempt === step.attempt && binding.staleAt !== null),
    currentVersion: versionRow ? {
      id: String(versionRow.id), artifactId: String(versionRow.artifact_id),
      versionNumber: Number(versionRow.version_number), title: String(versionRow.title),
      primaryPath: String(versionRow.relative_path), mediaType: String(versionRow.media_type),
      sizeBytes: Number(versionRow.size_bytes ?? 0), checksum: versionRow.checksum == null ? null : String(versionRow.checksum),
      createdAt: Number(versionRow.created_at),
    } : null,
    bindings,
    latestReview: latestReviewRow ? mapReviewRow(latestReviewRow) : null,
    publishPreview: previewRow ? mapPreviewRow(previewRow) : null,
    publishAction: actionRow ? mapActionRow(actionRow) : null,
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
    kind: row.kind ?? undefined,
    inputBindings: parseJsonValue<WorkflowArtifactBinding[]>(row.input_bindings_json, []),
    deliverables: parseJsonValue<WorkflowDeliverableDefinition[]>(row.deliverables_json, []),
    reviewSource: parseJsonValue<WorkflowReviewSource | undefined>(row.review_source_json, undefined),
    publishDestination: parseJsonValue<WorkflowPublishDestination | undefined>(row.publish_destination_json, undefined),
    includeProjectInstructions: row.include_project_instructions === 1,
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
    templateId: row.template_id,
  }
}

function rowToTemplateSummary(row: TemplateRow, stepCount: number): AutomatedWorkflowTemplateSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    goalSummary: row.goal_summary,
    model: row.model,
    stepCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseTemplateSteps(json: string): AutomatedWorkflowStep[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as AutomatedWorkflowStep[]) : []
  } catch {
    return []
  }
}

function loadRunSteps(runId: string): AutomatedWorkflowRunStep[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM automated_workflow_run_steps WHERE run_id = ? ORDER BY step_index ASC')
    .all(runId) as StepRow[]
  return rows.map(rowToRunStep).map((step) => ({ ...step, managed: loadManagedStepState(step) }))
}

function insertSteps(runId: string, steps: AutomatedWorkflowSpec['steps']): void {
  const db = getDatabase()
  const insert = db.prepare(`
    INSERT INTO automated_workflow_run_steps (
      id, run_id, step_index, step_key, title, summary, agent_id, agent_name, model,
      prompt, expected_output, depends_on_step_ids_json, status, attempt, output, started_at, completed_at,
      kind, input_bindings_json, deliverables_json, review_source_json, publish_destination_json,
      include_project_instructions
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', NULL, NULL, ?, ?, ?, ?, ?, ?)
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
      step.kind ?? null,
      JSON.stringify(step.inputBindings ?? []),
      JSON.stringify(step.deliverables ?? []),
      step.reviewSource ? JSON.stringify(step.reviewSource) : null,
      step.publishDestination ? JSON.stringify(step.publishDestination) : null,
      step.includeProjectInstructions ? 1 : 0,
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

/** Upserts the reusable template row backing a run's spec — inside the caller's own transaction.
 *  Passing `existingTemplateId` updates that row in place (used both by the "keep chatting to
 *  refine" in-place-replace path, so refinement doesn't spawn a new template per regeneration,
 *  and by `runAutomatedWorkflowTemplateAgain` to keep the template's `source_run_id`/timestamps
 *  fresh); omitting it inserts a new template row. Returns the template id to stamp onto the run. */
function upsertAutomatedWorkflowTemplateFromSpec(
  db: ReturnType<typeof getDatabase>,
  projectId: string | null,
  spec: AutomatedWorkflowSpec,
  model: string | null,
  existingTemplateId?: string | null,
): string {
  const now = Date.now()
  const assumptionsJson = JSON.stringify(spec.assumptions ?? [])
  const stepsJson = JSON.stringify(spec.steps)

  if (existingTemplateId) {
    const updated = db.prepare(`
      UPDATE automated_workflow_templates
      SET title = ?, goal_summary = ?, assumptions_json = ?, steps_json = ?, model = ?, updated_at = ?
      WHERE id = ?
    `).run(spec.title, spec.goalSummary, assumptionsJson, stepsJson, model, now, existingTemplateId)
    if (updated.changes > 0) return existingTemplateId
  }

  const id = randomUUID()
  db.prepare(`
    INSERT INTO automated_workflow_templates
      (id, project_id, title, goal_summary, assumptions_json, steps_json, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, projectId, spec.title, spec.goalSummary, assumptionsJson, stepsJson, model, now, now)
  return id
}

export function getAutomatedWorkflowTemplate(templateId: string): AutomatedWorkflowTemplateDetail | null {
  const row = getDatabase()
    .prepare('SELECT * FROM automated_workflow_templates WHERE id = ?')
    .get(templateId) as TemplateRow | undefined
  if (!row) return null
  const steps = parseTemplateSteps(row.steps_json)
  return {
    ...rowToTemplateSummary(row, steps.length),
    assumptions: parseJsonArray(row.assumptions_json),
    steps,
  }
}

export function listAutomatedWorkflowTemplates(projectId: string | null): AutomatedWorkflowTemplateSummary[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM automated_workflow_templates WHERE project_id IS ? ORDER BY updated_at DESC')
    .all(projectId) as TemplateRow[]
  return rows.map((row) => rowToTemplateSummary(row, parseTemplateSteps(row.steps_json).length))
}

/** Deletes the template row only — never cascades to runs. A template is a passive spec cache;
 *  deleting it must not delete run history, matching this feature's whole premise of decoupling
 *  the two ("Run again" simply becomes unavailable for runs that pointed at it). */
export function discardAutomatedWorkflowTemplate(templateId: string): boolean {
  const db = getDatabase()
  const row = db.prepare('SELECT id FROM automated_workflow_templates WHERE id = ?').get(templateId) as { id: string } | undefined
  if (!row) return false
  db.prepare('DELETE FROM automated_workflow_templates WHERE id = ?').run(templateId)
  return true
}

/**
 * Persists a generated spec. If `existingRunId` names a run whose steps are all still
 * `pending` (or has none yet), it's replaced in place — otherwise a new run is created,
 * so an in-progress plan is never clobbered by a regeneration. `projectId` is nullable — a
 * project-less run is a fully supported, self-contained Automated Workflow (see
 * src/roadmap-new/). `scheduledRunId`/`specSortOrder` tag a run spawned by a schedule firing
 * (see scheduler-engine.ts), used only for that path's retry-idempotency guard — omitted for
 * every other (user-driven) creation path. Every call also upserts a reusable template row
 * (see `upsertAutomatedWorkflowTemplateFromSpec`) so a terminal run can later be repeated via
 * "Run again" without going back through the AI generator — `templateIdOverride` lets
 * `runAutomatedWorkflowTemplateAgain` stamp its own known template id directly instead of
 * upserting a template from a spec that was just read out of that same template.
 */
export function saveAutomatedWorkflowRunFromSpec(
  projectId: string | null,
  spec: AutomatedWorkflowSpec,
  model: string | null,
  existingRunId?: string | null,
  scheduleTag?: { scheduledRunId: string; specSortOrder: number },
  templateIdOverride?: string,
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
      const templateId = templateIdOverride
        ?? upsertAutomatedWorkflowTemplateFromSpec(db, projectId, spec, model, existing.template_id ?? undefined)
      db.prepare(`
        UPDATE automated_workflow_runs
        SET title = ?, goal_summary = ?, assumptions_json = ?, model = ?, status = 'pending',
            current_step_id = NULL, error = NULL, updated_at = ?, template_id = ?
        WHERE id = ?
      `).run(spec.title, spec.goalSummary, assumptionsJson, model, now, templateId, existing.id)
      db.prepare('DELETE FROM automated_workflow_run_steps WHERE run_id = ?').run(existing.id)
      insertSteps(existing.id, spec.steps)
      runId = existing.id
      return
    }

    const templateId = templateIdOverride
      ?? upsertAutomatedWorkflowTemplateFromSpec(db, projectId, spec, model, undefined)
    const id = randomUUID()
    db.prepare(`
      INSERT INTO automated_workflow_runs
        (id, project_id, title, goal_summary, assumptions_json, model, status, confirmation_mode, created_at, updated_at, scheduled_run_id, spec_sort_order, template_id)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', 'gated', ?, ?, ?, ?, ?)
    `).run(id, projectId, spec.title, spec.goalSummary, assumptionsJson, model, now, now, scheduleTag?.scheduledRunId ?? null, scheduleTag?.specSortOrder ?? null, templateId)
    insertSteps(id, spec.steps)
    runId = id
  })()

  const detail = getAutomatedWorkflowRun(runId)
  if (!detail) throw new Error('Failed to save workflow run')
  return detail
}

/** Creates a fresh `pending` run from a saved template's spec, bypassing the AI generator
 *  entirely — the "Run again" action on a terminal run. Always creates a brand-new run (never
 *  the in-place-replace branch, which is only for the in-progress-generation-refinement case). */
export function runAutomatedWorkflowTemplateAgain(templateId: string): AutomatedWorkflowRunDetail {
  const template = getAutomatedWorkflowTemplate(templateId)
  if (!template) throw new Error('Workflow template not found')
  const spec: AutomatedWorkflowSpec = {
    title: template.title,
    goalSummary: template.goalSummary,
    assumptions: template.assumptions,
    steps: template.steps,
  }
  return saveAutomatedWorkflowRunFromSpec(template.projectId, spec, template.model, null, undefined, template.id)
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

  safeHandle('automated-workflow-runs:run-again', (_event, templateId: string) => runAutomatedWorkflowTemplateAgain(templateId))

  safeHandle('automated-workflow-templates:list', (_event, projectId: string | null) => listAutomatedWorkflowTemplates(projectId))

  safeHandle('automated-workflow-templates:get', (_event, templateId: string) => getAutomatedWorkflowTemplate(templateId))

  safeHandle('automated-workflow-templates:delete', (_event, templateId: string) => discardAutomatedWorkflowTemplate(templateId))
}
