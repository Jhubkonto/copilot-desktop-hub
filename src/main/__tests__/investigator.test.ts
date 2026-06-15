import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const { sendProviderWithToolsMock } = vi.hoisted(() => ({
  sendProviderWithToolsMock: vi.fn(),
}))

vi.mock('../providers', () => ({
  getProviderForAgent: vi.fn(() => ({ provider: 'openai', model: 'gpt-5-mini' })),
  getApiKey: vi.fn(() => 'sk-test'),
  sendProviderWithTools: sendProviderWithToolsMock,
}))

vi.mock('../ws-server', () => ({
  broadcastToMobile: vi.fn(),
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

describe('self-heal investigator', () => {
  beforeEach(() => {
    vi.resetModules()
    sendProviderWithToolsMock.mockReset()
    db = createDatabase()
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run(process.cwd())
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('self_heal_backend', 'byok')").run()
    db.prepare(
      `INSERT INTO error_reports (
        id, title, description, screenshot_path, log_snapshot, status,
        app_version, platform, os_version, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, 'open', '0.9.0-test', 'test', 'test', 1, 1)`,
    ).run('report-1', 'Synthetic failure', 'Something failed', '[{"message":"boom"}]')
  })

  afterEach(() => {
    db.close()
  })

  it('runs a synthetic investigation and persists structured markdown', async () => {
    sendProviderWithToolsMock.mockResolvedValue({
      content: [
        '---',
        'confidence: high',
        'root_cause: missing guard',
        'affected_files: ["src/main/example.ts"]',
        '---',
        '',
        '# Summary',
        'The report points at a missing guard.',
      ].join('\n'),
      toolCalls: [],
      model: 'gpt-5-mini',
    })
    const { runInvestigation } = await import('../self-heal/investigator')
    const chunks: string[] = []
    const result = await runInvestigation(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as never,
      'report-1',
      {
        onChunk: (chunk) => chunks.push(chunk),
        onActivity: vi.fn(),
      },
    )

    const row = db.prepare('SELECT status, investigation_markdown, investigation_root_cause FROM error_reports WHERE id = ?').get('report-1') as Record<string, unknown>
    expect(result).toEqual(expect.objectContaining({
      reportId: 'report-1',
      status: 'done',
      confidence: 'high',
      rootCause: 'missing guard',
      affectedFiles: ['src/main/example.ts'],
    }))
    expect(chunks.join('')).toContain('# Summary')
    expect(row).toEqual(expect.objectContaining({
      status: 'investigated',
      investigation_root_cause: 'missing guard',
    }))
    expect(String(row.investigation_markdown)).toContain('confidence: high')
  })
})
