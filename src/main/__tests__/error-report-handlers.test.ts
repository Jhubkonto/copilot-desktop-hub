import Database from 'better-sqlite3'
import { existsSync, readFileSync, rmSync } from 'fs'
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
})
