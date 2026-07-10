import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const { safeHandlers, mockRunInvestigation, broadcastToMobileMock, mockGetHistoryEntryForReport } = vi.hoisted(() => ({
  safeHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  mockRunInvestigation: vi.fn(),
  broadcastToMobileMock: vi.fn(),
  mockGetHistoryEntryForReport: vi.fn((_reportId: string): { reportId: string; committed: boolean; commitSha: string | null } | null => null),
}))

vi.mock('../safe-handle', () => ({
  safeHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    safeHandlers.set(channel, handler)
  }),
}))

vi.mock('../ws-server', () => ({
  broadcastToMobile: broadcastToMobileMock,
}))

vi.mock('electron', () => ({
  Notification: {
    isSupported: vi.fn(() => false),
  },
}))

vi.mock('../remote-edit/investigator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../remote-edit/investigator')>()
  return {
    ...actual,
    runInvestigation: mockRunInvestigation,
  }
})

vi.mock('../remote-edit/fix-agent', () => ({
  emitFixEvent: vi.fn(),
  getBackupDir: vi.fn(() => '.test-backups'),
  runFix: vi.fn(),
  recoverStuckFixRuns: vi.fn(),
}))

vi.mock('../remote-edit/verifier', () => ({
  emitVerificationEvent: vi.fn(),
  getVerificationRuns: vi.fn(() => []),
  runVerification: vi.fn(),
  recoverStuckVerificationRuns: vi.fn(),
}))

vi.mock('../remote-edit/history', () => ({
  getOrCreateHistoryEntry: vi.fn(),
  getHistoryEntryForReport: mockGetHistoryEntryForReport,
  listHistory: vi.fn(() => []),
  updateHistoryEntry: vi.fn(),
}))

vi.mock('../fcm-sender', () => ({
  sendRemoteEditNotification: vi.fn(),
}))

const getRemoteEditAuditDiff = vi.fn()

let db: Database.Database

vi.mock('../database', () => ({
  getDatabase: () => db,
}))

vi.mock('../project-audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../project-audit')>()
  return {
    ...actual,
    getRemoteEditAuditDiff,
  }
})

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

