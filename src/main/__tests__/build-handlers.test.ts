import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

// ---------------------------------------------------------------------------
// Mock electron, database, and safe-handle before importing the module
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class {},
}))

vi.mock('../database', () => ({
  getDatabase: vi.fn(),
}))

vi.mock('../safe-handle', () => ({
  safeHandle: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const openDatabases: Database.Database[] = []

function createDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initializeBaseSchema(db)
  runMigrations(db)
  openDatabases.push(db)
  return db
}

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close()
  }
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests: getWorkspaceInfo
// ---------------------------------------------------------------------------

describe('getWorkspaceInfo', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createDatabase()
  })

  it('returns git metadata when inside a git repo', async () => {
    // Use the actual project directory which is a git repo
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run(process.cwd())

    const { getWorkspaceInfo } = await import('../build-handlers')
    const info = getWorkspaceInfo(db)

    expect(info.isGitRepo).toBe(true)
    expect(info.path).toBe(process.cwd())
    expect(info.branch).toBeTruthy()
    expect(info.commitSha).toBeTruthy()
    expect(typeof info.dirty).toBe('boolean')
  })

  it('returns isGitRepo false when workspace is not a git repo', async () => {
    // Use the OS temp directory which is never a git repo
    const tmpDir = require('os').tmpdir() as string
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run(tmpDir)

    const { getWorkspaceInfo } = await import('../build-handlers')
    const info = getWorkspaceInfo(db)

    expect(info.isGitRepo).toBe(false)
    expect(info.branch).toBeNull()
    expect(info.commitSha).toBeNull()
    expect(info.dirty).toBe(false)
  })

  it('respects build_workspace_path setting', async () => {
    const tmpDir = require('os').tmpdir() as string
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run(tmpDir)

    const { getWorkspaceInfo } = await import('../build-handlers')
    const info = getWorkspaceInfo(db)

    expect(info.path).toBe(tmpDir)
  })

  it('falls back to process.cwd() when no setting is stored', async () => {
    const { getWorkspaceInfo } = await import('../build-handlers')
    const info = getWorkspaceInfo(db)

    expect(info.path).toBe(process.cwd())
  })
})

// ---------------------------------------------------------------------------
// Tests: build_records migration (v21)
// ---------------------------------------------------------------------------

describe('build_records migration', () => {
  it('creates the build_records table after migration v21', () => {
    const db = createDatabase()
    openDatabases.push(db)

    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='build_records'")
      .get() as { name: string } | undefined

    expect(row?.name).toBe('build_records')

    // Verify all expected columns exist
    const columns = db.prepare("PRAGMA table_info(build_records)").all() as { name: string }[]
    const columnNames = columns.map((c) => c.name)
    expect(columnNames).toContain('id')
    expect(columnNames).toContain('workspace_path')
    expect(columnNames).toContain('commit_sha')
    expect(columnNames).toContain('branch')
    expect(columnNames).toContain('version')
    expect(columnNames).toContain('platform')
    expect(columnNames).toContain('command')
    expect(columnNames).toContain('status')
    expect(columnNames).toContain('exit_code')
    expect(columnNames).toContain('artifact_paths')
    expect(columnNames).toContain('log_tail')
    expect(columnNames).toContain('started_at')
    expect(columnNames).toContain('finished_at')
  })

  it('can insert and query build records', () => {
    const db = createDatabase()
    openDatabases.push(db)

    db.prepare(
      `INSERT INTO build_records
        (id, workspace_path, commit_sha, branch, version, platform, command, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('build-1', '/workspace', 'abc1234', 'main', '0.9.0', 'win32', 'typecheck', 'running', Date.now())

    const row = db.prepare('SELECT * FROM build_records WHERE id = ?').get('build-1') as Record<string, unknown>
    expect(row).toBeDefined()
    expect(row.status).toBe('running')
    expect(row.command).toBe('typecheck')

    db.prepare("UPDATE build_records SET status = 'success', exit_code = 0, finished_at = ? WHERE id = ?").run(Date.now(), 'build-1')
    const updated = db.prepare('SELECT status FROM build_records WHERE id = ?').get('build-1') as { status: string }
    expect(updated.status).toBe('success')
  })
})
