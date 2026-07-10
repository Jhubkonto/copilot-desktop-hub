import { EventEmitter } from 'events'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const { spawnMock, workspacePath, retryLimit, broadcastToMobileMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  workspacePath: { value: process.cwd() },
  retryLimit: { value: 0 },
  broadcastToMobileMock: vi.fn(),
}))

vi.mock('child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('electron', () => ({
  BrowserWindow: class {},
}))

vi.mock('../ws-server', () => ({
  broadcastToMobile: broadcastToMobileMock,
}))

vi.mock('../remote-edit/investigator', () => ({
  getWorkspacePathForReport: () => workspacePath.value,
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
    ) VALUES ('report-1', 'Bug', '', NULL, NULL, 'completed', NULL, NULL, NULL, 'Investigation', 1, 1)`,
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

describe('remote-edit verifier', () => {
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
    const { runVerification, getVerificationRuns } = await import('../remote-edit/verifier')

    const result = await runVerification('report-1', emit, 'run-pass')

    expect(result.status).toBe('success')
    expect(result.runId).toBe('run-pass')
    expect(result.steps.map((step) => [step.command, step.status])).toEqual([
      ['typecheck', 'success'],
      ['lint', 'success'],
      ['test', 'success'],
      ['build', 'success'],
    ])
    expect(spawnMock.mock.calls.map((call) => call[0])).toEqual([
      'npm run typecheck',
      'npm run lint',
      'npm run test',
      'npm run build',
    ])
    expect(spawnMock.mock.calls.every((call) => Array.isArray(call[1]) && call[1].length === 0)).toBe(true)
    expect(getVerificationRuns('report-1')[0]).toEqual(expect.objectContaining({ id: 'run-pass', status: 'success' }))
  })

  it("uses a project's configured verify commands instead of the npm default set", async () => {
    db.prepare(
      `INSERT INTO projects (id, name, color, config_json, created_at, updated_at) VALUES ('proj-1', 'Proj', 'blue', ?, 1, 1)`,
    ).run(
      JSON.stringify({
        verifyCommands: [
          { id: 'compile', label: 'Compile', command: 'pnpm compile' },
          { id: 'lint', label: 'Lint', command: 'pnpm lint' },
        ],
      }),
    )
    db.prepare(`UPDATE error_reports SET project_id = 'proj-1' WHERE id = 'report-1'`).run()
    mockExitCodes([0, 0])
    const emit = vi.fn()
    const { runVerification } = await import('../remote-edit/verifier')

    const result = await runVerification('report-1', emit, 'run-custom')

    expect(result.status).toBe('success')
    expect(result.steps.map((step) => [step.command, step.status])).toEqual([
      ['compile', 'success'],
      ['lint', 'success'],
    ])
    expect(spawnMock.mock.calls.map((call) => call[0])).toEqual(['pnpm compile', 'pnpm lint'])
  })

  it('re-investigates a failing verification for diagnosis but does not automatically re-run the same checks', async () => {
    // Regression: this used to loop back into a second identical verify attempt against the
    // same already-applied files after reinvestigate(), which can only ever fail identically
    // since nothing regenerates or re-applies the patch in between — see the comment above the
    // `break` in runVerificationInner. A failed verification is now always terminal; the human
    // must manually regenerate/re-review/re-apply the patch before verifying again.
    retryLimit.value = 1
    mockExitCodes([1])
    const emit = vi.fn()
    const reinvestigate = vi.fn().mockResolvedValue(undefined)
    const { runVerification, getVerificationRuns } = await import('../remote-edit/verifier')

    const result = await runVerification('report-1', emit, 'run-fail', reinvestigate)

    expect(result.status).toBe('failed')
    expect(result.retryCount).toBe(0)
    expect(result.steps.map((step) => [step.command, step.status])).toEqual([
      ['typecheck', 'failed'],
      ['lint', 'skipped'],
      ['test', 'skipped'],
      ['build', 'skipped'],
    ])
    // Only one npm invocation total (the single typecheck attempt) — no second verify pass.
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(reinvestigate).toHaveBeenCalledTimes(1)
    expect(getVerificationRuns('report-1')).toHaveLength(1)
    expect(
      db.prepare('SELECT investigation_markdown FROM error_reports WHERE id = ?').get('report-1'),
    ).toEqual({
      investigation_markdown: expect.stringContaining('## Verification failure context'),
    })
  })

  it('does not re-investigate when no retries are configured', async () => {
    retryLimit.value = 0
    mockExitCodes([1])
    const emit = vi.fn()
    const reinvestigate = vi.fn().mockResolvedValue(undefined)
    const { runVerification } = await import('../remote-edit/verifier')

    const result = await runVerification('report-1', emit, 'run-fail', reinvestigate)

    expect(result.status).toBe('failed')
    expect(reinvestigate).not.toHaveBeenCalled()
  })

  it('recovers a verification run stuck mid-command from a previous crash', async () => {
    // Regression: activeVerificationRuns (in-memory) is always empty on a fresh process, so a
    // run row still at status='running' was interrupted by a crash/restart, not an
    // actually-running check — it used to stay stuck "running" forever with no way to retry.
    const steps = [
      { command: 'typecheck', status: 'success', exitCode: 0, log: '', startedAt: 1, completedAt: 2 },
      { command: 'lint', status: 'running', exitCode: null, log: '', startedAt: 3, completedAt: null },
      { command: 'test', status: 'pending', exitCode: null, log: '', startedAt: null, completedAt: null },
      { command: 'build', status: 'pending', exitCode: null, log: '', startedAt: null, completedAt: null },
    ]
    db.prepare(
      `INSERT INTO remote_edit_verification_runs
        (id, report_id, status, steps_json, started_at, completed_at, retry_count, error)
       VALUES ('run-stuck', 'report-1', 'running', ?, 1, NULL, 0, NULL)`,
    ).run(JSON.stringify(steps))

    const { recoverStuckVerificationRuns, getVerificationRuns } = await import('../remote-edit/verifier')
    recoverStuckVerificationRuns()

    const run = getVerificationRuns('report-1').find((r) => r.id === 'run-stuck')
    expect(run?.status).toBe('failed')
    expect(run?.error).toContain('closed or restarted')
    expect(run?.steps.map((s) => [s.command, s.status])).toEqual([
      ['typecheck', 'success'],
      ['lint', 'skipped'],
      ['test', 'skipped'],
      ['build', 'skipped'],
    ])
  })
})

describe('emitVerificationEvent', () => {
  beforeEach(() => {
    broadcastToMobileMock.mockReset()
  })

  it('translates the desktop remote-edit:* channel to the self-heal:* name Android recognizes', async () => {
    const { emitVerificationEvent } = await import('../remote-edit/verifier')
    const win = { isDestroyed: () => false, webContents: { send: vi.fn() } }

    emitVerificationEvent(win as never, 'remote-edit:verification-done', { reportId: 'r1', status: 'success' })

    expect(broadcastToMobileMock).toHaveBeenCalledWith({
      event: 'self-heal:verification-done',
      data: { reportId: 'r1', status: 'success' },
    })
    expect(win.webContents.send).toHaveBeenCalledWith('remote-edit:verification-done', { reportId: 'r1', status: 'success' })
  })
})
