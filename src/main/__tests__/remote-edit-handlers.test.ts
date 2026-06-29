import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const { safeHandlers, mockRunInvestigation } = vi.hoisted(() => ({
  safeHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  mockRunInvestigation: vi.fn(),
}))

vi.mock('../safe-handle', () => ({
  safeHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    safeHandlers.set(channel, handler)
  }),
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
}))

vi.mock('../remote-edit/verifier', () => ({
  emitVerificationEvent: vi.fn(),
  getVerificationRuns: vi.fn(() => []),
  runVerification: vi.fn(),
}))

vi.mock('../remote-edit/history', () => ({
  getOrCreateHistoryEntry: vi.fn(),
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
