import Database from 'better-sqlite3'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'
import type { AutomatedWorkflowSpec, AutomatedWorkflowStep } from '../../shared/types'

const { runAgentTurnMock } = vi.hoisted(() => ({
  runAgentTurnMock: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('../safe-handle', () => ({
  safeHandle: vi.fn(),
}))

vi.mock('../ws-server', () => ({
  broadcastToMobile: vi.fn(),
}))

vi.mock('../agent-turn-runner', () => ({
  runAgentTurn: runAgentTurnMock,
}))

vi.mock('../automated-workflow-generator', () => ({
  getAutomatedWorkflowGeneratorModel: () => 'gpt-5.5',
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

function seedProject(id = 'proj-1') {
  db.prepare("INSERT INTO projects (id, name, color, created_at, updated_at) VALUES (?, 'Test project', 'blue', 1, 1)").run(id)
}

function seedAgent(id: string, name: string) {
  db.prepare("INSERT INTO agents (id, config_json, created_at, updated_at) VALUES (?, ?, 1, 1)")
    .run(id, JSON.stringify({ name }))
}

function seedProjectAgent(projectId: string, agentId: string, isPrimary: boolean, sortOrder: number) {
  db.prepare('INSERT INTO project_agents (project_id, agent_id, is_primary, sort_order, added_at) VALUES (?, ?, ?, ?, 1)')
    .run(projectId, agentId, isPrimary ? 1 : 0, sortOrder)
}

function multiStepSpec(overrides: Partial<AutomatedWorkflowSpec> = {}): AutomatedWorkflowSpec {
  const steps: AutomatedWorkflowStep[] = [
    { id: 'plan', title: 'Plan', summary: '', prompt: 'Create a plan.', expectedOutput: 'Plan', agentId: 'agent-1', agentName: 'Planner' },
    { id: 'build', title: 'Build', summary: '', prompt: 'Implement the plan.', expectedOutput: 'Implementation', agentId: 'agent-1', agentName: 'Planner', dependsOnStepIds: ['plan'] },
  ]
  return {
    title: 'Ship feature',
    goalSummary: 'Prepare and ship a feature',
    assumptions: [],
    steps,
    ...overrides,
  }
}

beforeEach(async () => {
  // resetAllMocks (not clearAllMocks) — also clears queued mockResolvedValueOnce/mockRejectedValueOnce
  // implementations left over from a previous test, not just call history.
  vi.resetAllMocks()
  vi.resetModules()
  db = createDatabase()
  seedProject()
  seedAgent('agent-1', 'Planner')
  seedProjectAgent('proj-1', 'agent-1', true, 0)
})

afterEach(() => {
  db.close()
})

describe('automated-workflow-executor: pure helpers', () => {
  it('topologically orders dependency steps while preserving listed order for independent steps', async () => {
    const { orderWorkflowSteps } = await import('../automated-workflow-executor')
    const spec = multiStepSpec({
      steps: [
        { id: 'build', title: 'Build', summary: '', prompt: 'B', expectedOutput: '', dependsOnStepIds: ['plan'] },
        { id: 'plan', title: 'Plan', summary: '', prompt: 'P', expectedOutput: '' },
        { id: 'announce', title: 'Announce', summary: '', prompt: 'A', expectedOutput: '' },
        { id: 'verify', title: 'Verify', summary: '', prompt: 'V', expectedOutput: '', dependsOnStepIds: ['build'] },
      ],
    })
    const ordered = orderWorkflowSteps(spec.steps)
    expect(ordered.map((s) => s.id)).toEqual(['plan', 'announce', 'build', 'verify'])
  })

  it('rejects dependency cycles', async () => {
    const { orderWorkflowSteps } = await import('../automated-workflow-executor')
    expect(() => orderWorkflowSteps([
      { id: 'a', title: 'A', summary: '', prompt: 'A', expectedOutput: '', dependsOnStepIds: ['b'] },
      { id: 'b', title: 'B', summary: '', prompt: 'B', expectedOutput: '', dependsOnStepIds: ['a'] },
    ])).toThrow('dependency cycle')
  })

  it('weaves dependency outputs into a dependent step prompt', async () => {
    const { weaveStepPrompt } = await import('../automated-workflow-executor')
    const step = { id: 'build', prompt: 'Implement the plan.', dependsOnStepIds: ['plan'] }
    const prompt = weaveStepPrompt(step, new Map([['plan', { id: 'plan', title: 'Plan', output: 'Use approach A.' }]]))
    expect(prompt).toContain("## Context from step 'Plan'")
    expect(prompt).toContain('Use approach A.')
    expect(prompt).toContain('## Your task:')
    expect(prompt).toContain('Implement the plan.')
  })
})

describe('automated-workflow-executor: gated mode', () => {
  it('runs one step at a time, stopping at awaiting_confirmation until the user confirms', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const { startAutomatedWorkflowRun, confirmAutomatedWorkflowStep } = await import('../automated-workflow-executor')

    runAgentTurnMock.mockResolvedValueOnce('output:plan').mockResolvedValueOnce('output:build')

    const created = saveAutomatedWorkflowRunFromSpec('proj-1', multiStepSpec(), 'gpt-5.5', null)
    const afterStart = await startAutomatedWorkflowRun(created.id)

    expect(afterStart!.status).toBe('awaiting_confirmation')
    const planStep = afterStart!.steps.find((s) => s.id === 'plan')!
    expect(planStep.status).toBe('awaiting_confirmation')
    expect(planStep.output).toBe('output:plan')
    expect(planStep.conversationId).toEqual(expect.any(String))
    expect(afterStart!.steps.find((s) => s.id === 'build')!.status).toBe('pending')
    expect(runAgentTurnMock).toHaveBeenCalledTimes(1)

    const afterConfirm1 = await confirmAutomatedWorkflowStep(created.id, planStep.dbId)
    expect(afterConfirm1!.steps.find((s) => s.id === 'plan')!.status).toBe('done')
    expect(afterConfirm1!.status).toBe('awaiting_confirmation')
    expect(afterConfirm1!.steps.find((s) => s.id === 'build')!.status).toBe('awaiting_confirmation')
    expect(runAgentTurnMock).toHaveBeenCalledTimes(2)

    const buildPrompt = runAgentTurnMock.mock.calls[1][0].taskContent as string
    expect(buildPrompt).toContain("## Context from step 'Plan'")
    expect(buildPrompt).toContain('output:plan')

    const buildStep = afterConfirm1!.steps.find((s) => s.id === 'build')!
    const afterConfirm2 = await confirmAutomatedWorkflowStep(created.id, buildStep.dbId)
    expect(afterConfirm2!.status).toBe('done')
    expect(afterConfirm2!.steps.every((s) => s.status === 'done')).toBe(true)
  })

  it('allows editing output on confirm', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const { startAutomatedWorkflowRun, confirmAutomatedWorkflowStep } = await import('../automated-workflow-executor')
    runAgentTurnMock.mockResolvedValue('raw output')

    const created = saveAutomatedWorkflowRunFromSpec('proj-1', multiStepSpec({ steps: [multiStepSpec().steps[0]] }), null, null)
    const afterStart = await startAutomatedWorkflowRun(created.id)
    const step = afterStart!.steps[0]

    const afterConfirm = await confirmAutomatedWorkflowStep(created.id, step.dbId, 'edited output')
    expect(afterConfirm!.steps[0].output).toBe('edited output')
    expect(afterConfirm!.steps[0].status).toBe('done')
  })

  it('halts on step failure and leaves downstream steps pending', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const { startAutomatedWorkflowRun } = await import('../automated-workflow-executor')
    runAgentTurnMock.mockRejectedValueOnce(new Error('bad model'))

    const created = saveAutomatedWorkflowRunFromSpec('proj-1', multiStepSpec(), null, null)
    const afterStart = await startAutomatedWorkflowRun(created.id)

    expect(afterStart!.status).toBe('failed')
    expect(afterStart!.lastError).toBe('bad model')
    expect(afterStart!.steps.find((s) => s.id === 'plan')!.status).toBe('failed')
    expect(afterStart!.steps.find((s) => s.id === 'build')!.status).toBe('pending')
  })

  it('runs a step via a bare model (no skills) when no agent is available at all', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const { startAutomatedWorkflowRun } = await import('../automated-workflow-executor')
    db.prepare("INSERT INTO projects (id, name, color, created_at, updated_at) VALUES ('proj-2', 'No agents', 'blue', 1, 1)").run()
    runAgentTurnMock.mockResolvedValueOnce('model output')

    const spec = multiStepSpec({ steps: [{ id: 'solo', title: 'Solo', summary: '', prompt: 'Do it', expectedOutput: '' }] })
    const created = saveAutomatedWorkflowRunFromSpec('proj-2', spec, null, null)
    const afterStart = await startAutomatedWorkflowRun(created.id)

    expect(afterStart!.status).toBe('awaiting_confirmation')
    expect(afterStart!.steps[0].status).toBe('awaiting_confirmation')
    expect(afterStart!.steps[0].output).toBe('model output')
    expect(runAgentTurnMock).toHaveBeenCalledTimes(1)
    const callArgs = runAgentTurnMock.mock.calls[0][0]
    expect(callArgs.agentId).toBeUndefined()
    expect(callArgs.fallbackModel).toBe('gpt-5.5')
  })

  it('runs a project-less (null project) step in model-mode using the run-level model', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const { startAutomatedWorkflowRun } = await import('../automated-workflow-executor')
    runAgentTurnMock.mockResolvedValueOnce('model output')

    const spec = multiStepSpec({ steps: [{ id: 'solo', title: 'Solo', summary: '', prompt: 'Do it', expectedOutput: '' }] })
    const created = saveAutomatedWorkflowRunFromSpec(null, spec, 'run-level-model', null)
    expect(created.projectId).toBeNull()
    const afterStart = await startAutomatedWorkflowRun(created.id)

    expect(afterStart!.projectId).toBeNull()
    expect(afterStart!.steps[0].status).toBe('awaiting_confirmation')
    const callArgs = runAgentTurnMock.mock.calls[0][0]
    expect(callArgs.agentId).toBeUndefined()
    expect(callArgs.fallbackModel).toBe('run-level-model')
  })

  it('honors an explicit step-level model even when a primary agent is available for the project', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const { startAutomatedWorkflowRun } = await import('../automated-workflow-executor')
    runAgentTurnMock.mockResolvedValueOnce('model output')

    // proj-1 has agent-1 seeded as primary (see beforeEach), but this step explicitly opts into
    // a bare model, which must win over the primary-agent fallback.
    const spec = multiStepSpec({ steps: [{ id: 'solo', title: 'Solo', summary: '', prompt: 'Do it', expectedOutput: '', model: 'gpt-6-mega' }] })
    const created = saveAutomatedWorkflowRunFromSpec('proj-1', spec, null, null)
    const afterStart = await startAutomatedWorkflowRun(created.id)

    expect(afterStart!.steps[0].status).toBe('awaiting_confirmation')
    const callArgs = runAgentTurnMock.mock.calls[0][0]
    expect(callArgs.agentId).toBeUndefined()
    expect(callArgs.fallbackModel).toBe('gpt-6-mega')
  })

  it('still uses the explicit agent path (and that agent\'s skills) when a step names an agentId, unchanged from before', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const { startAutomatedWorkflowRun } = await import('../automated-workflow-executor')
    runAgentTurnMock.mockResolvedValueOnce('agent output')

    const created = saveAutomatedWorkflowRunFromSpec('proj-1', multiStepSpec({ steps: [multiStepSpec().steps[0]] }), null, null)
    const afterStart = await startAutomatedWorkflowRun(created.id)

    expect(afterStart!.steps[0].status).toBe('awaiting_confirmation')
    const callArgs = runAgentTurnMock.mock.calls[0][0]
    expect(callArgs.agentId).toBe('agent-1')
  })
})