describe('remote-edit handlers', () => {
  beforeEach(() => {
    safeHandlers.clear()
    vi.resetModules()
    mockRunInvestigation.mockReset()
    broadcastToMobileMock.mockReset()
    mockGetHistoryEntryForReport.mockReset()
    mockGetHistoryEntryForReport.mockReturnValue(null)
    getRemoteEditAuditDiff.mockReset()
    getRemoteEditAuditDiff.mockReturnValue(null)
    db = createDatabase()
  })

  afterEach(() => {
    db.close()
  })

  it('persists and reads investigation settings', async () => {
    const { registerRemoteEditHandlers } = await import('../remote-edit-handlers')
    registerRemoteEditHandlers()

    const saved = invoke('remote-edit:set-investigation-settings', {
      backend: 'claude-cli',
      model: 'claude-sonnet-4-6',
      retryLimit: 3,
      autoApproveTools: false,
    })
    const loaded = invoke('remote-edit:get-investigation-settings')

    expect(saved).toEqual({
      backend: 'claude-cli',
      model: 'claude-sonnet-4-6',
      retryLimit: 3,
      autoApproveTools: false,
    })
    expect(loaded).toEqual(saved)
  }, 15000)

  it('persists codex-cli investigation settings', async () => {
    const { registerRemoteEditHandlers } = await import('../remote-edit-handlers')
    registerRemoteEditHandlers()

    const saved = invoke('remote-edit:set-investigation-settings', {
      backend: 'codex-cli',
      model: 'gpt-5.5',
      retryLimit: 2,
      autoApproveTools: true,
    })
    const loaded = invoke('remote-edit:get-investigation-settings')

    expect(saved).toEqual({
      backend: 'codex-cli',
      model: 'gpt-5.5',
      retryLimit: 2,
      autoApproveTools: true,
    })
    expect(loaded).toEqual(saved)
  })

  it('starts an investigation asynchronously and emits completion', async () => {
    mockRunInvestigation.mockResolvedValue({
      reportId: 'report-1',
      status: 'done',
      markdown: '---\nconfidence: high\nroot_cause: test\naffected_files: []\n---\nDone',
      confidence: 'high',
      rootCause: 'test',
      affectedFiles: [],
      completedAt: 1000,
    })
    const sends: Array<[string, unknown]> = []
    const mainWindow = {
      isDestroyed: () => false,
      webContents: { send: (channel: string, payload: unknown) => sends.push([channel, payload]) },
    }
    const { registerRemoteEditHandlers } = await import('../remote-edit-handlers')
    registerRemoteEditHandlers(mainWindow as never)

    expect(await invoke('remote-edit:start-investigation', 'report-1')).toEqual({ reportId: 'report-1' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRunInvestigation).toHaveBeenCalled()
    expect(sends).toContainEqual([
      'remote-edit:investigation-done',
      expect.objectContaining({ reportId: 'report-1', status: 'done' }),
    ])
  })

  it('reports an active investigation under its project and clears it on completion', async () => {
    db.prepare(
      `INSERT INTO error_reports (
        id, title, description, screenshot_path, log_snapshot, status,
        app_version, platform, os_version, project_id, created_at, updated_at
      ) VALUES ('report-1', 'Bug', '', NULL, NULL, 'open', NULL, NULL, NULL, 'project-1', 1, 1)`,
    ).run()

    let resolveInvestigation: (result: unknown) => void = () => {}
    mockRunInvestigation.mockReturnValue(new Promise((resolve) => { resolveInvestigation = resolve }))

    const sends: Array<[string, unknown]> = []
    const mainWindow = {
      isDestroyed: () => false,
      webContents: { send: (channel: string, payload: unknown) => sends.push([channel, payload]) },
    }
    const { registerRemoteEditHandlers } = await import('../remote-edit-handlers')
    registerRemoteEditHandlers(mainWindow as never)

    await invoke('remote-edit:start-investigation', 'report-1')

    expect(invoke('remote-edit:get-active-code-changes')).toEqual({ 'project-1': 1 })
    expect(sends).toContainEqual(['remote-edit:active-code-changes-changed', { 'project-1': 1 }])
    expect(broadcastToMobileMock).toHaveBeenCalledWith({
      event: 'self-heal:active-code-changes-changed',
      data: { 'project-1': 1 },
    })

    resolveInvestigation({
      reportId: 'report-1',
      status: 'done',
      markdown: '---\nconfidence: high\nroot_cause: test\naffected_files: []\n---\nDone',
      confidence: 'high',
      rootCause: 'test',
      affectedFiles: [],
      completedAt: 1000,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(invoke('remote-edit:get-active-code-changes')).toEqual({})
    expect(sends).toContainEqual(['remote-edit:active-code-changes-changed', {}])
    expect(broadcastToMobileMock).toHaveBeenCalledWith({
      event: 'self-heal:active-code-changes-changed',
      data: {},
    })
  })

  it('recovers a plan stuck mid-investigation from a previous crash, but leaves a healthy awaiting-review plan alone', async () => {
    // Regression: activeInvestigations (in-memory) is always empty on a fresh process, so a
    // row still at status='investigating' with no investigation_markdown was interrupted by a
    // crash/restart, not an actually-running plan — CodeChangeDetailView.tsx's resumedInBackground
    // guard used to disable the Plan button forever in this state with no way to retry.
    db.prepare(
      `INSERT INTO error_reports (
        id, title, description, screenshot_path, log_snapshot, status,
        app_version, platform, os_version, created_at, updated_at
      ) VALUES ('stuck-1', 'Interrupted plan', '', NULL, NULL, 'investigating', NULL, NULL, NULL, 1, 1)`,
    ).run()
    // A healthy plan mid-review (real markdown already produced, just awaiting human Accept)
    // must not be touched by the sweep even though its status is also 'investigating'.
    db.prepare(
      `INSERT INTO error_reports (
        id, title, description, screenshot_path, log_snapshot, status,
        investigation_markdown, app_version, platform, os_version, created_at, updated_at
      ) VALUES ('healthy-1', 'Ready for review', '', NULL, NULL, 'investigating', '# Plan\nDo the thing.', NULL, NULL, NULL, 1, 1)`,
    ).run()

    const { registerRemoteEditHandlers } = await import('../remote-edit-handlers')
    registerRemoteEditHandlers()

    const stuck = db.prepare('SELECT status, investigation_root_cause, investigation_markdown FROM error_reports WHERE id = ?').get('stuck-1') as Record<string, unknown>
    expect(stuck.status).toBe('open')
    expect(stuck.investigation_root_cause).toBe('investigation_failed')
    expect(String(stuck.investigation_markdown)).toContain('# Planning failed')

    const healthy = db.prepare('SELECT status, investigation_markdown FROM error_reports WHERE id = ?').get('healthy-1') as Record<string, unknown>
    expect(healthy.status).toBe('investigating')
    expect(healthy.investigation_markdown).toBe('# Plan\nDo the thing.')
  })

  it('updates report status for investigation review actions', async () => {
    db.prepare(
      `INSERT INTO error_reports (
        id, title, description, screenshot_path, log_snapshot, status,
        app_version, platform, os_version, created_at, updated_at
      ) VALUES ('report-1', 'Bug', '', NULL, NULL, 'investigated', NULL, NULL, NULL, 1, 1)`,
    ).run()
    const { registerRemoteEditHandlers } = await import('../remote-edit-handlers')
    registerRemoteEditHandlers()

    const updated = invoke<{ id: string; status: string } | null>('remote-edit:set-report-status', 'report-1', 'rejected')

    expect(updated).toEqual(expect.objectContaining({ id: 'report-1', status: 'rejected' }))
  })

  it('persists a marked-reviewed file so the state survives a reload instead of living only in renderer state', async () => {
    // Regression: RemoteEditStagedFileEntry.reviewed was written false at staging time and never
    // set true anywhere server-side — the "Apply to workspace" gate was computed purely from
    // local React state, discarded on remount. This exercises the actual write path.
    const staged = [
      { relativePath: 'src/App.tsx', stagingPath: '/tmp/a', backupPath: null, diffLineCount: 3, reviewed: false },
      { relativePath: 'src/other.tsx', stagingPath: '/tmp/b', backupPath: null, diffLineCount: 1, reviewed: false },
    ]
    db.prepare(
      `INSERT INTO error_reports (
        id, title, description, screenshot_path, log_snapshot, status,
        app_version, platform, os_version, fix_status, fix_staged_files, created_at, updated_at
      ) VALUES ('report-1', 'Change', '', NULL, NULL, 'investigated', NULL, NULL, NULL, 'staged', ?, 1, 1)`,
    ).run(JSON.stringify(staged))
    const { registerRemoteEditHandlers } = await import('../remote-edit-handlers')
    registerRemoteEditHandlers()

    const result = invoke<boolean>('remote-edit:mark-file-reviewed', 'report-1', 'src/App.tsx')

    expect(result).toBe(true)
    const row = db.prepare('SELECT fix_staged_files FROM error_reports WHERE id = ?').get('report-1') as { fix_staged_files: string }
    const updated = JSON.parse(row.fix_staged_files) as typeof staged
    expect(updated.find((f) => f.relativePath === 'src/App.tsx')?.reviewed).toBe(true)
    expect(updated.find((f) => f.relativePath === 'src/other.tsx')?.reviewed).toBe(false)
  })

  it('returns false when marking an unknown file or report as reviewed', async () => {
    const { registerRemoteEditHandlers } = await import('../remote-edit-handlers')
    registerRemoteEditHandlers()

    expect(invoke('remote-edit:mark-file-reviewed', 'missing-report', 'src/App.tsx')).toBe(false)
  })

  it('exposes the persisted history entry for a report over IPC, the source of truth CodeChangeCard uses for the Committed phase', async () => {
    const { registerRemoteEditHandlers } = await import('../remote-edit-handlers')
    registerRemoteEditHandlers()

    expect(invoke('remote-edit:get-history-for-report', 'report-1')).toBeNull()

    mockGetHistoryEntryForReport.mockReturnValue({ reportId: 'report-1', committed: true, commitSha: 'deadbee' })
    const entry = invoke<{ committed: boolean; commitSha: string } | null>('remote-edit:get-history-for-report', 'report-1')

    expect(mockGetHistoryEntryForReport).toHaveBeenCalledWith('report-1')
    expect(entry).toEqual(expect.objectContaining({ committed: true, commitSha: 'deadbee' }))
  })

  it('falls back to shared project audit diffs when staged diff rows are gone', async () => {
    const { registerRemoteEditHandlers } = await import('../remote-edit-handlers')
    registerRemoteEditHandlers()
    getRemoteEditAuditDiff.mockReturnValue({
      relativePath: 'src/App.tsx',
      hunks: [{ header: '@@ -1,1 +1,1 @@', lines: [] }],
    })

    const diff = invoke('remote-edit:get-staged-diff', 'report-1', 'src/App.tsx')

    expect(getRemoteEditAuditDiff).toHaveBeenCalledWith('report-1', 'src/App.tsx')
    expect(diff).toEqual({
      relativePath: 'src/App.tsx',
      hunks: [{ header: '@@ -1,1 +1,1 @@', lines: [] }],
    })
  })
})
