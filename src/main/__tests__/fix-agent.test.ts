import Database from 'better-sqlite3'
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { DEFAULT_PROJECT_CONFIG } from '../../shared/types'

const { safeHandlers, testRoot, sendProviderWithToolsMock, broadcastToMobileMock } = vi.hoisted(() => ({
  safeHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  testRoot: { value: '.test-remote-edit-fix' },
  sendProviderWithToolsMock: vi.fn(),
  broadcastToMobileMock: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => testRoot.value,
    getVersion: () => '0.9.0-test',
  },
}))

vi.mock('../safe-handle', () => ({
  safeHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    safeHandlers.set(channel, handler)
  }),
}))

vi.mock('../providers', () => ({
  getProviderForAgent: vi.fn(() => ({ provider: 'openai', model: 'gpt-5-mini' })),
  getApiKey: vi.fn(() => 'sk-test'),
  sendProviderWithTools: sendProviderWithToolsMock,
}))

vi.mock('../ws-server', () => ({
  broadcastToMobile: broadcastToMobileMock,
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

function invoke<T>(channel: string, ...args: unknown[]): T {
  const handler = safeHandlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return handler({}, ...args) as T
}

describe('remote-edit fix staging', () => {
  const workspacePath = path.join(testRoot.value, 'workspace')
  const sourcePath = path.join(workspacePath, 'src', 'example.ts')

  beforeEach(() => {
    safeHandlers.clear()
    vi.resetModules()
    sendProviderWithToolsMock.mockReset()
    broadcastToMobileMock.mockReset()
    rmSync(testRoot.value, { recursive: true, force: true })
    mkdirSync(path.dirname(sourcePath), { recursive: true })
    writeFileSync(sourcePath, 'export const value = 1\n', 'utf8')
    db = createDatabase()
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run(workspacePath)
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('remote_edit_backend', 'byok')").run()
    db.prepare(
      'INSERT INTO projects (id, name, color, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('proj-1', 'Workspace project', 'blue', JSON.stringify({ ...DEFAULT_PROJECT_CONFIG, rootDirectory: workspacePath }), 1, 1)
    db.prepare(
      `INSERT INTO error_reports (
        id, title, description, screenshot_path, log_snapshot, status,
        app_version, platform, os_version, investigation_markdown,
        investigation_confidence, investigation_root_cause, investigation_affected_files,
        workspace_root, project_id, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, NULL, 'investigated', '0.9.0-test', 'test', 'test', ?, 'high', 'bad constant', ?, ?, 'proj-1', 1, 1)`,
    ).run(
      'report-1',
      'Fix me',
      'Synthetic bug',
      '---\nconfidence: high\nroot_cause: bad constant\naffected_files:\n  - "src/example.ts"\n---\nInvestigation',
      '["src/example.ts"]',
      workspacePath,
    )
  })

  afterEach(() => {
    db.close()
    rmSync(testRoot.value, { recursive: true, force: true })
  })

  it('recovers a patch generation stuck mid-staging from a previous crash', async () => {
    // Regression: activeFixRuns (in-memory) is always empty on a fresh process, so a row still
    // at fix_status='staging' was interrupted by a crash/restart, not an actually-running
    // generation — it used to stay stuck on "Generating patch..." forever with no retry path.
    db.prepare("UPDATE error_reports SET fix_status = 'staging' WHERE id = ?").run('report-1')

    const { recoverStuckFixRuns } = await import('../remote-edit/fix-agent')
    recoverStuckFixRuns()

    const row = db.prepare('SELECT fix_status, fix_error FROM error_reports WHERE id = ?').get('report-1') as Record<string, unknown>
    expect(row.fix_status).toBe('failed')
    expect(String(row.fix_error)).toContain('closed or restarted')
  })

  it('rolls back files already applied when a later file in the same patch fails to copy', async () => {
    // Regression: applyStagedPatchToWorkspace copies staged files to the workspace one by one;
    // if file N throws, files 0..N-1 used to stay live on disk with the whole request just
    // marked failed — a half-applied patch that's neither the original code nor the full patch,
    // with no indication of what actually changed. Backups already exist for exactly this, so a
    // mid-loop failure now restores (or deletes, if newly created) every file already copied.
    const otherPath = path.join(workspacePath, 'src', 'other.ts')
    const stagedOtherDir = path.join(testRoot.value, 'staged-other')
    mkdirSync(stagedOtherDir, { recursive: true })
    const stagedExamplePath = path.join(stagedOtherDir, 'example.ts')
    writeFileSync(stagedExamplePath, 'export const value = 2', 'utf8')

    const staged = [
      { relativePath: 'src/example.ts', stagingPath: stagedExamplePath, backupPath: null, diffLineCount: 1, reviewed: true },
      // No staged file was ever written at this path — forces copyFileSync to throw on the
      // second entry, after the first has already been copied into the workspace.
      { relativePath: 'src/other.ts', stagingPath: path.join(stagedOtherDir, 'does-not-exist.ts'), backupPath: null, diffLineCount: 1, reviewed: true },
    ]
    db.prepare("UPDATE error_reports SET fix_status = 'staged', fix_staged_files = ? WHERE id = ?")
      .run(JSON.stringify(staged), 'report-1')

    const { applyStagedPatchToWorkspace } = await import('../remote-edit-handlers')
    const result = applyStagedPatchToWorkspace('report-1')

    expect(result && 'error' in result).toBe(true)
    // src/example.ts was fully applied then rolled back to its pre-apply content.
    expect(readFileSync(sourcePath, 'utf8')).toBe('export const value = 1\n')
    // src/other.ts never successfully applied, so it was never created in the first place.
    expect(existsSync(otherPath)).toBe(false)
    expect(db.prepare('SELECT fix_status FROM error_reports WHERE id = ?').get('report-1')).toEqual({ fix_status: 'failed' })
    // The rolled-back file must not leave an audit entry claiming it was actually changed.
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM project_edit_sessions WHERE id = ?').get('remote-edit:report-1'),
    ).toEqual({ count: 0 })
  })

  it('stages generated files without touching the workspace, then applies with backup only after approval', async () => {
    sendProviderWithToolsMock.mockResolvedValue({
      content: [
        '<<<NEXY_FIX_FILE:src/example.ts>>>',
        'export const value = 2',
        '<<<NEXY_FIX_END>>>',
      ].join('\n'),
      toolCalls: [],
      model: 'gpt-5-mini',
    })
    const { runFix, getStagingDir, getBackupDir } = await import('../remote-edit/fix-agent')

    const result = await runFix(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as never,
      'report-1',
      { onEvent: vi.fn() },
    )

    const stagedPath = path.join(getStagingDir('report-1'), 'src', 'example.ts')
    expect(result.status).toBe('done')
    expect(readFileSync(sourcePath, 'utf8')).toBe('export const value = 1\n')
    expect(readFileSync(stagedPath, 'utf8')).toBe('export const value = 2')
    expect(db.prepare('SELECT COUNT(*) AS count FROM remote_edit_diffs WHERE report_id = ?').get('report-1')).toEqual({ count: 1 })

    const { registerRemoteEditHandlers } = await import('../remote-edit-handlers')
    registerRemoteEditHandlers()
    const applied = invoke<{ appliedFiles: string[]; backupPaths: string[] } | null>('remote-edit:commit-to-workspace', 'report-1')

    expect(applied?.appliedFiles).toEqual(['src/example.ts'])
    expect(readFileSync(sourcePath, 'utf8')).toBe('export const value = 2')
    const backupPath = path.join(getBackupDir('report-1'), 'src', 'example.ts')
    expect(existsSync(backupPath)).toBe(true)
    expect(readFileSync(backupPath, 'utf8')).toBe('export const value = 1\n')
    expect(db.prepare('SELECT fix_status, status FROM error_reports WHERE id = ?').get('report-1')).toEqual({
      fix_status: 'applied',
      status: 'completed',
    })
    expect(
      db.prepare('SELECT project_id, title, source FROM project_edit_sessions WHERE id = ?').get('remote-edit:report-1')
    ).toEqual({
      project_id: 'proj-1',
      title: 'Fix me',
      source: 'remote-edit',
    })
    expect(
      db.prepare('SELECT status, last_operation, diff_json FROM project_touched_files WHERE session_id = ? AND relative_path = ?')
        .get('remote-edit:report-1', 'src/example.ts')
    ).toEqual({
      status: 'modified',
      last_operation: 'apply',
      diff_json: expect.any(String),
    })
  }, 15000)
})

describe('emitFixEvent', () => {
  beforeEach(() => {
    broadcastToMobileMock.mockReset()
  })

  it('translates the desktop remote-edit:* channel to the self-heal:* name Android recognizes', async () => {
    const { emitFixEvent } = await import('../remote-edit/fix-agent')
    const win = { isDestroyed: () => false, webContents: { send: vi.fn() } }

    emitFixEvent(win as never, 'remote-edit:fix-done', { reportId: 'r1', status: 'done' })

    expect(broadcastToMobileMock).toHaveBeenCalledWith({
      event: 'self-heal:fix-done',
      data: { reportId: 'r1', status: 'done' },
    })
    expect(win.webContents.send).toHaveBeenCalledWith('remote-edit:fix-done', { reportId: 'r1', status: 'done' })
  })
})