describe('automated-workflow-executor: auto mode', () => {
  it('advances through all steps automatically with no confirm calls', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const { startAutomatedWorkflowRun, setAutomatedWorkflowConfirmationMode } = await import('../automated-workflow-executor')
    runAgentTurnMock.mockResolvedValueOnce('output:plan').mockResolvedValueOnce('output:build')

    const created = saveAutomatedWorkflowRunFromSpec('proj-1', multiStepSpec(), null, null)
    setAutomatedWorkflowConfirmationMode(created.id, 'auto')

    const result = await startAutomatedWorkflowRun(created.id)

    expect(result!.status).toBe('done')
    expect(result!.steps.every((s) => s.status === 'done')).toBe(true)
    expect(runAgentTurnMock).toHaveBeenCalledTimes(2)
  })

  it('still pauses on failure even in auto mode', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const { startAutomatedWorkflowRun, setAutomatedWorkflowConfirmationMode } = await import('../automated-workflow-executor')
    runAgentTurnMock.mockResolvedValueOnce('output:plan').mockRejectedValueOnce(new Error('build broke'))

    const created = saveAutomatedWorkflowRunFromSpec('proj-1', multiStepSpec(), null, null)
    setAutomatedWorkflowConfirmationMode(created.id, 'auto')
    const result = await startAutomatedWorkflowRun(created.id)

    expect(result!.status).toBe('failed')
    expect(result!.steps.find((s) => s.id === 'plan')!.status).toBe('done')
    expect(result!.steps.find((s) => s.id === 'build')!.status).toBe('failed')
  })
})

