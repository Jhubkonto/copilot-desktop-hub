import Database from 'better-sqlite3'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Hoisted mocks (must run before any imports) ───────────────────────────

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  dispatchResult: { assistantMsgId: 'msg-1' } as { assistantMsgId: string } | null,
}))

const fakeWebContents = { isDestroyed: () => false, send: vi.fn() }
const fakeWindow = { webContents: fakeWebContents, isDestroyed: () => false }

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: vi.fn(() => [fakeWindow]) },
  Notification: class { show() {} },
  powerMonitor: { on: vi.fn() },
}))

vi.mock('../database', () => ({
  getDatabase: () => {
    if (!state.db) throw new Error('DB not initialized')
    return state.db
  },
}))

vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))

vi.mock('../chat-handlers', () => ({
  dispatchChatSend: vi.fn().mockImplementation(() => Promise.resolve(state.dispatchResult)),
}))

vi.mock('../ws-server', () => ({ broadcastToMobile: vi.fn() }))
vi.mock('../logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../fcm-sender', () => ({ sendSchedulerRunNotification: vi.fn().mockResolvedValue(undefined) }))

const workflowMocks = vi.hoisted(() => ({
  saveSpecMock: vi.fn(),
  findByTagMock: vi.fn(),
  startRunMock: vi.fn(),
  retryStepMock: vi.fn(),
  setModeMock: vi.fn(),
}))

vi.mock('../automated-workflow-runs', () => ({
  saveAutomatedWorkflowRunFromSpec: workflowMocks.saveSpecMock,
  findAutomatedWorkflowRunByScheduleTag: workflowMocks.findByTagMock,
}))

vi.mock('../automated-workflow-executor', () => ({
  startAutomatedWorkflowRun: workflowMocks.startRunMock,
  retryAutomatedWorkflowStep: workflowMocks.retryStepMock,
  setAutomatedWorkflowConfirmationMode: workflowMocks.setModeMock,
}))

// ─── Imports after mocks ──────────────────────────────────────────────────

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import {
  SchedulerEngine,
  dbCreateTask,
  dbGetTask,
  dbListTasks,
  dbDeleteTask,
  dbSetTaskEnabled,
  dbListRuns,
  dbSetScheduledTaskWorkflows,
} from '../scheduler-engine'
import type { ScheduledTaskCreateInput, AutomatedWorkflowRunDetail } from '../../shared/types'

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<ScheduledTaskCreateInput> = {}): ScheduledTaskCreateInput {
  return {
    name: 'Test task',
    prompt: 'Do something',
    scheduleType: 'daily',
    localTime: '09:00',
    timezone: 'UTC',
    ...overrides,
  }
}

function initDb() {
  state.db?.close()
  state.db = new Database(':memory:')
  initializeBaseSchema(state.db)
  runMigrations(state.db)
}

function makeRunDetail(overrides: Partial<AutomatedWorkflowRunDetail> = {}): AutomatedWorkflowRunDetail {
  return {
    id: 'run-x',
    projectId: null,
    title: 'Spec',
    goalSummary: '',
    model: null,
    status: 'pending',
    confirmationMode: 'gated',
    currentStepId: null,
    lastError: null,
    stepCounts: { total: 1, pending: 1, running: 0, awaitingConfirmation: 0, done: 0, failed: 0, skipped: 0 },
    createdAt: 0,
    updatedAt: 0,
    assumptions: [],
    steps: [],
    ...overrides,
  }
}

beforeEach(() => {
  workflowMocks.saveSpecMock.mockReset()
  workflowMocks.findByTagMock.mockReset()
  workflowMocks.startRunMock.mockReset()
  workflowMocks.retryStepMock.mockReset()
  workflowMocks.setModeMock.mockReset()
})

// ─── Tests ────────────────────────────────────────────────────────────────

