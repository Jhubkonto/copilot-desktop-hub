import Database from 'better-sqlite3'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'
import type { AutomatedWorkflowSpec } from '../../shared/types'

const { safeHandlers } = vi.hoisted(() => ({
  safeHandlers: new Map<string, (...args: unknown[]) => unknown>(),
}))

vi.mock('electron', () => ({
  app: { isPackaged: false },
}))

vi.mock('../safe-handle', () => ({
  safeHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    safeHandlers.set(channel, handler)
  }),
}))

let db: Database.Database

vi.mock('../database', () => ({
  getDatabase: () => db,
}))

function createDatabase() {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  initializeBaseSchema(database)
  runMigrations(database)
  return database
}

function invoke<T>(channel: string, ...args: unknown[]): T {
  const handler = safeHandlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return handler({}, ...args) as T
}

function seedProject(id = 'proj-1') {
  db.prepare("INSERT INTO projects (id, name, color, created_at, updated_at) VALUES (?, 'Test project', 'blue', 1, 1)").run(id)
}

function sampleSpec(overrides: Partial<AutomatedWorkflowSpec> = {}): AutomatedWorkflowSpec {
  return {
    title: 'Ship the feature',
    goalSummary: 'Get the feature shipped end to end',
    assumptions: ['Team has access to staging'],
    steps: [
      { id: 'step-1', title: 'Plan the work', summary: 'Break down the task', prompt: 'Plan it', expectedOutput: 'A plan' },
      { id: 'step-2', title: 'Implement', summary: 'Write the code', prompt: 'Implement it', expectedOutput: 'Working code', dependsOnStepIds: ['step-1'] },
    ],
    ...overrides,
  }
}

