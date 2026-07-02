import Database from 'better-sqlite3'
import { execFileSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

vi.mock('../ws-server', () => ({
  broadcastToMobile: vi.fn(),
}))

let db: Database.Database

vi.mock('../database', () => ({
  getDatabase: () => db,
}))

const testRoot = path.join(process.cwd(), '.test-remote-edit-git')
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
    ) VALUES (?, 'Renderer crash', '', NULL, NULL, 'fixed', NULL, NULL, NULL, 'done', 'applied', ?, ?, 1, 1)`,
  ).run('report-1', JSON.stringify([{ relativePath: 'src/example.ts', stagingPath: '', action: 'modified' }]), workspacePath)
  database.prepare(
    `INSERT INTO remote_edit_verification_runs
      (id, report_id, status, steps_json, started_at, completed_at, retry_count, error)
     VALUES ('verify-1', 'report-1', 'success', '[]', 1, 2, 0, NULL)`,
  ).run()
  return database
}

describe('remote-edit git operations', () => {
  beforeEach(() => {
    vi.resetModules()
    removeTestRoot()
    mkdirSync(path.join(workspacePath, 'src'), { recursive: true })
    execFileSync('git', ['init'], { cwd: workspacePath, stdio: 'pipe' })
    git(['config', 'user.email', 'nexy@example.test'])
    git(['config', 'user.name', 'Nexy Test'])
    writeFileSync(path.join(workspacePath, 'src', 'example.ts'), 'export const value = 1\n', 'utf8')
    git(['add', '.'])
    git(['commit', '-m', 'initial'])
    writeFileSync(path.join(workspacePath, 'src', 'example.ts'), 'export const value = 2\n', 'utf8')
    db = createDatabase()
  })

  afterEach(() => {
    db.close()
    removeTestRoot()
  })

  it('prepares a commit only after an applied and verified fix', async () => {
    const { prepareRemoteEditCommit } = await import('../remote-edit/git-ops')

    const prepared = await prepareRemoteEditCommit('report-1')

    expect(prepared.canCommit).toBe(true)
    expect(prepared.files).toEqual(['src/example.ts'])
    expect(prepared.suggestedMessage).toBe('fix: Renderer crash')
    expect(prepared.status.files).toEqual([
      expect.objectContaining({ path: 'src/example.ts', status: 'modified' }),
    ])
  }, 15000)

  it('commits only the applied remote-edit files', async () => {
    writeFileSync(path.join(workspacePath, 'unrelated.txt'), 'leave me unstaged\n', 'utf8')
    const { commitRemoteEditFix, getRemoteEditGitStatus } = await import('../remote-edit/git-ops')

    const result = await commitRemoteEditFix('report-1', 'fix: remote-edit renderer crash')
    const status = await getRemoteEditGitStatus('report-1')

    expect(result.committed).toBe(true)
    expect(result.commitSha).toMatch(/[0-9a-f]+/)
    expect(status.files).toEqual([
      expect.objectContaining({ path: 'unrelated.txt', status: 'untracked' }),
    ])
  })

  it('blocks commit before verification passes', async () => {
    db.prepare("UPDATE remote_edit_verification_runs SET status = 'failed' WHERE id = 'verify-1'").run()
    const { commitRemoteEditFix } = await import('../remote-edit/git-ops')

    const result = await commitRemoteEditFix('report-1', 'fix: should not commit')

    expect(result.committed).toBe(false)
    expect(result.error).toBe('Verification must pass before committing')
  })

  it('classifies auth-related git failures with guidance', async () => {
    const { classifyGitFailure } = await import('../remote-edit/git-ops')

    const result = classifyGitFailure(new Error('fatal: Authentication failed for https://example.com/private/repo.git'))

    expect(result.authRequired).toBe(true)
    expect(result.authHelp).toMatch(/system git login|credential manager/i)
  })

  it('provides actionable guidance when a branch has no upstream', async () => {
    const { classifyGitFailure } = await import('../remote-edit/git-ops')

    const result = classifyGitFailure(new Error("fatal: The current branch feature has no upstream branch."))

    expect(result.authRequired).toBe(false)
    expect(result.authHelp).toMatch(/--set-upstream/)
  })
})