describe('SchedulerEngine — DB helpers', () => {
  beforeEach(() => initDb())
  afterEach(() => { state.db?.close(); state.db = null })

  it('creates a task and sets nextRunAt', () => {
    const task = dbCreateTask(makeInput())
    expect(task.id).toBeTruthy()
    expect(task.name).toBe('Test task')
    expect(task.enabled).toBe(true)
    expect(task.nextRunAt).not.toBeNull()
  })

  it('getTask returns null for unknown id', () => {
    expect(dbGetTask('no-such-id')).toBeNull()
  })

  it('listTasks returns all tasks', () => {
    dbCreateTask(makeInput({ name: 'A' }))
    dbCreateTask(makeInput({ name: 'B' }))
    expect(dbListTasks().length).toBe(2)
  })

  it('listTasks(onlyEnabled=true) filters disabled tasks', () => {
    const t1 = dbCreateTask(makeInput({ name: 'A' }))
    dbCreateTask(makeInput({ name: 'B' }))
    dbSetTaskEnabled(t1.id, false)
    const active = dbListTasks(true)
    expect(active.every((t) => t.enabled)).toBe(true)
    expect(active.length).toBe(1)
  })

  it('deleteTask removes the task', () => {
    const task = dbCreateTask(makeInput())
    expect(dbGetTask(task.id)).not.toBeNull()
    dbDeleteTask(task.id)
    expect(dbGetTask(task.id)).toBeNull()
  })

  it('setEnabled disables task and clears nextRunAt', () => {
    const task = dbCreateTask(makeInput())
    const disabled = dbSetTaskEnabled(task.id, false)
    expect(disabled!.enabled).toBe(false)
    expect(disabled!.nextRunAt).toBeNull()
  })

  it('setEnabled re-enables task and recalculates nextRunAt', () => {
    const task = dbCreateTask(makeInput())
    dbSetTaskEnabled(task.id, false)
    const enabled = dbSetTaskEnabled(task.id, true)
    expect(enabled!.enabled).toBe(true)
    expect(enabled!.nextRunAt).not.toBeNull()
  })
})

describe('SchedulerEngine — lifecycle', () => {
  let engine: SchedulerEngine

  beforeEach(() => {
    initDb()
    engine = new SchedulerEngine()
  })

  afterEach(() => {
    engine.stop()
    state.db?.close()
    state.db = null
    vi.clearAllTimers()
  })

  it('start() does not throw', () => {
    expect(() => engine.start()).not.toThrow()
  })

  it('start() is idempotent', () => {
    engine.start()
    expect(() => engine.start()).not.toThrow()
  })

  it('scheduleTask() registers timer for enabled tasks', () => {
    vi.useFakeTimers()
    const task = dbCreateTask(makeInput())
    expect(() => engine.scheduleTask(task)).not.toThrow()
    vi.useRealTimers()
  })

  it('unscheduleTask() removes timer without error', () => {
    vi.useFakeTimers()
    const task = dbCreateTask(makeInput())
    engine.scheduleTask(task)
    expect(() => engine.unscheduleTask(task.id)).not.toThrow()
    vi.useRealTimers()
  })

  it('unscheduleTask() on unknown id does not throw', () => {
    expect(() => engine.unscheduleTask('no-such-id')).not.toThrow()
  })
})

