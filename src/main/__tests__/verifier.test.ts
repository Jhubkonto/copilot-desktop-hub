import { EventEmitter } from 'events'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const { spawnMock, workspacePath, retryLimit } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  workspacePath: { value: process.cwd() },
  retryLimit: { value: 0 },
}))

vi.mock('child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('../ws-server', () => ({
  broadcastToMobile: vi.fn(),
}))

vi.mock('../self-heal/investigator', () => ({
  getWorkspacePath: () => workspacePath.value,
  loadInvestigationSettings: () => ({
    backend: 'byok',
    model: 'gpt-5-mini',
    retryLimit: retryLimit.value,
    autoApproveTools: true,
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
  database.prepare(
    `INSERT INTO error_reports (
      id, title, description, screenshot_path, log_snapshot, status,
      app_version, platform, os_version, investigation_markdown,
      created_at, updated_at
    ) VALUES ('report-1', 'Bug', '', NULL, NULL, 'fixed', NULL, NULL, NULL, 'Investigation', 1, 1)`,
  ).run()
  return database
}

function mockExitCodes(exitCodes: number[]) {
  spawnMock.mockImplementation((_cmd: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const code = exitCodes.shift() ?? 0
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(`${args.join(' ')} output\n`))
      child.emit('close', code)
    }, 0)
    return child
  })
}

describe('self-heal verifier', () => {
  beforeEach(() => {
    vi.resetModules()
    spawnMock.mockReset()
    retryLimit.value = 0
    workspacePath.value = process.cwd()
    db = createDatabase()
  })

  afterEach(() => {
    db.close()
  })

  it('runs typecheck, lint, test, and build for a passing fix', async () => {
    mockExitCodes([0, 0, 0, 0])
    const emit = vi.fn()
    const { runVerification, getVerificationRuns } = await import('../self-heal/verifier')

    const result = await runVerification('report-1', emit, 'run-pass')

    expect(result.status).toBe('success')
    expect(result.runId).toBe('run-pass')
    expect(result.steps.map((step) => [step.command, step.status])).toEqual([
      ['typecheck', 'success'],
      ['lint', 'success'],
      ['test', 'success'],
      ['build', 'success'],
    ])
    expect(spawnMock.mock.calls.map((call) => call[1])).toEqual([
      ['run', 'typecheck'],
      ['run', 'lint'],
      ['run', 'test'],
      ['run', 'build'],
    ])
    expect(getVerificationRuns('report-1')[0]).toEqual(expect.objectContaining({ id: 'run-pass', status: 'success' }))
  })

  it('retries a failing verification and appends failure context', async () => {
    retryLimit.value = 1
    mockExitCodes([1, 1])
    const emit = vi.fn()
    const reinvestigate = vi.fn().mockResolvedValue(undefined)
    const { runVerification, getVerificationRuns } = await import('../self-heal/verifier')

    const result = await runVerification('report-1', emit, 'run-fail', reinvestigate)

    expect(result.status).toBe('failed')
    expect(result.retryCount).toBe(1)
    expect(result.steps.map((step) => [step.command, step.status])).toEqual([
      ['typecheck', 'failed'],
      ['lint', 'skipped'],
      ['test', 'skipped'],
      ['build', 'skipped'],
    ])
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(reinvestigate).toHaveBeenCalledTimes(1)
    expect(getVerificationRuns('report-1')).toHaveLength(2)
    expect(
      db.prepare('SELECT investigation_markdown FROM error_reports WHERE id = ?').get('report-1'),
    ).toEqual({
      investigation_markdown: expect.stringContaining('## Verification failure context'),
    })
  })
})
