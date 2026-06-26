import Database from 'better-sqlite3'
import { EventEmitter } from 'events'
import { execFileSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const { spawnMock, relaunchMock, exitMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  relaunchMock: vi.fn(),
  exitMock: vi.fn(),
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, spawn: spawnMock }
})

vi.mock('electron', () => ({
  app: {
    relaunch: relaunchMock,
    exit: exitMock,
  },
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
      fix_status, fix_staged_files, created_at, updated_at
    ) VALUES (?, 'Recovery test', '', NULL, NULL, 'fixed', NULL, NULL, NULL, 'done', 'applied', ?, 1, 1)`,
  ).run(
    'report-1',
    JSON.stringify([{ relativePath: 'src/example.ts', stagingPath: '', backupPath: path.join(testRoot, 'backup.ts'), diffLineCount: 1, reviewed: true }]),
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
    spawnMock.mockReset()
    relaunchMock.mockReset()
    exitMock.mockReset()
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

  it('blocks reload preparation while the workspace is dirty', async () => {
    writeFileSync(path.join(workspacePath, 'src', 'example.ts'), 'export const value = 3\n', 'utf8')
    const { prepareReload } = await import('../remote-edit/recovery')

    const result = await prepareReload('report-1')

    expect(result.canReload).toBe(false)
    expect(result.recovery).toBeNull()
    expect(result.reason).toBe('Workspace must be clean after committing the fix')
  })

  it('starts a package build and marks the recovery run as reloading', async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    spawnMock.mockReturnValue(child)
    const emit = vi.fn()
    const { prepareReload, startReload, getRecoveryRuns } = await import('../remote-edit/recovery')
    const prepared = await prepareReload('report-1')

    const result = await startReload(prepared.recovery!.id, emit)
    child.stdout.emit('data', Buffer.from('packaged\n'))
    child.emit('close', 0)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(result.started).toBe(true)
    expect(result.buildId).toMatch(/[0-9a-f-]+/)
    expect(spawnMock).toHaveBeenCalledWith('npm', ['run', 'package'], expect.objectContaining({ cwd: workspacePath, shell: true }))
    expect(getRecoveryRuns('report-1')[0].status).toBe('reloading')
    expect(
      db.prepare('SELECT command, status, exit_code FROM build_records WHERE id = ?').get(result.buildId),
    ).toEqual({ command: 'package', status: 'success', exit_code: 0 })
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ label: 'Package complete. Relaunch approval required.' }))
  })

  it('schedules Electron relaunch only from a reloading recovery run', async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    spawnMock.mockReturnValue(child)
    const { prepareReload, startReload, approveRelaunch } = await import('../remote-edit/recovery')
    const prepared = await prepareReload('report-1')
    await startReload(prepared.recovery!.id)

    const result = approveRelaunch(prepared.recovery!.id)

    expect(result.scheduled).toBe(true)
    expect(relaunchMock).toHaveBeenCalled()
    expect(exitMock).toHaveBeenCalledWith(0)
    expect(db.prepare("SELECT value FROM settings WHERE key = 'remote_edit_pending_recovery_id'").get()).toEqual({
      value: prepared.recovery!.id,
    })
  })

  it('confirms startup only after a pending relaunch marker exists', async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    spawnMock.mockReturnValue(child)
    const emit = vi.fn()
    const { prepareReload, startReload, approveRelaunch, confirmStartupAfterRelaunch, getRecoveryRuns } = await import('../remote-edit/recovery')
    const prepared = await prepareReload('report-1')
    await startReload(prepared.recovery!.id)
    approveRelaunch(prepared.recovery!.id)

    const result = confirmStartupAfterRelaunch(emit)

    expect(result.confirmed).toBe(true)
    expect(result.recovery).toEqual(expect.objectContaining({ status: 'confirmed', confirmedAt: expect.any(Number) }))
    expect(getRecoveryRuns('report-1')[0].status).toBe('confirmed')
    expect(db.prepare("SELECT value FROM settings WHERE key = 'remote_edit_pending_recovery_id'").get()).toBeUndefined()
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'confirm',
      label: 'Startup confirmed after remote-edit reload',
      status: 'confirmed',
    }))
  })

  it('returns not-confirmed when no pending recovery key exists', async () => {
    const { confirmStartupAfterRelaunch } = await import('../remote-edit/recovery')
    const result = confirmStartupAfterRelaunch()
    expect(result.confirmed).toBe(false)
    expect(result.recovery).toBeNull()
  })

  it('rolls back files from backupManifest to workspace', async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    spawnMock.mockReturnValue(child)
    const emit = vi.fn()
    const { prepareReload, startReload, rollbackHeal, getRecoveryRuns } = await import('../remote-edit/recovery')
    const prepared = await prepareReload('report-1')
    await startReload(prepared.recovery!.id)
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
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    spawnMock.mockReturnValue(child)
    // Override staged files so backupPath is null
    db.prepare("UPDATE error_reports SET fix_staged_files = ? WHERE id = 'report-1'").run(
      JSON.stringify([{ relativePath: 'src/example.ts', stagingPath: '', backupPath: null, diffLineCount: 1, reviewed: true }]),
    )
    const { prepareReload, startReload, rollbackHeal, getRecoveryRuns } = await import('../remote-edit/recovery')
    const prepared = await prepareReload('report-1')
    await startReload(prepared.recovery!.id)

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

  it('returns error when rolling back a run in wrong status', async () => {
    const { prepareReload, rollbackHeal } = await import('../remote-edit/recovery')
    const prepared = await prepareReload('report-1')
    // 'prepared' status cannot be rolled back
    const result = await rollbackHeal(prepared.recovery!.id)
    expect(result.rolledBack).toBe(false)
    expect(result.error).toMatch(/Nothing to roll back/)
  })
})
