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
    expect(report).toEqual(expect.objectContaining({ id: result.reportId, title: 'Edit request' }))
    expect(reports).toEqual([expect.objectContaining({ id: result.reportId, title: 'Edit request' })])
  })

  it('persists neutral code-change metadata', async () => {
    const { createErrorReport, rowToErrorReport } = await import('../error-report-handlers')
    const result = createErrorReport({
      title: 'Extract parser',
      requestType: 'refactor',
      origin: 'chat',
      workspaceRoot: 'C:\\work\\repo',
      projectId: null,
    })

    const row = db.prepare('SELECT * FROM error_reports WHERE id = ?').get(result.reportId) as Record<string, unknown>
    expect(rowToErrorReport(row)).toEqual(expect.objectContaining({
      request_type: 'refactor',
      request_origin: 'chat',
      workspace_root: 'C:\\work\\repo',
      project_id: null,
    }))
  })

  it('persists a custom request type and its free-text label', async () => {
    const { createErrorReport, rowToErrorReport } = await import('../error-report-handlers')
    const result = createErrorReport({
      title: 'Data migration',
      requestType: 'custom',
      customTypeLabel: 'Data migration',
      origin: 'manual',
      workspaceRoot: 'C:\\work\\repo',
      projectId: null,
    })

    const row = db.prepare('SELECT * FROM error_reports WHERE id = ?').get(result.reportId) as Record<string, unknown>
    expect(rowToErrorReport(row)).toEqual(expect.objectContaining({
      request_type: 'custom',
      custom_type_label: 'Data migration',
    }))
  })

  it('ignores a custom_type_label when the request type is not custom', async () => {
    const { createErrorReport, rowToErrorReport } = await import('../error-report-handlers')
    const result = createErrorReport({
      title: 'Extract parser',
      requestType: 'refactor',
      customTypeLabel: 'Should be ignored',
      origin: 'manual',
    })

    const row = db.prepare('SELECT * FROM error_reports WHERE id = ?').get(result.reportId) as Record<string, unknown>
    expect(rowToErrorReport(row)).toEqual(expect.objectContaining({
      request_type: 'refactor',
      custom_type_label: null,
    }))
  })

  it('deletes a report, its remote-edit rows, and its artifact folders', async () => {
    const { registerErrorReportHandlers } = await import('../error-report-handlers')
    registerErrorReportHandlers()

    const result = invoke<{ reportId: string }>('error-report:capture', {
      title: 'Delete me',
      includeLog: false,
      includeScreenshot: true,
      screenshotDataUrl: 'data:image/png;base64,aGVsbG8=',
    })
    mkdirSync(`${testRoot.value}/remote-edit/staging/${result.reportId}`, { recursive: true })
    mkdirSync(`${testRoot.value}/remote-edit/backups/${result.reportId}`, { recursive: true })
    db.prepare('INSERT INTO remote_edit_diffs (report_id, relative_path, diff_json, created_at) VALUES (?, ?, ?, ?)')
      .run(result.reportId, 'src/App.tsx', '{}', 1)
    db.prepare(
      `INSERT INTO remote_edit_verification_runs
       (id, report_id, status, steps_json, started_at, completed_at, retry_count)
       VALUES ('verify-1', ?, 'success', '[]', 1, 2, 0)`,
    ).run(result.reportId)
    db.prepare(
      `INSERT INTO remote_edit_recovery_runs
       (id, report_id, status, backup_manifest_json, pre_reload_state_json, created_at, updated_at)
       VALUES ('recovery-1', ?, 'prepared', '[]', '{}', 1, 1)`,
    ).run(result.reportId)
    db.prepare(
      `INSERT INTO remote_edit_history (id, report_id, report_title, status, created_at, updated_at)
       VALUES ('history-1', ?, 'Delete me', 'investigating', 1, 1)`,
    ).run(result.reportId)
    db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('conv-delete', 'Delete refs', 1, 1)").run()
    db.prepare('INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)')
      .run('msg-code-change-ref', 'conv-delete', 'system', `__code-change-ref:${JSON.stringify({ reportId: result.reportId })}`, 2)
    db.prepare('INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)')
      .run('msg-other-code-change-ref', 'conv-delete', 'system', `__code-change-ref:${JSON.stringify({ reportId: 'other-report' })}`, 3)
    db.prepare('INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)')
      .run('msg-normal', 'conv-delete', 'assistant', 'Keep me', 4)

    expect(invoke<boolean>('error-report:delete', result.reportId)).toBe(true)

    expect(db.prepare('SELECT COUNT(*) AS count FROM error_reports WHERE id = ?').get(result.reportId)).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM remote_edit_diffs WHERE report_id = ?').get(result.reportId)).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM remote_edit_verification_runs WHERE report_id = ?').get(result.reportId)).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM remote_edit_recovery_runs WHERE report_id = ?').get(result.reportId)).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM remote_edit_history WHERE report_id = ?').get(result.reportId)).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE id = ?').get('msg-code-change-ref')).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE id = ?').get('msg-other-code-change-ref')).toEqual({ count: 1 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE id = ?').get('msg-normal')).toEqual({ count: 1 })
    expect(existsSync(`${testRoot.value}/error-reports/${result.reportId}`)).toBe(false)
    expect(existsSync(`${testRoot.value}/remote-edit/staging/${result.reportId}`)).toBe(false)
    expect(existsSync(`${testRoot.value}/remote-edit/backups/${result.reportId}`)).toBe(false)
  })

  it('propagates a thrown error instead of returning a falsy value on delete failure', async () => {
    const { registerErrorReportHandlers } = await import('../error-report-handlers')
    registerErrorReportHandlers()

    const result = invoke<{ reportId: string }>('error-report:capture', {
      title: 'Delete me too',
      includeLog: false,
      includeScreenshot: false,
    })

    db.close()

    // With the database closed, deleteErrorReport's db.prepare(...) calls throw.
    // safeHandle (mocked here to call the raw handler) relies on this throw to
    // eventually surface `{ error }` to the renderer instead of a bare `false`.
    expect(() => invoke<boolean>('error-report:delete', result.reportId)).toThrow()

    db = createDatabase()
  })

  describe('conversation_id linkage and error-report:find-active-for-conversation', () => {
    it('persists conversation_id when provided and returns it via error-report:get', async () => {
      const { registerErrorReportHandlers } = await import('../error-report-handlers')
      registerErrorReportHandlers()

      db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('conv-42', 'Test', 1, 1)").run()
      const result = invoke<{ reportId: string }>('error-report:capture', {
        title: 'From chat',
        includeLog: false,
        includeScreenshot: false,
        origin: 'chat',
        conversationId: 'conv-42',
      })

      const fetched = invoke<{ conversation_id: string | null }>('error-report:get', result.reportId)
      expect(fetched?.conversation_id).toBe('conv-42')
    })

    it('finds a non-terminal request already linked to the conversation', async () => {
      const { registerErrorReportHandlers } = await import('../error-report-handlers')
      registerErrorReportHandlers()

      db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('conv-1', 'Test', 1, 1)").run()
      const created = invoke<{ reportId: string }>('error-report:capture', {
        title: 'Fix the bug',
        includeLog: false,
        includeScreenshot: false,
        origin: 'chat',
        conversationId: 'conv-1',
      })

      const found = invoke<{ id: string } | null>('error-report:find-active-for-conversation', 'conv-1')
      expect(found?.id).toBe(created.reportId)
    })

    it('returns null when the only request for the conversation is terminal (fixed/rejected)', async () => {
      const { registerErrorReportHandlers } = await import('../error-report-handlers')
      registerErrorReportHandlers()

      db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('conv-2', 'Test', 1, 1)").run()
      const created = invoke<{ reportId: string }>('error-report:capture', {
        title: 'Already done',
        includeLog: false,
        includeScreenshot: false,
        origin: 'chat',
        conversationId: 'conv-2',
      })
      db.prepare("UPDATE error_reports SET status = 'completed' WHERE id = ?").run(created.reportId)

      const found = invoke<{ id: string } | null>('error-report:find-active-for-conversation', 'conv-2')
      expect(found).toBeNull()
    })

    it('returns null for a conversation with no linked request', async () => {
      const { registerErrorReportHandlers } = await import('../error-report-handlers')
      registerErrorReportHandlers()

      const found = invoke<{ id: string } | null>('error-report:find-active-for-conversation', 'no-such-conv')
      expect(found).toBeNull()
    })
  })
})