describe('automated-workflow-executor: retry / skip / abort', () => {
  it('retry resets the failed step and its downstream dependents, preserving earlier completed steps', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const { startAutomatedWorkflowRun, confirmAutomatedWorkflowStep, retryAutomatedWorkflowStep } = await import('../automated-workflow-executor')
    const spec = multiStepSpec({
      steps: [
        ...multiStepSpec().steps,
        { id: 'verify', title: 'Verify', summary: '', prompt: 'Verify it.', expectedOutput: '', agentId: 'agent-1', dependsOnStepIds: ['build'] },
      ],
    })
    runAgentTurnMock.mockResolvedValueOnce('output:plan').mockRejectedValueOnce(new Error('bad model'))

    const created = saveAutomatedWorkflowRunFromSpec('proj-1', spec, null, null)
    const afterStart = await startAutomatedWorkflowRun(created.id)
    const planStep = afterStart!.steps.find((s) => s.id === 'plan')!
    expect(planStep.status).toBe('awaiting_confirmation')

    const afterConfirmPlan = await confirmAutomatedWorkflowStep(created.id, planStep.dbId)
    const buildStep = afterConfirmPlan!.steps.find((s) => s.id === 'build')!
    expect(buildStep.status).toBe('failed')

    runAgentTurnMock.mockResolvedValueOnce('output:build-retry').mockResolvedValueOnce('output:verify')
    const afterRetry = await retryAutomatedWorkflowStep(created.id, buildStep.dbId)

    expect(afterRetry!.steps.find((s) => s.id === 'plan')).toEqual(expect.objectContaining({ status: 'done', output: 'output:plan', attempt: 0 }))
    expect(afterRetry!.steps.find((s) => s.id === 'build')).toEqual(expect.objectContaining({ attempt: 1 }))
    expect(afterRetry!.status).toBe('awaiting_confirmation')
  })

  it('skip marks the step skipped without resetting it, and downstream steps get a synthetic context block', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const { startAutomatedWorkflowRun, skipAutomatedWorkflowStep } = await import('../automated-workflow-executor')
    runAgentTurnMock.mockRejectedValueOnce(new Error('bad model'))

    const created = saveAutomatedWorkflowRunFromSpec('proj-1', multiStepSpec(), null, null)
    const afterStart = await startAutomatedWorkflowRun(created.id)
    const planStep = afterStart!.steps.find((s) => s.id === 'plan')!
    expect(planStep.status).toBe('failed')

    runAgentTurnMock.mockResolvedValueOnce('output:build')
    const afterSkip = await skipAutomatedWorkflowStep(created.id, planStep.dbId)

    expect(afterSkip!.steps.find((s) => s.id === 'plan')!.status).toBe('skipped')
    const buildPrompt = runAgentTurnMock.mock.calls[1][0].taskContent as string
    expect(buildPrompt).toContain('was skipped by the user')
  })

  it('abort cancels the run and discards a result that arrives after abort (race guard)', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const { startAutomatedWorkflowRun, abortAutomatedWorkflowRun } = await import('../automated-workflow-executor')

    let resolveAgentTurn!: (value: string) => void
    runAgentTurnMock.mockReturnValueOnce(new Promise<string>((resolve) => { resolveAgentTurn = resolve }))

    const created = saveAutomatedWorkflowRunFromSpec('proj-1', multiStepSpec({ steps: [multiStepSpec().steps[0]] }), null, null)
    const startPromise = startAutomatedWorkflowRun(created.id)

    // Let the executor get as far as marking the step 'running' before we abort.
    await vi.waitFor(() => {
      const run = db.prepare("SELECT status FROM automated_workflow_run_steps WHERE run_id = ?").get(created.id) as { status: string }
      expect(run.status).toBe('running')
    })

    const aborted = abortAutomatedWorkflowRun(created.id)
    expect(aborted!.status).toBe('cancelled')
    expect(aborted!.steps[0].status).toBe('cancelled')

    resolveAgentTurn('late output')
    const finalResult = await startPromise

    expect(finalResult!.status).toBe('cancelled')
    expect(finalResult!.steps[0].status).toBe('cancelled')
    expect(finalResult!.steps[0].output).toBe('')
  })
})