describe('automated workflow runs', () => {
  beforeEach(() => {
    safeHandlers.clear()
    vi.resetModules()
    db = createDatabase()
    seedProject()
  })

  afterEach(() => {
    db.close()
  })

  it('creates migration 67 tables and indexes', () => {
    const runColumns = (db.prepare('PRAGMA table_info(automated_workflow_runs)').all() as Array<{ name: string }>).map((c) => c.name)
    expect(runColumns).toEqual(expect.arrayContaining([
      'id', 'project_id', 'title', 'goal_summary', 'assumptions_json', 'model', 'status',
      'confirmation_mode', 'current_step_id', 'error', 'created_at', 'updated_at', 'started_at', 'completed_at',
    ]))
    const stepColumns = (db.prepare('PRAGMA table_info(automated_workflow_run_steps)').all() as Array<{ name: string }>).map((c) => c.name)
    expect(stepColumns).toEqual(expect.arrayContaining([
      'id', 'run_id', 'step_index', 'step_key', 'title', 'summary', 'agent_id', 'agent_name',
      'prompt', 'expected_output', 'depends_on_step_ids_json', 'status', 'attempt', 'output', 'error',
      'conversation_id', 'started_at', 'completed_at',
    ]))
    const runIndexes = (db.prepare('PRAGMA index_list(automated_workflow_runs)').all() as Array<{ name: string }>).map((i) => i.name)
    expect(runIndexes).toContain('idx_automated_workflow_runs_project_updated')
    const stepIndexes = (db.prepare('PRAGMA index_list(automated_workflow_run_steps)').all() as Array<{ name: string }>).map((i) => i.name)
    expect(stepIndexes).toContain('idx_automated_workflow_run_steps_run_index')
  })

  it('saves a new run with steps in order and round-trips dependsOnStepIds/assumptions', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const detail = saveAutomatedWorkflowRunFromSpec('proj-1', sampleSpec(), 'gpt-5.5', null)

    expect(detail.title).toBe('Ship the feature')
    expect(detail.assumptions).toEqual(['Team has access to staging'])
    expect(detail.status).toBe('pending')
    expect(detail.confirmationMode).toBe('gated')
    expect(detail.steps).toHaveLength(2)
    expect(detail.steps[0]).toEqual(expect.objectContaining({ id: 'step-1', stepIndex: 0, status: 'pending', attempt: 0, output: '' }))
    expect(detail.steps[1]).toEqual(expect.objectContaining({ id: 'step-2', stepIndex: 1, dependsOnStepIds: ['step-1'] }))
  })

  it('replaces an existing run in place when all its steps are still pending', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const first = saveAutomatedWorkflowRunFromSpec('proj-1', sampleSpec(), null, null)

    const second = saveAutomatedWorkflowRunFromSpec('proj-1', sampleSpec({ title: 'Revised plan', steps: [
      { id: 'step-1', title: 'Only step now', summary: '', prompt: 'Do it', expectedOutput: '' },
    ] }), null, first.id)

    expect(second.id).toBe(first.id)
    expect(second.title).toBe('Revised plan')
    expect(second.steps).toHaveLength(1)
    const stepCount = db.prepare('SELECT COUNT(*) AS count FROM automated_workflow_run_steps WHERE run_id = ?').get(first.id) as { count: number }
    expect(stepCount.count).toBe(1)
  })

  it('branches into a new run when the existing run has a step that progressed past pending', async () => {
    const { saveAutomatedWorkflowRunFromSpec, updateAutomatedWorkflowRunStepStatus } = await import('../automated-workflow-runs')
    const first = saveAutomatedWorkflowRunFromSpec('proj-1', sampleSpec(), null, null)
    updateAutomatedWorkflowRunStepStatus(first.id, first.steps[0].dbId, 'done')

    const second = saveAutomatedWorkflowRunFromSpec('proj-1', sampleSpec({ title: 'New attempt' }), null, first.id)

    expect(second.id).not.toBe(first.id)
    expect(second.title).toBe('New attempt')
    const originalStillExists = db.prepare('SELECT title FROM automated_workflow_runs WHERE id = ?').get(first.id) as { title: string } | undefined
    expect(originalStillExists?.title).toBe('Ship the feature')
  })

  it('lists runs for a project ordered by updated_at desc with correct step counts', async () => {
    const { saveAutomatedWorkflowRunFromSpec, listAutomatedWorkflowRuns, updateAutomatedWorkflowRunStepStatus } = await import('../automated-workflow-runs')
    const older = saveAutomatedWorkflowRunFromSpec('proj-1', sampleSpec({ title: 'Older run' }), null, null)
    db.prepare('UPDATE automated_workflow_runs SET updated_at = 1 WHERE id = ?').run(older.id)
    const newer = saveAutomatedWorkflowRunFromSpec('proj-1', sampleSpec({ title: 'Newer run' }), null, null)
    db.prepare('UPDATE automated_workflow_runs SET updated_at = 2 WHERE id = ?').run(newer.id)
    updateAutomatedWorkflowRunStepStatus(newer.id, newer.steps[0].dbId, 'done')

    const list = listAutomatedWorkflowRuns('proj-1')

    expect(list.map((r) => r.title)).toEqual(['Newer run', 'Older run'])
    const newerSummary = list.find((r) => r.id === newer.id)!
    expect(newerSummary.stepCounts).toEqual({ total: 2, pending: 1, running: 0, awaitingConfirmation: 0, done: 1, failed: 0, skipped: 0 })
  })

  it('gets a run with ordered steps, and returns null for an unknown id', async () => {
    const { saveAutomatedWorkflowRunFromSpec, getAutomatedWorkflowRun } = await import('../automated-workflow-runs')
    const created = saveAutomatedWorkflowRunFromSpec('proj-1', sampleSpec(), null, null)

    const fetched = getAutomatedWorkflowRun(created.id)
    expect(fetched?.steps.map((s) => s.id)).toEqual(['step-1', 'step-2'])
    expect(getAutomatedWorkflowRun('no-such-run')).toBeNull()
  })

  describe('updateAutomatedWorkflowRunStepStatus', () => {
    it('sets started_at on first transition into a non-pending status without clobbering it on a later call', async () => {
      const { saveAutomatedWorkflowRunFromSpec, updateAutomatedWorkflowRunStepStatus } = await import('../automated-workflow-runs')
      const created = saveAutomatedWorkflowRunFromSpec('proj-1', sampleSpec(), null, null)
      const stepId = created.steps[0].dbId

      const first = updateAutomatedWorkflowRunStepStatus(created.id, stepId, 'running')
      const firstStartedAt = first!.steps[0].startedAt
      expect(firstStartedAt).toEqual(expect.any(Number))

      const second = updateAutomatedWorkflowRunStepStatus(created.id, stepId, 'running')
      expect(second!.steps[0].startedAt).toBe(firstStartedAt)
    })

    it('sets completed_at on transition to done and auto-completes the run once all steps are done', async () => {
      const { saveAutomatedWorkflowRunFromSpec, updateAutomatedWorkflowRunStepStatus } = await import('../automated-workflow-runs')
      const created = saveAutomatedWorkflowRunFromSpec('proj-1', sampleSpec(), null, null)

      const afterFirst = updateAutomatedWorkflowRunStepStatus(created.id, created.steps[0].dbId, 'done')
      expect(afterFirst!.status).toBe('pending')

      const afterSecond = updateAutomatedWorkflowRunStepStatus(created.id, created.steps[1].dbId, 'done')
      expect(afterSecond!.status).toBe('done')
      expect(afterSecond!.steps[1].completedAt).toEqual(expect.any(Number))
    })

    it('marking a step failed flips the run to failed', async () => {
      const { saveAutomatedWorkflowRunFromSpec, updateAutomatedWorkflowRunStepStatus } = await import('../automated-workflow-runs')
      const created = saveAutomatedWorkflowRunFromSpec('proj-1', sampleSpec(), null, null)

      const afterFail = updateAutomatedWorkflowRunStepStatus(created.id, created.steps[0].dbId, 'failed')
      expect(afterFail!.status).toBe('failed')
      expect(afterFail!.steps[0].completedAt).toEqual(expect.any(Number))
    })

    it('reopening a done step on a completed run flips the run back to pending and clears timestamps', async () => {
      const { saveAutomatedWorkflowRunFromSpec, updateAutomatedWorkflowRunStepStatus } = await import('../automated-workflow-runs')
      const created = saveAutomatedWorkflowRunFromSpec('proj-1', sampleSpec(), null, null)
      updateAutomatedWorkflowRunStepStatus(created.id, created.steps[0].dbId, 'done')
      const completed = updateAutomatedWorkflowRunStepStatus(created.id, created.steps[1].dbId, 'done')
      expect(completed!.status).toBe('done')

      const reopened = updateAutomatedWorkflowRunStepStatus(created.id, created.steps[1].dbId, 'pending')
      expect(reopened!.status).toBe('pending')
      expect(reopened!.steps[1].startedAt).toBeNull()
      expect(reopened!.steps[1].completedAt).toBeNull()
    })

    it('returns null for an unknown step or run', async () => {
      const { saveAutomatedWorkflowRunFromSpec, updateAutomatedWorkflowRunStepStatus } = await import('../automated-workflow-runs')
      const created = saveAutomatedWorkflowRunFromSpec('proj-1', sampleSpec(), null, null)

      expect(updateAutomatedWorkflowRunStepStatus(created.id, 'no-such-step', 'done')).toBeNull()
      expect(updateAutomatedWorkflowRunStepStatus('no-such-run', created.steps[0].dbId, 'done')).toBeNull()
    })
  })

  it('discards a run and cascades its steps, returning false for an unknown id', async () => {
    const { saveAutomatedWorkflowRunFromSpec, discardAutomatedWorkflowRun } = await import('../automated-workflow-runs')
    const created = saveAutomatedWorkflowRunFromSpec('proj-1', sampleSpec(), null, null)

    expect(discardAutomatedWorkflowRun(created.id)).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS count FROM automated_workflow_runs WHERE id = ?').get(created.id)).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM automated_workflow_run_steps WHERE run_id = ?').get(created.id)).toEqual({ count: 0 })
    expect(discardAutomatedWorkflowRun('no-such-run')).toBe(false)
  })

  it('registers all 5 IPC handlers and they behave correctly end to end', async () => {
    const { registerAutomatedWorkflowRunHandlers } = await import('../automated-workflow-runs')
    registerAutomatedWorkflowRunHandlers()

    const saved = invoke<{ id: string; steps: Array<{ dbId: string }> }>(
      'automated-workflow-runs:save-spec', 'proj-1', sampleSpec(), 'gpt-5.5', null,
    )
    expect(saved.id).toEqual(expect.any(String))

    const list = invoke<Array<{ id: string }>>('automated-workflow-runs:list', 'proj-1')
    expect(list).toEqual([expect.objectContaining({ id: saved.id })])

    const fetched = invoke<{ id: string } | null>('automated-workflow-runs:get', saved.id)
    expect(fetched?.id).toBe(saved.id)

    const updated = invoke<{ status: string } | null>(
      'automated-workflow-runs:update-step-status', saved.id, saved.steps[0].dbId, 'running',
    )
    expect(updated?.status).toBe('pending')

    expect(invoke<boolean>('automated-workflow-runs:discard', saved.id)).toBe(true)
    expect(invoke<{ id: string } | null>('automated-workflow-runs:get', saved.id)).toBeNull()
  })
})
