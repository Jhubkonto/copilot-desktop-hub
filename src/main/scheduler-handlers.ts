import { safeHandle } from './safe-handle'
import { getDatabase } from './database'
import { log } from './logger'
import {
  dbListTasks,
  dbGetTask,
  dbCreateTask,
  dbUpdateTask,
  dbDeleteTask,
  dbSetTaskEnabled,
  dbListRuns,
  schedulerEngine,
} from './scheduler-engine'
import type { ScheduledTask, ScheduledTaskCreateInput, ScheduledTaskUpdateInput } from '../shared/types'

function buildWarnings(input: Partial<ScheduledTask>): string[] {
  const db = getDatabase()
  const warnings: string[] = []
  if (input.agentId) {
    const row = db.prepare('SELECT id FROM agents WHERE id = ?').get(input.agentId)
    if (!row) warnings.push(`Agent "${input.agentId}" no longer exists`)
  }
  if (input.projectId) {
    const row = db.prepare('SELECT id FROM projects WHERE id = ?').get(input.projectId)
    if (!row) warnings.push(`Project "${input.projectId}" no longer exists`)
  }
  return warnings
}

export function registerSchedulerHandlers(): void {
  safeHandle('scheduler:list', () => {
    return dbListTasks()
  })

  safeHandle('scheduler:get', (_event, id: string) => {
    if (!id || typeof id !== 'string') return { error: 'Invalid id' }
    return dbGetTask(id)
  })

  safeHandle('scheduler:create', (_event, input: ScheduledTaskCreateInput) => {
    if (!input?.name || !input?.scheduleType || !input?.localTime || !input?.timezone) {
      return { error: 'Missing required fields: name, scheduleType, localTime, timezone' }
    }
    const warnings = buildWarnings(input)
    const task = dbCreateTask(input)
    schedulerEngine.scheduleTask(task)
    log.info(`[scheduler] Created task ${task.id}: "${task.name}"`)
    return { task, warnings }
  })

  safeHandle('scheduler:update', (_event, id: string, input: ScheduledTaskUpdateInput) => {
    if (!id || typeof id !== 'string') return { error: 'Invalid id' }
    const warnings = buildWarnings(input)
    const task = dbUpdateTask(id, input)
    if (!task) return { error: `Task ${id} not found` }
    if (task.enabled) {
      schedulerEngine.scheduleTask(task)
    } else {
      schedulerEngine.unscheduleTask(id)
    }
    log.info(`[scheduler] Updated task ${id}`)
    return { task, warnings }
  })

  safeHandle('scheduler:delete', (_event, id: string) => {
    if (!id || typeof id !== 'string') return { error: 'Invalid id' }
    schedulerEngine.unscheduleTask(id)
    const deleted = dbDeleteTask(id)
    if (deleted) log.info(`[scheduler] Deleted task ${id}`)
    return deleted
  })

  safeHandle('scheduler:set-enabled', (_event, id: string, enabled: boolean) => {
    if (!id || typeof id !== 'string') return { error: 'Invalid id' }
    const task = dbSetTaskEnabled(id, enabled)
    if (!task) return { error: `Task ${id} not found` }
    if (task.enabled) {
      schedulerEngine.scheduleTask(task)
    } else {
      schedulerEngine.unscheduleTask(id)
    }
    log.info(`[scheduler] Task ${id} ${enabled ? 'enabled' : 'disabled'}`)
    return task
  })

  safeHandle('scheduler:run-now', async (_event, id: string) => {
    if (!id || typeof id !== 'string') return { error: 'Invalid id' }
    try {
      const run = await schedulerEngine.triggerRun(id, 'manual')
      return run
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { error: msg }
    }
  })

  safeHandle('scheduler:list-runs', (_event, taskId: string, limit?: number) => {
    if (!taskId || typeof taskId !== 'string') return { error: 'Invalid taskId' }
    return dbListRuns(taskId, limit ?? 50)
  })
}