describe('automated-workflow-executor: crash recovery', () => {
  it('marks a step stuck in "running" as failed on startup sweep, with a clear explanation', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const { recoverStuckAutomatedWorkflowRuns } = await import('../automated-workflow-executor')

    const created = saveAutomatedWorkflowRunFromSpec('proj-1', multiStepSpec({ steps: [multiStepSpec().steps[0]] }), null, null)
    db.prepare("UPDATE automated_workflow_run_steps SET status = 'running' WHERE run_id = ?").run(created.id)
    db.prepare("UPDATE automated_workflow_runs SET status = 'running' WHERE id = ?").run(created.id)

    recoverStuckAutomatedWorkflowRuns()

    const { getAutomatedWorkflowRun } = await import('../automated-workflow-runs')
    const recovered = getAutomatedWorkflowRun(created.id)!
    expect(recovered.status).toBe('failed')
    expect(recovered.lastError).toMatch(/closed or restarted/i)
    expect(recovered.steps[0].status).toBe('failed')
    expect(recovered.steps[0].error).toMatch(/closed or restarted/i)
  })

  it('leaves non-running rows untouched', async () => {
    const { saveAutomatedWorkflowRunFromSpec, getAutomatedWorkflowRun } = await import('../automated-workflow-runs')
    const { recoverStuckAutomatedWorkflowRuns } = await import('../automated-workflow-executor')

    const created = saveAutomatedWorkflowRunFromSpec('proj-1', multiStepSpec({ steps: [multiStepSpec().steps[0]] }), null, null)
    recoverStuckAutomatedWorkflowRuns()

    const untouched = getAutomatedWorkflowRun(created.id)!
    expect(untouched.status).toBe('pending')
    expect(untouched.steps[0].status).toBe('pending')
  })

  it('recovers a schedule-spawned run (tagged with scheduled_run_id/spec_sort_order) identically to a manually-created one', async () => {
    // The startup sweep keys purely on status='running' with no special-casing for how the run
    // was created, so a schedule-spawned run should be recovered exactly like a manual one.
    const { saveAutomatedWorkflowRunFromSpec, getAutomatedWorkflowRun } = await import('../automated-workflow-runs')
    const { recoverStuckAutomatedWorkflowRuns } = await import('../automated-workflow-executor')

    const created = saveAutomatedWorkflowRunFromSpec(
      'proj-1',
      multiStepSpec({ steps: [multiStepSpec().steps[0]] }),
      null,
      null,
      { scheduledRunId: 'sched-run-1', specSortOrder: 0 },
    )
    db.prepare("UPDATE automated_workflow_run_steps SET status = 'running' WHERE run_id = ?").run(created.id)
    db.prepare("UPDATE automated_workflow_runs SET status = 'running' WHERE id = ?").run(created.id)

    recoverStuckAutomatedWorkflowRuns()

    const recovered = getAutomatedWorkflowRun(created.id)!
    expect(recovered.status).toBe('failed')
    expect(recovered.lastError).toMatch(/closed or restarted/i)
    expect(recovered.steps[0].status).toBe('failed')
    expect(recovered.steps[0].error).toMatch(/closed or restarted/i)

    const tagRow = db.prepare('SELECT scheduled_run_id, spec_sort_order FROM automated_workflow_runs WHERE id = ?')
      .get(created.id) as { scheduled_run_id: string | null; spec_sort_order: number | null }
    expect(tagRow.scheduled_run_id).toBe('sched-run-1')
    expect(tagRow.spec_sort_order).toBe(0)
  })
})