describe('SchedulerEngine — triggerRun', () => {
  let engine: SchedulerEngine

  beforeEach(() => {
    initDb()
    engine = new SchedulerEngine()
  })

  afterEach(() => {
    engine.stop()
    state.db?.close()
    state.db = null
  })

  it('manual run creates a run record', async () => {
    const task = dbCreateTask(makeInput())
    const run = await engine.triggerRun(task.id, 'manual')
    expect(run.taskId).toBe(task.id)
    expect(run.triggerSource).toBe('manual')
    expect(dbListRuns(task.id).length).toBeGreaterThan(0)
  })

  it('manual run does not shift nextRunAt', async () => {
    const task = dbCreateTask(makeInput())
    const nextBefore = task.nextRunAt
    await engine.triggerRun(task.id, 'manual')
    const updated = dbGetTask(task.id)!
    // Manual run does not recalculate nextRunAt (only scheduled runs do)
    expect(updated.nextRunAt).toBe(nextBefore)
  })

  it('throws for unknown task id', async () => {
    await expect(engine.triggerRun('no-such-id', 'manual')).rejects.toThrow('not found')
  })

  it('prevents duplicate active runs', async () => {
    const task = dbCreateTask(makeInput())
    const p1 = engine.triggerRun(task.id, 'manual')
    await expect(engine.triggerRun(task.id, 'manual')).rejects.toThrow('active run')
    await p1.catch(() => {})
  })

  it('one-time task is disabled after scheduled run', async () => {
    const task = dbCreateTask(makeInput({ scheduleType: 'one-time', localTime: '00:00' }))
    // Force nextRunAt to past so it's immediately eligible
    state.db!.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?').run(Date.now() - 1000, task.id)
    await engine.triggerRun(task.id, 'scheduled', Date.now() - 1000)
    const updated = dbGetTask(task.id)!
    expect(updated.enabled).toBe(false)
  })

  it('dedicated conversation created on first run and reused on subsequent runs', async () => {
    const task = dbCreateTask(makeInput())
    expect(dbGetTask(task.id)!.conversationId).toBeNull()
    await engine.triggerRun(task.id, 'manual')
    const convId = dbGetTask(task.id)!.conversationId
    expect(convId).toBeTruthy()
    await engine.triggerRun(task.id, 'manual')
    expect(dbGetTask(task.id)!.conversationId).toBe(convId)
  })
})

