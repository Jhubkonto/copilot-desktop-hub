import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Hoisted state ────────────────────────────────────────────────────────────

const state = vi.hoisted(() => {
  let commandHandler: ((command: string, data: Record<string, unknown>, reply: (event: unknown) => void) => void) | null = null
  const replies: unknown[] = []
  const tasks = [
    { id: 'task-1', name: 'Daily standup', prompt: 'Summarize', enabled: 1, agent_id: null, project_id: null, model: null, conversation_id: null, schedule_type: 'daily', local_time: '09:00', weekday: null, month_day: null, timezone: 'UTC', tool_policy_json: null, notification_pref: 'always', next_run_at: null, last_run_at: null, created_at: 1000, updated_at: 1000 },
  ]
  const scheduleTask = vi.fn()
  const unscheduleTask = vi.fn()
  const triggerRun = vi.fn().mockResolvedValue({ id: 'run-1', task_id: 'task-1', status: 'success' })

  return {
    get commandHandler() { return commandHandler },
    set commandHandler(h) { commandHandler = h },
    replies,
    tasks,
    scheduleTask,
    unscheduleTask,
    triggerRun,
  }
})

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))
vi.mock('../database', () => ({ getDatabase: vi.fn() }))
vi.mock('../providers', () => ({
  abortActiveStream: vi.fn(),
  PROVIDERS: [],
  isProviderConfigured: vi.fn(() => false),
  getOpenRouterModels: vi.fn().mockResolvedValue([]),
}))
vi.mock('../model-catalog', () => ({ getCachedCatalog: vi.fn(() => []) }))
vi.mock('../chat-handlers', () => ({ dispatchChatSend: vi.fn() }))
vi.mock('../cli-detection', () => ({ getCliModels: vi.fn(() => []) }))
vi.mock('../auth', () => ({ retrieveAuthMode: vi.fn(() => 'byok') }))
vi.mock('../android-handlers', () => ({
  getAndroidUpdateManifest: vi.fn(),
  getAndroidWorkspaceInfo: vi.fn(),
  computeSha256: vi.fn(),
}))
vi.mock('../build-handlers', () => ({ getWorkspaceInfo: vi.fn() }))
vi.mock('../cli-adapters/claude', () => ({ ClaudeAdapter: { isAvailable: vi.fn(() => false) } }))
vi.mock('../cli-adapters/codex', () => ({ CodexAdapter: { isAvailable: vi.fn(() => false) } }))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('../ws-server', () => ({
  startWsServer: vi.fn(),
  stopWsServer: vi.fn(),
  getWsStatus: vi.fn(() => ({ enabled: false })),
  getQrDataUrl: vi.fn(),
  regenerateToken: vi.fn(),
  setWsCommandHandler: vi.fn((handler) => { state.commandHandler = handler }),
}))

vi.mock('../fcm-sender', () => ({ sendSchedulerRunNotification: vi.fn().mockResolvedValue(undefined) }))

vi.mock('../scheduler-engine', () => ({
  dbListTasks: vi.fn(() => state.tasks),
  dbGetTask: vi.fn((id: string) => state.tasks.find((t) => t.id === id) ?? null),
  dbCreateTask: vi.fn((input: Record<string, unknown>) => ({ id: 'task-new', ...input, enabled: 1, created_at: Date.now(), updated_at: Date.now() })),
  dbUpdateTask: vi.fn((id: string, input: Record<string, unknown>) => {
    const task = state.tasks.find((t) => t.id === id)
    return task ? { ...task, ...input, updated_at: Date.now() } : null
  }),
  dbDeleteTask: vi.fn(),
  dbSetTaskEnabled: vi.fn((id: string, enabled: boolean) => {
    const task = state.tasks.find((t) => t.id === id)
    return task ? { ...task, enabled: enabled ? 1 : 0 } : null
  }),
  dbListRuns: vi.fn(() => []),
  schedulerEngine: {
    scheduleTask: state.scheduleTask,
    unscheduleTask: state.unscheduleTask,
    triggerRun: state.triggerRun,
  },
}))

// ─── Module under test ────────────────────────────────────────────────────────

