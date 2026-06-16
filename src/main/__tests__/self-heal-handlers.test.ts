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

vi.mock('../self-heal/investigator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../self-heal/investigator')>()
  return {
    ...actual,
    runInvestigation: mockRunInvestigation,
  }
})

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

describe('self-heal handlers', () => {
  beforeEach(() => {
    safeHandlers.clear()
    vi.resetModules()
    mockRunInvestigation.mockReset()
    db = createDatabase()
  })

  afterEach(() => {
    db.close()
  })

  it('persists and reads investigation settings', async () => {
    const { registerSelfHealHandlers } = await import('../self-heal-handlers')
    registerSelfHealHandlers()

    const saved = invoke('self-heal:set-investigation-settings', {
      backend: 'claude-cli',
      model: 'claude-sonnet-4-6',
      retryLimit: 3,
      autoApproveTools: false,
    })
    const loaded = invoke('self-heal:get-investigation-settings')

    expect(saved).toEqual({
      backend: 'claude-cli',
      model: 'claude-sonnet-4-6',
      retryLimit: 3,
      autoApproveTools: false,
    })
    expect(loaded).toEqual(saved)
  })

  it('persists codex-cli investigation settings', async () => {
    const { registerSelfHealHandlers } = await import('../self-heal-handlers')
    registerSelfHealHandlers()

    const saved = invoke('self-heal:set-investigation-settings', {
      backend: 'codex-cli',
      model: 'gpt-5.5',
      retryLimit: 2,
      autoApproveTools: true,
    })
    const loaded = invoke('self-heal:get-investigation-settings')

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
    const { registerSelfHealHandlers } = await import('../self-heal-handlers')
    registerSelfHealHandlers(mainWindow as never)

    expect(await invoke('self-heal:start-investigation', 'report-1')).toEqual({ reportId: 'report-1' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRunInvestigation).toHaveBeenCalled()
    expect(sends).toContainEqual([
      'self-heal:investigation-done',
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
    const { registerSelfHealHandlers } = await import('../self-heal-handlers')
    registerSelfHealHandlers()

    const updated = invoke<{ id: string; status: string } | null>('self-heal:set-report-status', 'report-1', 'rejected')

    expect(updated).toEqual(expect.objectContaining({ id: 'report-1', status: 'rejected' }))
  })
})
