import { randomUUID } from 'crypto'
import { powerMonitor, BrowserWindow, Notification } from 'electron'
import { getDatabase } from './database'
import { calcNextRunAt, calcScheduledAt, isMissed } from './scheduler-recurrence'
import { dispatchChatSend } from './chat-handlers'
import { broadcastToMobile } from './ws-server'
import { sendSchedulerRunNotification } from './fcm-sender'
import { log } from './logger'
import {
  saveAutomatedWorkflowRunFromSpec,
  findAutomatedWorkflowRunByScheduleTag,
} from './automated-workflow-runs'
import {
  startAutomatedWorkflowRun,
  retryAutomatedWorkflowStep,
  setAutomatedWorkflowConfirmationMode,
} from './automated-workflow-executor'
import type {
  ScheduledTask,
  ScheduledRun,
  ScheduledTaskCreateInput,
  ScheduledTaskUpdateInput,
  ScheduledTaskWorkflowSpec,
  AutomatedWorkflowSpec,
} from '../shared/types'

// ─────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────

function rowToTask(row: Record<string, unknown>): ScheduledTask {
  return {
    id: row.id as string,
    name: row.name as string,
    prompt: row.prompt as string,
    enabled: Boolean(row.enabled),
    agentId: (row.agent_id as string | null) ?? null,
    projectId: (row.project_id as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    conversationId: (row.conversation_id as string | null) ?? null,
    scheduleType: row.schedule_type as ScheduledTask['scheduleType'],
    localTime: row.local_time as string,
    weekday: (row.weekday as number | null) ?? null,
    monthDay: (row.month_day as number | null) ?? null,
    timezone: row.timezone as string,
    toolPolicy: JSON.parse((row.tool_policy_json as string) || '{"preApproved":[],"alwaysAsk":[],"neverAllow":[]}'),
    notificationPref: (row.notification_pref as ScheduledTask['notificationPref']) ?? 'failures_only',
    nextRunAt: (row.next_run_at as number | null) ?? null,
    lastRunAt: (row.last_run_at as number | null) ?? null,
    targetType: (row.target_type as ScheduledTask['targetType']) ?? 'chat',
    workflowSpecs: dbListScheduledTaskWorkflows(row.id as string),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

function rowToRun(row: Record<string, unknown>): ScheduledRun {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    scheduledAt: (row.scheduled_at as number | null) ?? null,
    startedAt: (row.started_at as number | null) ?? null,
    finishedAt: (row.finished_at as number | null) ?? null,
    status: row.status as ScheduledRun['status'],
    error: (row.error as string | null) ?? null,
    conversationId: (row.conversation_id as string | null) ?? null,
    messageId: (row.message_id as string | null) ?? null,
    triggerSource: row.trigger_source as ScheduledRun['triggerSource'],
    workflowRunIds: row.workflow_run_ids_json ? (JSON.parse(row.workflow_run_ids_json as string) as string[]) : null,
    createdAt: row.created_at as number,
  }
}

/** Attached Automated Workflow specs for a schedule, in execution order. */
export function dbListScheduledTaskWorkflows(taskId: string): ScheduledTaskWorkflowSpec[] {
  const rows = getDatabase()
    .prepare('SELECT workflow_spec_json, source_run_id, confirmation_mode FROM scheduled_task_workflows WHERE task_id = ? ORDER BY sort_order ASC')
    .all(taskId) as { workflow_spec_json: string; source_run_id: string | null; confirmation_mode: ScheduledTaskWorkflowSpec['confirmationMode'] }[]
  return rows.map((row) => ({
    workflowSpecJson: row.workflow_spec_json,
    sourceRunId: row.source_run_id,
    confirmationMode: row.confirmation_mode,
  }))
}

/** Replaces the full set of workflow specs attached to a schedule — delete-then-reinsert within
 *  a transaction, same pattern as `reorderSkillsForAgent`'s "set the full list" precedent in
 *  skills.ts. */
export function dbSetScheduledTaskWorkflows(taskId: string, specs: ScheduledTaskWorkflowSpec[]): void {
  const db = getDatabase()
  const now = Date.now()
  db.transaction(() => {
    db.prepare('DELETE FROM scheduled_task_workflows WHERE task_id = ?').run(taskId)
    const insert = db.prepare(`
      INSERT INTO scheduled_task_workflows (task_id, workflow_spec_json, source_run_id, confirmation_mode, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    specs.forEach((spec, index) => {
      insert.run(taskId, spec.workflowSpecJson, spec.sourceRunId, spec.confirmationMode, index, now)
    })
  })()
}

export function dbListTasks(onlyEnabled = false): ScheduledTask[] {
  const db = getDatabase()
  const sql = onlyEnabled
    ? 'SELECT * FROM scheduled_tasks WHERE enabled = 1 ORDER BY next_run_at ASC'
    : 'SELECT * FROM scheduled_tasks ORDER BY created_at DESC'
  return (db.prepare(sql).all() as Record<string, unknown>[]).map(rowToTask)
}

export function dbGetTask(id: string): ScheduledTask | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToTask(row) : null
}

export function dbCreateTask(input: ScheduledTaskCreateInput): ScheduledTask {
  const db = getDatabase()
  const id = randomUUID()
  const now = Date.now()
  const toolPolicy = {
    preApproved: input.toolPolicy?.preApproved ?? [],
    alwaysAsk: input.toolPolicy?.alwaysAsk ?? [],
    neverAllow: input.toolPolicy?.neverAllow ?? [],
  }
  db.prepare(`
    INSERT INTO scheduled_tasks
      (id, name, prompt, enabled, agent_id, project_id, model, schedule_type,
       local_time, weekday, month_day, timezone, tool_policy_json, notification_pref,
       target_type, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id,
    input.name,
    input.prompt,
    input.enabled !== false ? 1 : 0,
    input.agentId ?? null,
    input.projectId ?? null,
    input.model ?? null,
    input.scheduleType,
    input.localTime,
    input.weekday ?? null,
    input.monthDay ?? null,
    input.timezone,
    JSON.stringify(toolPolicy),
    input.notificationPref ?? 'failures_only',
    input.targetType ?? 'chat',
    now,
    now,
  )
  if (input.workflowSpecs) dbSetScheduledTaskWorkflows(id, input.workflowSpecs)
  const task = dbGetTask(id)!
  // Calculate first nextRunAt
  const next = calcNextRunAt(task, now)
  db.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?').run(next ?? null, id)
  return dbGetTask(id)!
}

export function dbUpdateTask(id: string, input: ScheduledTaskUpdateInput): ScheduledTask | null {
  const db = getDatabase()
  const existing = dbGetTask(id)
  if (!existing) return null
  const now = Date.now()
  const toolPolicy = input.toolPolicy
    ? {
        preApproved: input.toolPolicy.preApproved ?? existing.toolPolicy.preApproved,
        alwaysAsk: input.toolPolicy.alwaysAsk ?? existing.toolPolicy.alwaysAsk,
        neverAllow: input.toolPolicy.neverAllow ?? existing.toolPolicy.neverAllow,
      }
    : existing.toolPolicy

  db.prepare(`
    UPDATE scheduled_tasks SET
      name = ?, prompt = ?, agent_id = ?, project_id = ?, model = ?,
      schedule_type = ?, local_time = ?, weekday = ?, month_day = ?,
      timezone = ?, tool_policy_json = ?, notification_pref = ?, target_type = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.name ?? existing.name,
    input.prompt ?? existing.prompt,
    input.agentId !== undefined ? input.agentId : existing.agentId,
    input.projectId !== undefined ? input.projectId : existing.projectId,
    input.model !== undefined ? input.model : existing.model,
    input.scheduleType ?? existing.scheduleType,
    input.localTime ?? existing.localTime,
    input.weekday !== undefined ? input.weekday : existing.weekday,
    input.monthDay !== undefined ? input.monthDay : existing.monthDay,
    input.timezone ?? existing.timezone,
    JSON.stringify(toolPolicy),
    input.notificationPref ?? existing.notificationPref,
    input.targetType ?? existing.targetType,
    now,
    id,
  )
  if (input.workflowSpecs !== undefined) dbSetScheduledTaskWorkflows(id, input.workflowSpecs)
  const updated = dbGetTask(id)!
  const next = calcNextRunAt(updated, now)
  db.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?').run(next ?? null, id)
  return dbGetTask(id)!
}

export function dbDeleteTask(id: string): boolean {
  const db = getDatabase()
  const info = db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id)
  return info.changes > 0
}

export function dbSetTaskEnabled(id: string, enabled: boolean): ScheduledTask | null {
  const db = getDatabase()
  const existing = dbGetTask(id)
  if (!existing) return null
  const now = Date.now()
  db.prepare('UPDATE scheduled_tasks SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, now, id)
  if (enabled) {
    const task = dbGetTask(id)!
    const next = calcNextRunAt(task, now)
    db.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?').run(next ?? null, id)
  } else {
    db.prepare('UPDATE scheduled_tasks SET next_run_at = NULL WHERE id = ?').run(id)
  }
  return dbGetTask(id)!
}

export function dbListRuns(taskId: string, limit = 50): ScheduledRun[] {
  const db = getDatabase()
  return (db.prepare('SELECT * FROM scheduled_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT ?').all(taskId, limit) as Record<string, unknown>[]).map(rowToRun)
}

function dbCreateRun(taskId: string, trigger: ScheduledRun['triggerSource'], scheduledAt: number | null): ScheduledRun {
  const db = getDatabase()
  const id = randomUUID()
  const now = Date.now()
  db.prepare(`
    INSERT OR IGNORE INTO scheduled_runs (id, task_id, scheduled_at, status, trigger_source, created_at)
    VALUES (?,?,?,'pending',?,?)
  `).run(id, taskId, scheduledAt, trigger, now)
  const row = db.prepare('SELECT * FROM scheduled_runs WHERE id = ?').get(id) as Record<string, unknown> | undefined
  // If INSERT was ignored (duplicate scheduledAt), return the existing row
  if (!row) {
    const existing = db.prepare('SELECT * FROM scheduled_runs WHERE task_id = ? AND scheduled_at = ?').get(taskId, scheduledAt) as Record<string, unknown>
    return rowToRun(existing)
  }
  return rowToRun(row)
}

function dbUpdateRunStatus(
  runId: string,
  status: ScheduledRun['status'],
  extra: {
    startedAt?: number
    finishedAt?: number
    error?: string
    conversationId?: string
    messageId?: string
    workflowRunIds?: string[]
  } = {},
): ScheduledRun | null {
  const db = getDatabase()
  db.prepare(`
    UPDATE scheduled_runs SET status = ?, started_at = COALESCE(?, started_at),
      finished_at = COALESCE(?, finished_at), error = COALESCE(?, error),
      conversation_id = COALESCE(?, conversation_id), message_id = COALESCE(?, message_id),
      workflow_run_ids_json = COALESCE(?, workflow_run_ids_json)
    WHERE id = ?
  `).run(
    status,
    extra.startedAt ?? null,
    extra.finishedAt ?? null,
    extra.error ?? null,
    extra.conversationId ?? null,
    extra.messageId ?? null,
    extra.workflowRunIds ? JSON.stringify(extra.workflowRunIds) : null,
    runId,
  )
  const row = db.prepare('SELECT * FROM scheduled_runs WHERE id = ?').get(runId) as Record<string, unknown> | undefined
  return row ? rowToRun(row) : null
}

// ─────────────────────────────────────────────────────────────
// Push helpers
// ─────────────────────────────────────────────────────────────

function pushTaskUpdated(task: ScheduledTask): void {
  broadcastToMobile({ event: 'scheduler:task-updated', data: task })
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.webContents.isDestroyed()) {
    win.webContents.send('scheduler:task-updated', task)
  }
}

function pushRunUpdated(run: ScheduledRun): void {
  broadcastToMobile({ event: 'scheduler:run-updated', data: run })
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.webContents.isDestroyed()) {
    win.webContents.send('scheduler:run-updated', run)
  }
}

// ─────────────────────────────────────────────────────────────
// Desktop notifications
// ─────────────────────────────────────────────────────────────

function maybeNotify(task: ScheduledTask, status: 'success' | 'failed' | 'approval_required'): void {
  const pref = task.notificationPref ?? 'failures_only'
  if (pref === 'off') return
  if (pref === 'failures_only' && status === 'success') return

  const titles: Record<string, string> = {
    success: `Task complete: ${task.name}`,
    failed: `Task failed: ${task.name}`,
    approval_required: `Approval required: ${task.name}`,
  }
  try {
    new Notification({ title: titles[status] ?? task.name, silent: status === 'success' }).show()
  } catch {
    // Notifications may not be available in all environments
  }
}

// ─────────────────────────────────────────────────────────────
// SchedulerEngine
// ─────────────────────────────────────────────────────────────

const MAX_RETRIES = 3
const RETRY_BASE_MS = 5_000
const DRIFT_CHECK_INTERVAL_MS = 60_000
const HISTORY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000

export class SchedulerEngine {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private driftCheckTimer: ReturnType<typeof setInterval> | null = null
  private pruneTimer: ReturnType<typeof setInterval> | null = null
  private lastWallTime = Date.now()
  private started = false

  start(): void {
    if (this.started) return
    this.started = true
    this.rehydrate()
    this.setupDriftCheck()
    this.setupPruneJob()
    powerMonitor.on('resume', () => this.onWake())
    powerMonitor.on('unlock-screen', () => this.onWake())
    log.info('[scheduler] Engine started')
  }

  stop(): void {
    this.timers.forEach((t) => clearTimeout(t))
    this.timers.clear()
    if (this.driftCheckTimer) clearInterval(this.driftCheckTimer)
    if (this.pruneTimer) clearInterval(this.pruneTimer)
    this.started = false
    log.info('[scheduler] Engine stopped')
  }

  rehydrate(): void {
    this.timers.forEach((t) => clearTimeout(t))
    this.timers.clear()
    const tasks = dbListTasks(true)
    for (const task of tasks) {
      this.scheduleTask(task)
    }
    log.info(`[scheduler] Rehydrated ${tasks.length} enabled task(s)`)
  }

  scheduleTask(task: ScheduledTask): void {
    this.unscheduleTask(task.id)
    if (!task.enabled) return

    const now = Date.now()
    const fireAt = task.nextRunAt ?? calcNextRunAt(task, now)
    if (fireAt === null) return

    const delay = Math.max(0, fireAt - now)

    if (isMissed(fireAt, now)) {
      // Missed — run immediately (catch-up)
      log.info(`[scheduler] Catch-up run for task ${task.id} (missed at ${new Date(fireAt).toISOString()})`)
      void this.triggerRun(task.id, 'scheduled', fireAt)
      return
    }

    log.info(`[scheduler] Scheduling task ${task.id} in ${Math.round(delay / 1000)}s`)
    const timer = setTimeout(() => {
      this.timers.delete(task.id)
      void this.triggerRun(task.id, 'scheduled', fireAt)
    }, delay)
    this.timers.set(task.id, timer)
  }

  unscheduleTask(taskId: string): void {
    const t = this.timers.get(taskId)
    if (t) {
      clearTimeout(t)
      this.timers.delete(taskId)
    }
  }

  async triggerRun(taskId: string, source: ScheduledRun['triggerSource'], scheduledAt?: number): Promise<ScheduledRun> {
    const task = dbGetTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    const now = Date.now()
    const scheduledAtVal = source === 'manual' ? null : (scheduledAt ?? calcScheduledAt(task, now))

    // Enforce one active run per task
    const db = getDatabase()
    const active = db.prepare(
      "SELECT id FROM scheduled_runs WHERE task_id = ? AND status IN ('running', 'pending')"
    ).get(taskId)
    if (active) {
      log.warn(`[scheduler] Task ${taskId} already has an active run, skipping`)
      throw new Error('Task already has an active run')
    }

    // Create run record
    const run = dbCreateRun(taskId, source, scheduledAtVal)
    if (run.status !== 'pending') {
      // Idempotency: run record already existed (duplicate scheduledAt)
      return run
    }

    log.info(`[scheduler] Starting run ${run.id} for task ${taskId} (source=${source})`)
    let updatedRun = dbUpdateRunStatus(run.id, 'running', { startedAt: Date.now() })!
    pushRunUpdated(updatedRun)

    // Re-arm the next scheduled occurrence before executing (so a crash doesn't lose the schedule)
    if (source === 'scheduled') {
      const next = calcNextRunAt(task, now)
      db.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?').run(next ?? null, taskId)
      // Schedule next occurrence
      const refreshedTask = dbGetTask(taskId)!
      this.scheduleTask(refreshedTask)

      // One-time tasks disable themselves after firing
      if (task.scheduleType === 'one-time') {
        db.prepare("UPDATE scheduled_tasks SET enabled = 0, updated_at = ? WHERE id = ?").run(Date.now(), taskId)
      }
    }

    let attempt = 0
    while (attempt <= MAX_RETRIES) {
      try {
        updatedRun = await this.executeRun(task, run.id) ?? updatedRun
        break
      } catch (err) {
        attempt++
        const errMsg = err instanceof Error ? err.message : String(err)
        if (attempt > MAX_RETRIES) {
          updatedRun = dbUpdateRunStatus(run.id, 'failed', { finishedAt: Date.now(), error: errMsg })!
          pushRunUpdated(updatedRun)
          maybeNotify(task, 'failed')
          void sendSchedulerRunNotification(getDatabase(), { type: 'run-failed', taskId: task.id, taskName: task.name, status: 'failed', conversationId: task.conversationId })
          const finalTask = dbGetTask(taskId)
          if (finalTask) pushTaskUpdated(finalTask)
          log.error(`[scheduler] Run ${run.id} failed after ${MAX_RETRIES} retries: ${errMsg}`)
          break
        }
        const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1)
        log.warn(`[scheduler] Run ${run.id} attempt ${attempt} failed, retrying in ${backoff}ms: ${errMsg}`)
        await new Promise((r) => setTimeout(r, backoff))
      }
    }

    return updatedRun
  }

  private async executeRun(task: ScheduledTask, runId: string): Promise<ScheduledRun> {
    if (task.targetType === 'automated_workflow') return this.executeWorkflowRun(task, runId)
    return this.executeChatRun(task, runId)
  }

  private async executeWorkflowRun(task: ScheduledTask, runId: string): Promise<ScheduledRun> {
    const specs = dbListScheduledTaskWorkflows(task.id)
    if (specs.length === 0) throw new Error('Schedule has no automated workflow attached')

    const spawnedRunIds: string[] = []
    let complete = true

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]
      let detail = findAutomatedWorkflowRunByScheduleTag(runId, i)

      if (!detail) {
        const parsedSpec = JSON.parse(spec.workflowSpecJson) as AutomatedWorkflowSpec
        detail = saveAutomatedWorkflowRunFromSpec(task.projectId, parsedSpec, task.model, null, {
          scheduledRunId: runId,
          specSortOrder: i,
        })
        setAutomatedWorkflowConfirmationMode(detail.id, spec.confirmationMode)
        detail = (await startAutomatedWorkflowRun(detail.id)) ?? detail
      } else if (detail.status === 'failed') {
        // Retry semantics for an already-spawned run from an earlier attempt of this same
        // scheduled_runs row — re-run just the failed step (and its already-reset dependents),
        // not the whole spec from scratch, and never re-create/re-tag the run.
        const failedStep = detail.steps.find((s) => s.status === 'failed')
        detail = failedStep ? (await retryAutomatedWorkflowStep(detail.id, failedStep.dbId)) ?? detail : detail
      } else if (detail.status === 'pending') {
        detail = (await startAutomatedWorkflowRun(detail.id)) ?? detail
      }

      spawnedRunIds.push(detail.id)

      if (detail.status === 'failed') {
        dbUpdateRunStatus(runId, 'running', { workflowRunIds: spawnedRunIds })
        throw new Error(detail.lastError ?? `Automated workflow "${detail.title}" failed`)
      }
      if (detail.status !== 'done') {
        // Sequential batch: awaiting_confirmation (a 'gated' spec) or anything else non-terminal
        // stops the batch here rather than starting subsequent specs while this one is still
        // incomplete — the run overall surfaces as 'approval_required', not 'success'.
        complete = false
        break
      }
    }

    const now = Date.now()
    const finalStatus: ScheduledRun['status'] = complete ? 'success' : 'approval_required'
    const run = dbUpdateRunStatus(runId, finalStatus, { finishedAt: now, workflowRunIds: spawnedRunIds })!
    const db = getDatabase()
    db.prepare('UPDATE scheduled_tasks SET last_run_at = ?, updated_at = ? WHERE id = ?').run(now, now, task.id)

    pushRunUpdated(run)
    void sendSchedulerRunNotification(getDatabase(), {
      type: complete ? 'run-completed' : 'run-failed',
      taskId: task.id,
      taskName: task.name,
      status: finalStatus === 'success' ? 'success' : 'failed',
      conversationId: task.conversationId,
    })
    const refreshedTask = dbGetTask(task.id)
    if (refreshedTask) {
      pushTaskUpdated(refreshedTask)
      maybeNotify(refreshedTask, finalStatus === 'success' ? 'success' : 'approval_required')
    }
    log.info(`[scheduler] Workflow run ${runId} finished with status ${finalStatus}`)
    return run
  }

  private async executeChatRun(task: ScheduledTask, runId: string): Promise<ScheduledRun> {
    const db = getDatabase()
    const win = BrowserWindow.getAllWindows()[0]
    if (!win || win.webContents.isDestroyed()) {
      throw new Error('No browser window available for chat dispatch')
    }

    // Ensure the task has a dedicated conversation
    let conversationId = task.conversationId
    if (!conversationId) {
      const convId = randomUUID()
      const now = Date.now()
      db.prepare(`
        INSERT INTO conversations (id, agent_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(convId, task.agentId ?? null, `[Scheduled] ${task.name}`, now, now)
      conversationId = convId
      db.prepare('UPDATE scheduled_tasks SET conversation_id = ? WHERE id = ?').run(convId, task.id)
      log.info(`[scheduler] Created conversation ${convId} for task ${task.id}`)
    }

    // Dispatch through existing chat pipeline with task's tool policy
    const result = await dispatchChatSend(win, conversationId, task.prompt, {
      agentId: task.agentId ?? undefined,
      model: task.model ?? undefined,
      projectId: task.projectId ?? undefined,
      toolPolicy: task.toolPolicy,
    })

    const now = Date.now()
    const run = dbUpdateRunStatus(runId, 'success', {
      finishedAt: now,
      conversationId,
      messageId: result?.assistantMsgId ?? undefined,
    })!
    db.prepare('UPDATE scheduled_tasks SET last_run_at = ?, updated_at = ? WHERE id = ?').run(now, now, task.id)

    pushRunUpdated(run)
    void sendSchedulerRunNotification(getDatabase(), { type: 'run-completed', taskId: task.id, taskName: task.name, status: 'success', conversationId: conversationId })
    const refreshedTask = dbGetTask(task.id)
    if (refreshedTask) {
      pushTaskUpdated(refreshedTask)
      maybeNotify(refreshedTask, 'success')
    }
    log.info(`[scheduler] Run ${runId} completed successfully`)
    return run
  }

  // ─── Drift check ───────────────────────────────────────────

  private setupDriftCheck(): void {
    this.driftCheckTimer = setInterval(() => {
      const now = Date.now()
      const drift = Math.abs(now - this.lastWallTime - DRIFT_CHECK_INTERVAL_MS)
      this.lastWallTime = now
      if (drift > 5_000) {
        log.info(`[scheduler] Clock drift detected (${drift}ms), re-evaluating timers`)
        this.rehydrate()
      }
    }, DRIFT_CHECK_INTERVAL_MS)
  }

  private onWake(): void {
    log.info('[scheduler] System wake detected, re-evaluating timers')
    this.rehydrate()
  }

  // ─── History pruning ───────────────────────────────────────

  private setupPruneJob(): void {
    this.pruneTimer = setInterval(() => { this.pruneHistory() }, HISTORY_PRUNE_INTERVAL_MS)
    // Run once on startup (but don't block)
    setTimeout(() => this.pruneHistory(), 10_000)
  }

  private pruneHistory(): void {
    try {
      const db = getDatabase()
      const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
      // Keep at least the last 20 runs per task; prune older than 90 days beyond that
      const tasks = db.prepare('SELECT id FROM scheduled_tasks').all() as { id: string }[]
      let pruned = 0
      for (const { id } of tasks) {
        const rows = db.prepare(
          'SELECT id, created_at FROM scheduled_runs WHERE task_id = ? ORDER BY created_at DESC'
        ).all(id) as { id: string; created_at: number }[]
        const toDelete = rows.slice(20).filter((r) => r.created_at < cutoff)
        for (const row of toDelete) {
          db.prepare('DELETE FROM scheduled_runs WHERE id = ?').run(row.id)
          pruned++
        }
      }
      if (pruned > 0) log.info(`[scheduler] Pruned ${pruned} old run records`)
    } catch (err) {
      log.error('[scheduler] History prune failed', err)
    }
  }
}

export const schedulerEngine = new SchedulerEngine()