describe('SchedulerEngine — executeWorkflowRun (target_type: automated_workflow)', () => {
  let engine: SchedulerEngine

  beforeEach(() => {
    initDb()
    engine = new SchedulerEngine()
  })

  afterEach(() => {
    engine.stop()
    state.db?.close()
    state.db = null
  })

  function makeWorkflowTask(specCount: number, projectId: string | null = 'proj-1') {
    const task = dbCreateTask(makeInput({ name: 'Workflow schedule', targetType: 'automated_workflow', projectId }))
    dbSetScheduledTaskWorkflows(
      task.id,
      Array.from({ length: specCount }, (_, i) => ({
        workflowSpecJson: JSON.stringify({ title: `Spec ${i}`, goalSummary: '', assumptions: [], steps: [] }),
        sourceRunId: null,
        confirmationMode: 'auto' as const,
      })),
    )
    return task
  }

  it('spawns and sequentially completes multiple attached workflow specs, scoped to the task project', async () => {
    const task = makeWorkflowTask(2)
    workflowMocks.findByTagMock.mockReturnValue(null)
    workflowMocks.saveSpecMock
      .mockReturnValueOnce(makeRunDetail({ id: 'run-A', projectId: 'proj-1', status: 'pending' }))
      .mockReturnValueOnce(makeRunDetail({ id: 'run-B', projectId: 'proj-1', status: 'pending' }))
    workflowMocks.startRunMock
      .mockResolvedValueOnce(makeRunDetail({ id: 'run-A', projectId: 'proj-1', status: 'done' }))
      .mockResolvedValueOnce(makeRunDetail({ id: 'run-B', projectId: 'proj-1', status: 'done' }))

    const run = await engine.triggerRun(task.id, 'manual')

    expect(run.status).toBe('success')
    expect(run.workflowRunIds).toEqual(['run-A', 'run-B'])
    expect(workflowMocks.saveSpecMock).toHaveBeenCalledTimes(2)
    expect(workflowMocks.saveSpecMock.mock.calls[0][0]).toBe('proj-1')
    expect(workflowMocks.saveSpecMock.mock.calls[0][3]).toBeNull()
    expect(workflowMocks.saveSpecMock.mock.calls[0][4]).toEqual({ scheduledRunId: run.id, specSortOrder: 0 })
    expect(workflowMocks.saveSpecMock.mock.calls[1][4]).toEqual({ scheduledRunId: run.id, specSortOrder: 1 })
  })

  it('stops the batch and surfaces approval_required when a gated spec pauses at awaiting_confirmation', async () => {
    const task = makeWorkflowTask(2)
    workflowMocks.findByTagMock.mockReturnValue(null)
    workflowMocks.saveSpecMock
      .mockReturnValueOnce(makeRunDetail({ id: 'run-A', status: 'pending' }))
    workflowMocks.startRunMock
      .mockResolvedValueOnce(makeRunDetail({ id: 'run-A', status: 'awaiting_confirmation' }))

    const run = await engine.triggerRun(task.id, 'manual')

    expect(run.status).toBe('approval_required')
    expect(run.workflowRunIds).toEqual(['run-A'])
    // Second spec is never started — the batch stops at the first non-done run.
    expect(workflowMocks.saveSpecMock).toHaveBeenCalledTimes(1)
    expect(workflowMocks.startRunMock).toHaveBeenCalledTimes(1)
  })

  it('retries a failed spec on the next in-process attempt without re-running an already-completed one', async () => {
    vi.useFakeTimers()
    const task = makeWorkflowTask(2)

    workflowMocks.findByTagMock
      .mockReturnValueOnce(null) // spec 0, attempt 1: not yet created
      .mockReturnValueOnce(null) // spec 1, attempt 1: not yet created
      .mockReturnValueOnce(makeRunDetail({ id: 'run-A', status: 'done' })) // spec 0, attempt 2: already done
      .mockReturnValueOnce(makeRunDetail({
        id: 'run-B',
        status: 'failed',
        lastError: 'boom',
        steps: [{
          id: 'solo', dbId: 'step-B', runId: 'run-B', stepIndex: 0, title: 'Solo', summary: '',
          prompt: '', expectedOutput: '', status: 'failed', attempt: 0, output: '', error: 'boom',
          conversationId: null, startedAt: null, completedAt: null,
        }],
      })) // spec 1, attempt 2: still the failed run

    workflowMocks.saveSpecMock
      .mockReturnValueOnce(makeRunDetail({ id: 'run-A', status: 'pending' }))
      .mockReturnValueOnce(makeRunDetail({ id: 'run-B', status: 'pending' }))

    workflowMocks.startRunMock
      .mockResolvedValueOnce(makeRunDetail({ id: 'run-A', status: 'done' })) // spec 0, attempt 1
      .mockResolvedValueOnce(makeRunDetail({ id: 'run-B', status: 'failed', lastError: 'boom' })) // spec 1, attempt 1 -> throws

    workflowMocks.retryStepMock
      .mockResolvedValueOnce(makeRunDetail({ id: 'run-B', status: 'done' })) // spec 1, attempt 2 -> retried to done

    const runPromise = engine.triggerRun(task.id, 'manual')
    await vi.advanceTimersByTimeAsync(30_000)
    const run = await runPromise

    expect(run.status).toBe('success')
    expect(run.workflowRunIds).toEqual(['run-A', 'run-B'])
    // Only created once each across both in-process attempts — the idempotency guard (via
    // findAutomatedWorkflowRunByScheduleTag) prevented spec 0 from being recreated/restarted and
    // spec 1 from being recreated (it was retried in place instead).
    expect(workflowMocks.saveSpecMock).toHaveBeenCalledTimes(2)
    expect(workflowMocks.retryStepMock).toHaveBeenCalledWith('run-B', 'step-B')
    vi.useRealTimers()
  })

  it('fails the schedule run when no specs are attached', async () => {
    const task = dbCreateTask(makeInput({ targetType: 'automated_workflow' }))
    vi.useFakeTimers()
    const runPromise = engine.triggerRun(task.id, 'manual')
    await vi.advanceTimersByTimeAsync(60_000)
    const run = await runPromise
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/no automated workflow attached/i)
    vi.useRealTimers()
  })
})