import { registerWsHandlers } from '../ws-handlers'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendCommand(command: string, data: Record<string, unknown> = {}) {
  if (!state.commandHandler) throw new Error('WS command handler not registered')
  const reply = vi.fn((event: unknown) => state.replies.push(event))
  state.commandHandler(command, data, reply)
  return reply
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('scheduler WS commands', () => {
  beforeEach(() => {
    state.replies.length = 0
    state.scheduleTask.mockClear()
    state.unscheduleTask.mockClear()
    state.triggerRun.mockClear()
    registerWsHandlers()
  })

  it('scheduler:list replies with all tasks', () => {
    const reply = sendCommand('scheduler:list')
    expect(reply).toHaveBeenCalledWith({
      event: 'scheduler:list',
      data: { tasks: state.tasks },
    })
  })

  it('scheduler:get replies with a specific task', () => {
    const reply = sendCommand('scheduler:get', { id: 'task-1' })
    expect(reply).toHaveBeenCalledWith({
      event: 'scheduler:get',
      data: { task: state.tasks[0] },
    })
  })

  it('scheduler:get returns null for unknown id', () => {
    const reply = sendCommand('scheduler:get', { id: 'no-such-task' })
    expect(reply).toHaveBeenCalledWith({
      event: 'scheduler:get',
      data: { task: null },
    })
  })

  it('scheduler:get ignores request when id is missing', () => {
    const reply = sendCommand('scheduler:get', {})
    expect(reply).not.toHaveBeenCalled()
  })

  it('scheduler:create creates a task and schedules it', () => {
    const reply = sendCommand('scheduler:create', {
      name: 'New task',
      prompt: 'Do something',
      scheduleType: 'daily',
      localTime: '10:00',
      timezone: 'UTC',
    })
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      event: 'scheduler:task-updated',
      data: expect.objectContaining({ name: 'New task' }),
    }))
    expect(state.scheduleTask).toHaveBeenCalledTimes(1)
  })

  it('scheduler:create ignores incomplete payload', () => {
    const reply = sendCommand('scheduler:create', { name: 'incomplete' })
    expect(reply).not.toHaveBeenCalled()
    expect(state.scheduleTask).not.toHaveBeenCalled()
  })

  it('scheduler:update updates and reschedules enabled task', () => {
    const reply = sendCommand('scheduler:update', {
      id: 'task-1',
      input: { name: 'Updated' },
    })
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      event: 'scheduler:task-updated',
    }))
    expect(state.scheduleTask).toHaveBeenCalledTimes(1)
  })

  it('scheduler:update ignores missing id', () => {
    const reply = sendCommand('scheduler:update', { input: { name: 'x' } })
    expect(reply).not.toHaveBeenCalled()
  })

  it('scheduler:delete unschedules then removes task', () => {
    const reply = sendCommand('scheduler:delete', { id: 'task-1' })
    expect(state.unscheduleTask).toHaveBeenCalledWith('task-1')
    expect(reply).toHaveBeenCalledWith({
      event: 'scheduler:task-deleted',
      data: { taskId: 'task-1' },
    })
  })

  it('scheduler:delete ignores missing id', () => {
    const reply = sendCommand('scheduler:delete', {})
    expect(reply).not.toHaveBeenCalled()
    expect(state.unscheduleTask).not.toHaveBeenCalled()
  })

  it('scheduler:set-enabled enables a task', () => {
    const reply = sendCommand('scheduler:set-enabled', { id: 'task-1', enabled: true })
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      event: 'scheduler:task-updated',
    }))
    expect(state.scheduleTask).toHaveBeenCalledTimes(1)
  })

  it('scheduler:set-enabled disables a task', () => {
    sendCommand('scheduler:set-enabled', { id: 'task-1', enabled: false })
    expect(state.unscheduleTask).toHaveBeenCalledWith('task-1')
    expect(state.scheduleTask).not.toHaveBeenCalled()
  })

  it('scheduler:run-now triggers a manual run', async () => {
    sendCommand('scheduler:run-now', { id: 'task-1' })
    // triggerRun is async; give the microtask queue a turn
    await new Promise((r) => setTimeout(r, 0))
    expect(state.triggerRun).toHaveBeenCalledWith('task-1', 'manual')
    expect(state.replies).toHaveLength(1)
    expect((state.replies[0] as { event: string }).event).toBe('scheduler:run-updated')
  })

  it('scheduler:run-now ignores missing id', () => {
    const reply = sendCommand('scheduler:run-now', {})
    expect(reply).not.toHaveBeenCalled()
    expect(state.triggerRun).not.toHaveBeenCalled()
  })

  it('scheduler:list-runs replies with runs for a task', () => {
    const reply = sendCommand('scheduler:list-runs', { taskId: 'task-1', limit: 10 })
    expect(reply).toHaveBeenCalledWith({
      event: 'scheduler:runs',
      data: { taskId: 'task-1', runs: [] },
    })
  })

  it('scheduler:list-runs ignores missing taskId', () => {
    const reply = sendCommand('scheduler:list-runs', { limit: 10 })
    expect(reply).not.toHaveBeenCalled()
  })
})
