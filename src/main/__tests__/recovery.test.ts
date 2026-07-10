import Database from 'better-sqlite3'
import { execFileSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('../ws-server', () => ({
  broadcastToMobile: vi.fn(),
}))

let db: Database.Database

vi.mock('../database', () => ({
  getDatabase: () => db,
}))

const testRoot = path.join(process.cwd(), '.test-remote-edit-recovery')
const workspacePath = path.join(testRoot, 'workspace')

function removeTestRoot(): void {
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

function git(args: string[]) {
  execFileSync('git', args, { cwd: workspacePath, stdio: 'pipe' })
}

function createDatabase() {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  initializeBaseSchema(database)
  runMigrations(database)
  database.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run(workspacePath)
  database.prepare(
    `INSERT INTO error_reports (
      id, title, description, screenshot_path, log_snapshot, status,
      app_version, platform, os_version, investigation_markdown,
      fix_status, fix_staged_files, workspace_root, created_at, updated_at
    ) VALUES (?, 'Recovery test', '', NULL, NULL, 'completed', NULL, NULL, NULL, 'done', 'applied', ?, ?, 1, 1)`,
  ).run(
    'report-1',
    JSON.stringify([{ relativePath: 'src/example.ts', stagingPath: '', backupPath: path.join(testRoot, 'backup.ts'), diffLineCount: 1, reviewed: true }]),
    workspacePath,
  )
  database.prepare(
    `INSERT INTO remote_edit_verification_runs
      (id, report_id, status, steps_json, started_at, completed_at, retry_count, error)
     VALUES ('verify-1', 'report-1', 'success', '[]', 1, 2, 0, NULL)`,
  ).run()
  return database
}

describe('remote-edit recovery preparation', () => {
  beforeEach(() => {
    vi.resetModules()
    removeTestRoot()
    mkdirSync(path.join(workspacePath, 'src'), { recursive: true })
    execFileSync('git', ['init'], { cwd: workspacePath, stdio: 'pipe' })
    git(['config', 'user.email', 'nexy@example.test'])
    git(['config', 'user.name', 'Nexy Test'])
    writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ version: '0.9.1' }), 'utf8')
    writeFileSync(path.join(workspacePath, 'src', 'example.ts'), 'export const value = 2\n', 'utf8')
    git(['add', '.'])
    git(['commit', '-m', 'fix: remote-edit recovery test'])
    db = createDatabase()
  })

  afterEach(() => {
    db.close()
    removeTestRoot()
  })

  it('persists reload preparation metadata for an applied, verified, clean fix', async () => {
    const { prepareReload, getRecoveryRuns } = await import('../remote-edit/recovery')

    const result = await prepareReload('report-1')
    const runs = getRecoveryRuns('report-1')

    expect(result.canReload).toBe(true)
    expect(result.recovery).toEqual(expect.objectContaining({
      reportId: 'report-1',
      status: 'prepared',
      targetVersion: '0.9.1',
    }))
    expect(result.recovery?.backupManifest).toEqual([
      expect.objectContaining({ relativePath: 'src/example.ts', backupPath: expect.stringContaining('backup.ts') }),
    ])
    expect(runs).toHaveLength(1)
    expect(runs[0].preReloadState).toEqual(expect.objectContaining({ dirty: false, version: '0.9.1' }))
  }, 15000)

  it('prepares reload even while the workspace is dirty — undo is a pure file restore and does not require a clean git state', async () => {
    writeFileSync(path.join(workspacePath, 'src', 'example.ts'), 'export const value = 3\n', 'utf8')
    const { prepareReload } = await import('../remote-edit/recovery')

    const result = await prepareReload('report-1')

    expect(result.canReload).toBe(true)
    expect(result.recovery).toEqual(expect.objectContaining({ reportId: 'report-1', status: 'prepared' }))
  })

  it('prepares reload even when the latest verification run failed — undo must be reachable after a failed verification', async () => {
    db.prepare(
      `INSERT INTO remote_edit_verification_runs
        (id, report_id, status, steps_json, started_at, completed_at, retry_count, error)
       VALUES ('verify-2', 'report-1', 'failed', '[]', 3, 4, 0, 'typecheck failed')`,
    ).run()
    const { prepareReload } = await import('../remote-edit/recovery')

    const result = await prepareReload('report-1')

    expect(result.canReload).toBe(true)
    expect(result.recovery).toEqual(expect.objectContaining({ reportId: 'report-1', status: 'prepared' }))
  })

  it('still blocks reload preparation when there is no backup manifest to restore from', async () => {
    db.prepare("UPDATE error_reports SET fix_staged_files = '[]' WHERE id = 'report-1'").run()
    const { prepareReload } = await import('../remote-edit/recovery')

    const result = await prepareReload('report-1')

    expect(result.canReload).toBe(false)
    expect(result.recovery).toBeNull()
    expect(result.reason).toBe('No backup manifest is available for rollback')
  })

  it('rolls back files from backupManifest to workspace', async () => {
    const emit = vi.fn()
    const { prepareReload, rollbackHeal, getRecoveryRuns } = await import('../remote-edit/recovery')
    const prepared = await prepareReload('report-1')
    // Create a backup file to restore
    writeFileSync(path.join(testRoot, 'backup.ts'), 'export const value = 1\n', 'utf8')

    const result = await rollbackHeal(prepared.recovery!.id, emit)

    expect(result.rolledBack).toBe(true)
    expect(result.error).toBeUndefined()
    const runs = getRecoveryRuns('report-1')
    expect(runs[0].status).toBe('rolled-back')
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'rollback', status: 'rollback-required' }))
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'rollback', status: 'rolled-back', label: 'Rollback complete' }))
  })

  it('skips backup entries with null backupPath during rollback', async () => {
    // Override staged files so backupPath is null
    db.prepare("UPDATE error_reports SET fix_staged_files = ? WHERE id = 'report-1'").run(
      JSON.stringify([{ relativePath: 'src/example.ts', stagingPath: '', backupPath: null, diffLineCount: 1, reviewed: true }]),
    )
    const { prepareReload, rollbackHeal, getRecoveryRuns } = await import('../remote-edit/recovery')
    const prepared = await prepareReload('report-1')

    const result = await rollbackHeal(prepared.recovery!.id)

    expect(result.rolledBack).toBe(true)
    expect(getRecoveryRuns('report-1')[0].status).toBe('rolled-back')
  })

  it('returns error when rolling back a non-existent recovery run', async () => {
    const { rollbackHeal } = await import('../remote-edit/recovery')
    const result = await rollbackHeal('nonexistent-id')
    expect(result.rolledBack).toBe(false)
    expect(result.error).toMatch(/not found/)
  })

  it('rolls back directly from a freshly prepared recovery run', async () => {
    const { prepareReload, rollbackHeal, getRecoveryRuns } = await import('../remote-edit/recovery')
    const prepared = await prepareReload('report-1')
    writeFileSync(path.join(testRoot, 'backup.ts'), 'export const value = 1\n', 'utf8')

    const result = await rollbackHeal(prepared.recovery!.id)

    expect(result.rolledBack).toBe(true)
    expect(getRecoveryRuns('report-1')[0].status).toBe('rolled-back')
  })

  it('returns error when rolling back a run that was already rolled back', async () => {
    const { prepareReload, rollbackHeal } = await import('../remote-edit/recovery')
    const prepared = await prepareReload('report-1')
    writeFileSync(path.join(testRoot, 'backup.ts'), 'export const value = 1\n', 'utf8')
    await rollbackHeal(prepared.recovery!.id)

    const result = await rollbackHeal(prepared.recovery!.id)

    expect(result.rolledBack).toBe(false)
    expect(result.error).toMatch(/Nothing to roll back/)
  })
})
