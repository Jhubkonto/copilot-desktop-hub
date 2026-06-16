import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const { safeHandlers, testRoot } = vi.hoisted(() => ({
  safeHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  testRoot: { value: '.test-error-report-data' },
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => testRoot.value,
    getVersion: () => '0.9.0-test',
  },
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

describe('error report handlers', () => {
  beforeEach(() => {
    safeHandlers.clear()
    vi.resetModules()
    rmSync(testRoot.value, { recursive: true, force: true })
    db = createDatabase()
  })

  afterEach(() => {
    db.close()
    rmSync(testRoot.value, { recursive: true, force: true })
  })

  it('captures a report with a screenshot and log snapshot', async () => {
    db.prepare(
      `INSERT INTO error_log (id, source, level, message, stack, timestamp)
       VALUES ('log-1', 'renderer', 'error', 'boom', 'App.tsx:1', 10)`,
    ).run()
    const { createErrorReport } = await import('../error-report-handlers')

    const result = createErrorReport({
      title: 'Broken workflow',
      description: 'Clicked submit and failed.',
      includeLog: true,
      includeScreenshot: true,
      screenshotDataUrl: 'data:image/png;base64,aGVsbG8=',
    })

    const row = db.prepare('SELECT * FROM error_reports WHERE id = ?').get(result.reportId) as Record<string, unknown>
    expect(row).toEqual(expect.objectContaining({
      title: 'Broken workflow',
      description: 'Clicked submit and failed.',
      status: 'open',
      app_version: '0.9.0-test',
    }))
    expect(String(row.log_snapshot)).toContain('boom')
    expect(result.screenshotPath).toEqual(expect.stringContaining(`${result.reportId}`))
    expect(existsSync(result.screenshotPath ?? '')).toBe(true)
    expect(readFileSync(result.screenshotPath ?? '', 'utf8')).toBe('hello')
  })

  it('registers the capture IPC handler', async () => {
    const { registerErrorReportHandlers } = await import('../error-report-handlers')
    registerErrorReportHandlers()

    const result = invoke<{ reportId: string }>('error-report:capture', {
      title: '',
      includeLog: false,
      includeScreenshot: false,
    })
    const report = invoke<{ id: string; title: string } | null>('error-report:get', result.reportId)
    const reports = invoke<Array<{ id: string; title: string }>>('error-report:list', 10)

    expect(result.reportId).toEqual(expect.any(String))
    expect(report).toEqual(expect.objectContaining({ id: result.reportId, title: 'Bug report' }))
    expect(reports).toEqual([expect.objectContaining({ id: result.reportId, title: 'Bug report' })])
  })

  it('deletes a report, its self-heal rows, and its artifact folders', async () => {
    const { registerErrorReportHandlers } = await import('../error-report-handlers')
    registerErrorReportHandlers()

    const result = invoke<{ reportId: string }>('error-report:capture', {
      title: 'Delete me',
      includeLog: false,
      includeScreenshot: true,
      screenshotDataUrl: 'data:image/png;base64,aGVsbG8=',
    })
    mkdirSync(`${testRoot.value}/self-heal/staging/${result.reportId}`, { recursive: true })
    mkdirSync(`${testRoot.value}/self-heal/backups/${result.reportId}`, { recursive: true })
    db.prepare('INSERT INTO self_heal_diffs (report_id, relative_path, diff_json, created_at) VALUES (?, ?, ?, ?)')
      .run(result.reportId, 'src/App.tsx', '{}', 1)
    db.prepare(
      `INSERT INTO self_heal_verification_runs
       (id, report_id, status, steps_json, started_at, completed_at, retry_count)
       VALUES ('verify-1', ?, 'success', '[]', 1, 2, 0)`,
    ).run(result.reportId)
    db.prepare(
      `INSERT INTO self_heal_recovery_runs
       (id, report_id, status, backup_manifest_json, pre_reload_state_json, created_at, updated_at)
       VALUES ('recovery-1', ?, 'prepared', '[]', '{}', 1, 1)`,
    ).run(result.reportId)
    db.prepare(
      `INSERT INTO self_heal_history (id, report_id, report_title, status, created_at, updated_at)
       VALUES ('history-1', ?, 'Delete me', 'investigating', 1, 1)`,
    ).run(result.reportId)
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('self_heal_pending_recovery_id', 'recovery-1')").run()

    expect(invoke<boolean>('error-report:delete', result.reportId)).toBe(true)

    expect(db.prepare('SELECT COUNT(*) AS count FROM error_reports WHERE id = ?').get(result.reportId)).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM self_heal_diffs WHERE report_id = ?').get(result.reportId)).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM self_heal_verification_runs WHERE report_id = ?').get(result.reportId)).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM self_heal_recovery_runs WHERE report_id = ?').get(result.reportId)).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM self_heal_history WHERE report_id = ?').get(result.reportId)).toEqual({ count: 0 })
    expect(db.prepare("SELECT value FROM settings WHERE key = 'self_heal_pending_recovery_id'").get()).toBeUndefined()
    expect(existsSync(`${testRoot.value}/error-reports/${result.reportId}`)).toBe(false)
    expect(existsSync(`${testRoot.value}/self-heal/staging/${result.reportId}`)).toBe(false)
    expect(existsSync(`${testRoot.value}/self-heal/backups/${result.reportId}`)).toBe(false)
  })
})
