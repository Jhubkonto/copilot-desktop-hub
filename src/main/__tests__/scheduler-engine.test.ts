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
} from '../scheduler-engine'
import type { ScheduledTaskCreateInput } from '../../shared/types'

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
