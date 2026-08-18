import Database from 'better-sqlite3'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: vi.fn(() => [{ webContents: { isDestroyed: () => false, send: vi.fn() }, isDestroyed: () => false }]) },
  Notification: class { show() {} },
  powerMonitor: { on: vi.fn() },
}))

vi.mock('../database', () => ({
  getDatabase: () => {
    if (!state.db) throw new Error('DB not initialized')
    return state.db
  },
}))

vi.mock('../safe-handle', () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    state.handlers.set(channel, handler)
  },
}))

vi.mock('../chat-handlers', () => ({
  dispatchChatSend: vi.fn().mockResolvedValue({ assistantMsgId: 'msg-test' }),
}))

vi.mock('../ws-server', () => ({ broadcastToMobile: vi.fn() }))
vi.mock('../logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

// ─── Imports after mocks ──────────────────────────────────────────────────

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { registerSchedulerHandlers } from '../scheduler-handlers'
import type { ScheduledTask, ScheduledRun } from '../../shared/types'

// ─── Helper ───────────────────────────────────────────────────────────────

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return await handler({} as Electron.IpcMainInvokeEvent, ...args) as T
}

async function invokeCreate(input: Record<string, unknown>): Promise<ScheduledTask> {
  const result = await invoke<{ task: ScheduledTask; warnings: string[] }>('scheduler:create', input)
  return result.task
}

function initDb() {
  state.db?.close()
  state.db = new Database(':memory:')
  initializeBaseSchema(state.db)
  runMigrations(state.db)
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('scheduler IPC handlers', () => {
  beforeEach(() => {
    initDb()
    state.handlers.clear()
    registerSchedulerHandlers()
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  it('scheduler:list returns empty array initially', async () => {
    const result = await invoke<ScheduledTask[]>('scheduler:list')
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(0)
  })

  it('scheduler:create creates a task', async () => {
    const task = await invokeCreate({
      name: 'My task',
      prompt: 'Do something daily',
      scheduleType: 'daily',
      localTime: '08:00',
      timezone: 'UTC',
    })
    expect(task.id).toBeTruthy()
    expect(task.name).toBe('My task')
    expect(task.enabled).toBe(true)
    expect(task.nextRunAt).not.toBeNull()
  })

  it('scheduler:create returns warnings for missing agent', async () => {
    const result = await invoke<{ task: ScheduledTask; warnings: string[] }>('scheduler:create', {
      name: 'Warned',
      prompt: 'X',
      scheduleType: 'daily',
      localTime: '09:00',
      timezone: 'UTC',
      agentId: 'no-such-agent',
    })
    expect(result.task).toBeDefined()
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/Agent/)
  })

  it('scheduler:create returns error for missing required fields', async () => {
    const result = await invoke<{ error: string }>('scheduler:create', { name: 'X' })
    expect(result.error).toMatch(/required/)
  })

  it('scheduler:get returns created task', async () => {
    const created = await invokeCreate({
      name: 'Get test',
      prompt: 'Do something',
      scheduleType: 'daily',
      localTime: '09:00',
      timezone: 'UTC',
    })
    const fetched = await invoke<ScheduledTask>('scheduler:get', created.id)
    expect(fetched.id).toBe(created.id)
  })

  it('scheduler:get returns null for unknown id', async () => {
    const result = await invoke<ScheduledTask | null>('scheduler:get', 'no-such-id')
    expect(result).toBeNull()
  })

  it('scheduler:update modifies task fields', async () => {
    const task = await invokeCreate({
      name: 'Original',
      prompt: 'Old prompt',
      scheduleType: 'daily',
      localTime: '09:00',
      timezone: 'UTC',
    })
    const result = await invoke<{ task: ScheduledTask; warnings: string[] }>('scheduler:update', task.id, { name: 'Updated', prompt: 'New prompt' })
    expect(result.task.name).toBe('Updated')
    expect(result.task.prompt).toBe('New prompt')
    expect(result.warnings).toHaveLength(0)
  })

  it('scheduler:delete removes the task', async () => {
    const task = await invokeCreate({
      name: 'To delete',
      prompt: 'Tmp',
      scheduleType: 'daily',
      localTime: '09:00',
      timezone: 'UTC',
    })
    const deleted = await invoke<boolean>('scheduler:delete', task.id)
    expect(deleted).toBe(true)
    const after = await invoke<ScheduledTask[]>('scheduler:list')
    expect(after.find((t) => t.id === task.id)).toBeUndefined()
  })

  it('scheduler:set-enabled toggles enabled state', async () => {
    const task = await invokeCreate({
      name: 'Togglable',
      prompt: 'X',
      scheduleType: 'daily',
      localTime: '09:00',
      timezone: 'UTC',
    })
    const disabled = await invoke<ScheduledTask>('scheduler:set-enabled', task.id, false)
    expect(disabled.enabled).toBe(false)
    const enabled = await invoke<ScheduledTask>('scheduler:set-enabled', task.id, true)
    expect(enabled.enabled).toBe(true)
  })

  it('scheduler:list-runs returns empty array for new task', async () => {
    const task = await invokeCreate({
      name: 'No runs',
      prompt: 'X',
      scheduleType: 'daily',
      localTime: '09:00',
      timezone: 'UTC',
    })
    const runs = await invoke<ScheduledRun[]>('scheduler:list-runs', task.id)
    expect(Array.isArray(runs)).toBe(true)
    expect(runs.length).toBe(0)
  })

  it('scheduler:run-now against a task with no prior run creates a run', async () => {
    const task = await invokeCreate({
      name: 'Run now test',
      prompt: 'Do this',
      scheduleType: 'daily',
      localTime: '09:00',
      timezone: 'UTC',
    })
    const run = await invoke<ScheduledRun>('scheduler:run-now', task.id)
    expect(run.taskId).toBe(task.id)
    expect(run.triggerSource).toBe('manual')
  })

  it('scheduler:run-now returns error for invalid id', async () => {
    const result = await invoke<{ error: string }>('scheduler:run-now', 'no-such-id')
    expect(result.error).toBeTruthy()
  })

  it('persists and updates the pre-approved tool policy', async () => {
    const task = await invokeCreate({
      name: 'Tooled task',
      prompt: 'Use the tools',
      scheduleType: 'daily',
      localTime: '09:00',
      timezone: 'UTC',
      toolPolicy: { preApproved: ['github__list_issues'] },
    })
    expect(task.toolPolicy.preApproved).toEqual(['github__list_issues'])

    const updated = await invoke<{ task: ScheduledTask }>('scheduler:update', task.id, {
      toolPolicy: { preApproved: ['github__list_issues', 'github__comment'] },
    })
    expect(updated.task.toolPolicy.preApproved).toEqual(['github__list_issues', 'github__comment'])
  })

  it('scheduler:resume-run returns error for invalid id', async () => {
    const result = await invoke<{ error: string }>('scheduler:resume-run', 'no-such-run')
    expect(result.error).toBeTruthy()
  })

  it('scheduler:resume-run rejects a run that is not awaiting approval', async () => {
    const task = await invokeCreate({
      name: 'Resume test',
      prompt: 'Do this',
      scheduleType: 'daily',
      localTime: '09:00',
      timezone: 'UTC',
    })
    const run = await invoke<ScheduledRun>('scheduler:run-now', task.id)
    const result = await invoke<{ error: string }>('scheduler:resume-run', run.id)
    expect(result.error).toMatch(/awaiting approval/)
  })
})
