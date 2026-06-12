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

vi.mock('electron-updater', () => ({
  default: { autoUpdater: { setFeedURL: vi.fn() } },
}))

vi.mock('../database', () => ({
  getDatabase: vi.fn(),
}))

vi.mock('../safe-handle', () => ({
  safeHandle: vi.fn(),
}))

vi.mock('../local-feed-server', () => ({
  startFeedServer: vi.fn().mockResolvedValue(0),
  stopFeedServer: vi.fn(),
  getFeedUrl: vi.fn().mockReturnValue(''),
  getFeedPort: vi.fn().mockReturnValue(0),
  isFeedRunning: vi.fn().mockReturnValue(false),
  getFeedDir: vi.fn().mockReturnValue(''),
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
    const { execSync } = await import('child_process')
    const { mkdirSync, rmSync, writeFileSync } = await import('fs')
    const { join } = await import('path')
    const tmpDir = require('os').tmpdir() as string
    const repoDir = join(tmpDir, `nexy-build-git-${Date.now()}`)

    mkdirSync(repoDir, { recursive: true })
    execSync('git init', { cwd: repoDir, stdio: 'ignore' })
    execSync('git config user.email test@example.com', { cwd: repoDir, stdio: 'ignore' })
    execSync('git config user.name Test', { cwd: repoDir, stdio: 'ignore' })
    writeFileSync(join(repoDir, 'package.json'), JSON.stringify({ version: '1.2.3' }))
    execSync('git add package.json', { cwd: repoDir, stdio: 'ignore' })
    execSync('git commit -m init', { cwd: repoDir, stdio: 'ignore' })
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run(repoDir)

    try {
      const { getWorkspaceInfo } = await import('../build-handlers')
      const info = await getWorkspaceInfo(db)

      expect(info.isGitRepo).toBe(true)
      expect(info.path).toBe(repoDir)
      expect(info.branch).toBeTruthy()
      expect(info.commitSha).toBeTruthy()
      expect(typeof info.dirty).toBe('boolean')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  it('returns isGitRepo false when workspace is not a git repo', async () => {
    // Use the OS temp directory which is never a git repo
    const tmpDir = require('os').tmpdir() as string
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run(tmpDir)

    const { getWorkspaceInfo } = await import('../build-handlers')
    const info = await getWorkspaceInfo(db)

    expect(info.isGitRepo).toBe(false)
    expect(info.branch).toBeNull()
    expect(info.commitSha).toBeNull()
    expect(info.dirty).toBe(false)
  })

  it('respects build_workspace_path setting', async () => {
    const tmpDir = require('os').tmpdir() as string
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run(tmpDir)

    const { getWorkspaceInfo } = await import('../build-handlers')
    const info = await getWorkspaceInfo(db)

    expect(info.path).toBe(tmpDir)
  })

  it('falls back to process.cwd() when no setting is stored', async () => {
    const { getWorkspaceInfo } = await import('../build-handlers')
    const info = await getWorkspaceInfo(db)

    expect(info.path).toBe(process.cwd())
  })
})

// ---------------------------------------------------------------------------
// Tests: build_records migration
// ---------------------------------------------------------------------------

describe('build_records migration', () => {
  it('creates the build_records table with artifact metadata columns', () => {
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
    expect(columnNames).toContain('version_code')
    expect(columnNames).toContain('artifact_paths')
    expect(columnNames).toContain('artifact_checksums')
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
