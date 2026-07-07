import Database from 'better-sqlite3'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'
import type { ManualWorkflowSpec } from '../../shared/types'

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

function sampleSpec(overrides: Partial<ManualWorkflowSpec> = {}): ManualWorkflowSpec {
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

describe('manual workflow runs', () => {
  beforeEach(() => {
    safeHandlers.clear()
    vi.resetModules()
    db = createDatabase()
    seedProject()
  })

  afterEach(() => {
    db.close()
  })

  it('creates migration 62 tables and indexes', () => {
    const runColumns = (db.prepare('PRAGMA table_info(manual_workflow_runs)').all() as Array<{ name: string }>).map((c) => c.name)
    expect(runColumns).toEqual(expect.arrayContaining([
      'id', 'project_id', 'title', 'goal_summary', 'assumptions_json', 'model', 'status', 'created_at', 'updated_at',
    ]))
    const stepColumns = (db.prepare('PRAGMA table_info(manual_workflow_run_steps)').all() as Array<{ name: string }>).map((c) => c.name)
    expect(stepColumns).toEqual(expect.arrayContaining([
      'id', 'run_id', 'step_index', 'step_key', 'title', 'summary', 'agent_id', 'agent_name',
      'prompt', 'expected_output', 'depends_on_step_ids_json', 'status', 'started_at', 'completed_at',
    ]))
    const runIndexes = (db.prepare('PRAGMA index_list(manual_workflow_runs)').all() as Array<{ name: string }>).map((i) => i.name)
    expect(runIndexes).toContain('idx_manual_workflow_runs_project_updated')
    const stepIndexes = (db.prepare('PRAGMA index_list(manual_workflow_run_steps)').all() as Array<{ name: string }>).map((i) => i.name)
    expect(stepIndexes).toContain('idx_manual_workflow_run_steps_run_index')
  })

  it('saves a new run with steps in order and round-trips dependsOnStepIds/assumptions', async () => {
    const { saveManualWorkflowRunFromSpec } = await import('../manual-workflow-runs')
    const detail = saveManualWorkflowRunFromSpec('proj-1', sampleSpec(), 'gpt-5.5', null)

    expect(detail.title).toBe('Ship the feature')
    expect(detail.assumptions).toEqual(['Team has access to staging'])
    expect(detail.status).toBe('active')
    expect(detail.steps).toHaveLength(2)
    expect(detail.steps[0]).toEqual(expect.objectContaining({ id: 'step-1', stepIndex: 0, status: 'not_started' }))
    expect(detail.steps[1]).toEqual(expect.objectContaining({ id: 'step-2', stepIndex: 1, dependsOnStepIds: ['step-1'] }))
  })

  it('replaces an existing run in place when all its steps are still not_started', async () => {
    const { saveManualWorkflowRunFromSpec } = await import('../manual-workflow-runs')
    const first = saveManualWorkflowRunFromSpec('proj-1', sampleSpec(), null, null)

    const second = saveManualWorkflowRunFromSpec('proj-1', sampleSpec({ title: 'Revised plan', steps: [
      { id: 'step-1', title: 'Only step now', summary: '', prompt: 'Do it', expectedOutput: '' },
    ] }), null, first.id)

    expect(second.id).toBe(first.id)
    expect(second.title).toBe('Revised plan')
    expect(second.steps).toHaveLength(1)
    const stepCount = db.prepare('SELECT COUNT(*) AS count FROM manual_workflow_run_steps WHERE run_id = ?').get(first.id) as { count: number }
    expect(stepCount.count).toBe(1)
  })

  it('branches into a new run when the existing run has a step that progressed past not_started', async () => {
    const { saveManualWorkflowRunFromSpec, updateManualWorkflowRunStepStatus } = await import('../manual-workflow-runs')
    const first = saveManualWorkflowRunFromSpec('proj-1', sampleSpec(), null, null)
    updateManualWorkflowRunStepStatus(first.id, first.steps[0].dbId, 'started')

    const second = saveManualWorkflowRunFromSpec('proj-1', sampleSpec({ title: 'New attempt' }), null, first.id)

    expect(second.id).not.toBe(first.id)
    expect(second.title).toBe('New attempt')
    const originalStillExists = db.prepare('SELECT title FROM manual_workflow_runs WHERE id = ?').get(first.id) as { title: string } | undefined
    expect(originalStillExists?.title).toBe('Ship the feature')
  })

  it('lists runs for a project ordered by updated_at desc with correct step counts', async () => {
    const { saveManualWorkflowRunFromSpec, listManualWorkflowRuns, updateManualWorkflowRunStepStatus } = await import('../manual-workflow-runs')
    const older = saveManualWorkflowRunFromSpec('proj-1', sampleSpec({ title: 'Older run' }), null, null)
    db.prepare('UPDATE manual_workflow_runs SET updated_at = 1 WHERE id = ?').run(older.id)
    const newer = saveManualWorkflowRunFromSpec('proj-1', sampleSpec({ title: 'Newer run' }), null, null)
    db.prepare('UPDATE manual_workflow_runs SET updated_at = 2 WHERE id = ?').run(newer.id)
    updateManualWorkflowRunStepStatus(newer.id, newer.steps[0].dbId, 'done')

    const list = listManualWorkflowRuns('proj-1')

    expect(list.map((r) => r.title)).toEqual(['Newer run', 'Older run'])
    const newerSummary = list.find((r) => r.id === newer.id)!
    expect(newerSummary.stepCounts).toEqual({ total: 2, notStarted: 1, started: 0, done: 1 })
  })

  it('gets a run with ordered steps, and returns null for an unknown id', async () => {
    const { saveManualWorkflowRunFromSpec, getManualWorkflowRun } = await import('../manual-workflow-runs')
    const created = saveManualWorkflowRunFromSpec('proj-1', sampleSpec(), null, null)

    const fetched = getManualWorkflowRun(created.id)
    expect(fetched?.steps.map((s) => s.id)).toEqual(['step-1', 'step-2'])
    expect(getManualWorkflowRun('no-such-run')).toBeNull()
  })

  describe('updateManualWorkflowRunStepStatus', () => {
    it('sets started_at on first transition into started without clobbering it on a later call', async () => {
      const { saveManualWorkflowRunFromSpec, updateManualWorkflowRunStepStatus } = await import('../manual-workflow-runs')
      const created = saveManualWorkflowRunFromSpec('proj-1', sampleSpec(), null, null)
      const stepId = created.steps[0].dbId

      const first = updateManualWorkflowRunStepStatus(created.id, stepId, 'started')
      const firstStartedAt = first!.steps[0].startedAt
      expect(firstStartedAt).toEqual(expect.any(Number))

      const second = updateManualWorkflowRunStepStatus(created.id, stepId, 'started')
      expect(second!.steps[0].startedAt).toBe(firstStartedAt)
    })

    it('sets completed_at on transition to done and auto-completes the run once all steps are done', async () => {
      const { saveManualWorkflowRunFromSpec, updateManualWorkflowRunStepStatus } = await import('../manual-workflow-runs')
      const created = saveManualWorkflowRunFromSpec('proj-1', sampleSpec(), null, null)

      const afterFirst = updateManualWorkflowRunStepStatus(created.id, created.steps[0].dbId, 'done')
      expect(afterFirst!.status).toBe('active')

      const afterSecond = updateManualWorkflowRunStepStatus(created.id, created.steps[1].dbId, 'done')
      expect(afterSecond!.status).toBe('completed')
      expect(afterSecond!.steps[1].completedAt).toEqual(expect.any(Number))
    })

    it('reopening a done step on a completed run flips the run back to active and clears timestamps', async () => {
      const { saveManualWorkflowRunFromSpec, updateManualWorkflowRunStepStatus } = await import('../manual-workflow-runs')
      const created = saveManualWorkflowRunFromSpec('proj-1', sampleSpec(), null, null)
      updateManualWorkflowRunStepStatus(created.id, created.steps[0].dbId, 'done')
      const completed = updateManualWorkflowRunStepStatus(created.id, created.steps[1].dbId, 'done')
      expect(completed!.status).toBe('completed')

      const reopened = updateManualWorkflowRunStepStatus(created.id, created.steps[1].dbId, 'not_started')
      expect(reopened!.status).toBe('active')
      expect(reopened!.steps[1].startedAt).toBeNull()
      expect(reopened!.steps[1].completedAt).toBeNull()
    })

    it('returns null for an unknown step or run', async () => {
      const { saveManualWorkflowRunFromSpec, updateManualWorkflowRunStepStatus } = await import('../manual-workflow-runs')
      const created = saveManualWorkflowRunFromSpec('proj-1', sampleSpec(), null, null)

      expect(updateManualWorkflowRunStepStatus(created.id, 'no-such-step', 'done')).toBeNull()
      expect(updateManualWorkflowRunStepStatus('no-such-run', created.steps[0].dbId, 'done')).toBeNull()
    })
  })

  it('discards a run and cascades its steps, returning false for an unknown id', async () => {
    const { saveManualWorkflowRunFromSpec, discardManualWorkflowRun } = await import('../manual-workflow-runs')
    const created = saveManualWorkflowRunFromSpec('proj-1', sampleSpec(), null, null)

    expect(discardManualWorkflowRun(created.id)).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS count FROM manual_workflow_runs WHERE id = ?').get(created.id)).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM manual_workflow_run_steps WHERE run_id = ?').get(created.id)).toEqual({ count: 0 })
    expect(discardManualWorkflowRun('no-such-run')).toBe(false)
  })

  it('registers all 5 IPC handlers and they behave correctly end to end', async () => {
    const { registerManualWorkflowRunHandlers } = await import('../manual-workflow-runs')
    registerManualWorkflowRunHandlers()

    const saved = invoke<{ id: string; steps: Array<{ dbId: string }> }>(
      'manual-workflow-runs:save-spec', 'proj-1', sampleSpec(), 'gpt-5.5', null,
    )
    expect(saved.id).toEqual(expect.any(String))

    const list = invoke<Array<{ id: string }>>('manual-workflow-runs:list', 'proj-1')
    expect(list).toEqual([expect.objectContaining({ id: saved.id })])

    const fetched = invoke<{ id: string } | null>('manual-workflow-runs:get', saved.id)
    expect(fetched?.id).toBe(saved.id)

    const updated = invoke<{ status: string } | null>(
      'manual-workflow-runs:update-step-status', saved.id, saved.steps[0].dbId, 'started',
    )
    expect(updated?.status).toBe('active')

    expect(invoke<boolean>('manual-workflow-runs:discard', saved.id)).toBe(true)
    expect(invoke<{ id: string } | null>('manual-workflow-runs:get', saved.id)).toBeNull()
  })
})
