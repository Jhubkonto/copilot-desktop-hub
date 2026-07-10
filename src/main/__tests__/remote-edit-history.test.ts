import Database from 'better-sqlite3'
import { execFileSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: false, relaunch: vi.fn(), exit: vi.fn() },
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, spawn: spawnMock }
})

vi.mock('../ws-server', () => ({ broadcastToMobile: vi.fn() }))

let db: Database.Database

vi.mock('../database', () => ({ getDatabase: () => db }))

const testRoot = path.join(process.cwd(), '.test-remote-edit-history')
const workspacePath = path.join(testRoot, 'workspace')

function createDatabase(): Database.Database {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  initializeBaseSchema(database)
  runMigrations(database)
  database.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run(workspacePath)
  database.prepare(
    `INSERT INTO error_reports
     (id, title, description, status, fix_status, investigation_affected_files, fix_staged_files, created_at, updated_at)
     VALUES ('report-h1', 'History test report', '', 'investigated', 'applied',
             '[]', '[]', 1, 1)`,
  ).run()
  return database
}

describe('remote_edit_history table', () => {
  beforeEach(() => {
    vi.resetModules()
    rmSync(testRoot, { recursive: true, force: true })
    mkdirSync(path.join(workspacePath, 'src'), { recursive: true })
    execFileSync('git', ['init'], { cwd: workspacePath, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.email', 'nexy@example.test'], { cwd: workspacePath, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.name', 'Nexy Test'], { cwd: workspacePath, stdio: 'pipe' })
    writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ version: '1.0.0' }))
    execFileSync('git', ['add', '.'], { cwd: workspacePath, stdio: 'pipe' })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: workspacePath, stdio: 'pipe' })
    db = createDatabase()
  })

  afterEach(() => {
    db.close()
    rmSync(testRoot, { recursive: true, force: true })
  })

  it('creates a new history entry for a report', async () => {
    const { getOrCreateHistoryEntry } = await import('../remote-edit/history')
    const entry = getOrCreateHistoryEntry('report-h1')

    expect(entry.reportId).toBe('report-h1')
    expect(entry.reportTitle).toBe('History test report')
    expect(entry.status).toBe('investigating')
    expect(entry.verificationPassed).toBe(false)
    expect(entry.committed).toBe(false)
    expect(entry.reloaded).toBe(false)
    expect(entry.rolledBack).toBe(false)
  })

  it('returns the same entry on repeated getOrCreate calls', async () => {
    const { getOrCreateHistoryEntry } = await import('../remote-edit/history')
    const first = getOrCreateHistoryEntry('report-h1')
    const second = getOrCreateHistoryEntry('report-h1')
    expect(first.id).toBe(second.id)
  })

  it('getHistoryEntryForReport is a pure read — returns null instead of creating a row, unlike getOrCreateHistoryEntry', async () => {
    const { getHistoryEntryForReport } = await import('../remote-edit/history')

    expect(getHistoryEntryForReport('report-h1')).toBeNull()
    expect(db.prepare('SELECT COUNT(*) AS count FROM remote_edit_history WHERE report_id = ?').get('report-h1')).toEqual({ count: 0 })
  })

  it('getHistoryEntryForReport reflects a persisted commit — the source of truth for the phase bar\'s Committed state', async () => {
    const { getOrCreateHistoryEntry, updateHistoryEntry, getHistoryEntryForReport } = await import('../remote-edit/history')
    getOrCreateHistoryEntry('report-h1')
    updateHistoryEntry('report-h1', { committed: true, commitSha: 'abc123', status: 'committed' })

    const entry = getHistoryEntryForReport('report-h1')
    expect(entry?.committed).toBe(true)
    expect(entry?.commitSha).toBe('abc123')
  })

  it('updates history fields via updateHistoryEntry', async () => {
    const { getOrCreateHistoryEntry, updateHistoryEntry, listHistory } = await import('../remote-edit/history')
    getOrCreateHistoryEntry('report-h1')

    updateHistoryEntry('report-h1', {
      investigationModel: 'claude-sonnet-4-6',
      investigationBackend: 'byok',
      verificationPassed: true,
      committed: true,
      commitSha: 'abc123',
      status: 'committed',
    })

    const entries = listHistory()
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    expect(entry.investigationModel).toBe('claude-sonnet-4-6')
    expect(entry.investigationBackend).toBe('byok')
    expect(entry.verificationPassed).toBe(true)
    expect(entry.committed).toBe(true)
    expect(entry.commitSha).toBe('abc123')
    expect(entry.status).toBe('committed')
  })

  it('updateHistoryEntry creates entry if none exists', async () => {
    const { updateHistoryEntry, listHistory } = await import('../remote-edit/history')

    updateHistoryEntry('report-h1', { status: 'verified', verificationPassed: true })

    const entries = listHistory()
    expect(entries).toHaveLength(1)
    expect(entries[0].status).toBe('verified')
    expect(entries[0].verificationPassed).toBe(true)
  })

  it('listHistory returns entries in descending createdAt order', async () => {
    db.prepare(
      `INSERT INTO error_reports
       (id, title, description, status, fix_status, investigation_affected_files, fix_staged_files, created_at, updated_at)
       VALUES ('report-h2', 'Second report', '', 'investigated', 'none', '[]', '[]', 2, 2)`,
    ).run()

    const { getOrCreateHistoryEntry, listHistory } = await import('../remote-edit/history')
    // Insert in order: h2 first (older timestamp hack), then h1
    getOrCreateHistoryEntry('report-h2')
    // Bump updated_at to make h1 more recent
    db.prepare("UPDATE remote_edit_history SET created_at = 999 WHERE report_id = 'report-h2'").run()
    getOrCreateHistoryEntry('report-h1')
    db.prepare("UPDATE remote_edit_history SET created_at = 1000 WHERE report_id = 'report-h1'").run()

    const entries = listHistory()
    expect(entries.length).toBeGreaterThanOrEqual(2)
    expect(entries[0].createdAt).toBeGreaterThanOrEqual(entries[1].createdAt)
  })

  it('marks rolledBack in history on rollbackHeal', async () => {
    const { EventEmitter } = await import('events')
    spawnMock.mockReset()

    const child = new EventEmitter() as InstanceType<typeof EventEmitter> & { stdout: InstanceType<typeof EventEmitter>; stderr: InstanceType<typeof EventEmitter> }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    spawnMock.mockReturnValue(child)

    // Set up a staged file with backup
    writeFileSync(path.join(testRoot, 'backup-file.ts'), 'export const old = 1\n', 'utf8')
    db.prepare(
      `UPDATE error_reports SET fix_staged_files = ? WHERE id = 'report-h1'`,
    ).run(
      JSON.stringify([{
        relativePath: 'src/file.ts',
        stagingPath: '',
        backupPath: path.join(testRoot, 'backup-file.ts'),
        diffLineCount: 1,
        reviewed: true,
      }]),
    )

    // Insert recovery run manually
    db.prepare(
      `INSERT INTO remote_edit_recovery_runs
       (id, report_id, status, backup_manifest_json, pre_reload_state_json, created_at, updated_at)
       VALUES ('rec-1', 'report-h1', 'reloading',
         ?, '{}', 1, 1)`,
    ).run(JSON.stringify([{
      relativePath: 'src/file.ts',
      stagingPath: '',
      backupPath: path.join(testRoot, 'backup-file.ts'),
    }]))

    const { getOrCreateHistoryEntry, listHistory } = await import('../remote-edit/history')
    getOrCreateHistoryEntry('report-h1')

    const { rollbackHeal } = await import('../remote-edit/recovery')
    const result = await rollbackHeal('rec-1')

    expect(result.rolledBack).toBe(true)
    const entries = listHistory()
    expect(entries[0].rolledBack).toBe(true)
    expect(entries[0].status).toBe('rolled-back')
  }, 15000)
})
