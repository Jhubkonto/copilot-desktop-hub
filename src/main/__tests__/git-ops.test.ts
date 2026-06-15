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

const testRoot = path.join(process.cwd(), '.test-self-heal-git')
const workspacePath = path.join(testRoot, 'workspace')

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
    ) VALUES (?, 'Renderer crash', '', NULL, NULL, 'fixed', NULL, NULL, NULL, 'done', 'applied', ?, 1, 1)`,
  ).run('report-1', JSON.stringify([{ relativePath: 'src/example.ts', stagingPath: '', action: 'modified' }]))
  database.prepare(
    `INSERT INTO self_heal_verification_runs
      (id, report_id, status, steps_json, started_at, completed_at, retry_count, error)
     VALUES ('verify-1', 'report-1', 'success', '[]', 1, 2, 0, NULL)`,
  ).run()
  return database
}

describe('self-heal git operations', () => {
  beforeEach(() => {
    vi.resetModules()
    rmSync(testRoot, { recursive: true, force: true })
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
    rmSync(testRoot, { recursive: true, force: true })
  })

  it('prepares a commit only after an applied and verified fix', async () => {
    const { prepareSelfHealCommit } = await import('../self-heal/git-ops')

    const prepared = await prepareSelfHealCommit('report-1')

    expect(prepared.canCommit).toBe(true)
    expect(prepared.files).toEqual(['src/example.ts'])
    expect(prepared.suggestedMessage).toBe('fix: self-heal Renderer crash')
    expect(prepared.status.files).toEqual([
      expect.objectContaining({ path: 'src/example.ts', status: 'modified' }),
    ])
  })

  it('commits only the applied self-heal files', async () => {
    writeFileSync(path.join(workspacePath, 'unrelated.txt'), 'leave me unstaged\n', 'utf8')
    const { commitSelfHealFix, getSelfHealGitStatus } = await import('../self-heal/git-ops')

    const result = await commitSelfHealFix('report-1', 'fix: self-heal renderer crash')
    const status = await getSelfHealGitStatus('report-1')

    expect(result.committed).toBe(true)
    expect(result.commitSha).toMatch(/[0-9a-f]+/)
    expect(status.files).toEqual([
      expect.objectContaining({ path: 'unrelated.txt', status: 'untracked' }),
    ])
  })

  it('blocks commit before verification passes', async () => {
    db.prepare("UPDATE self_heal_verification_runs SET status = 'failed' WHERE id = 'verify-1'").run()
    const { commitSelfHealFix } = await import('../self-heal/git-ops')

    const result = await commitSelfHealFix('report-1', 'fix: should not commit')

    expect(result.committed).toBe(false)
    expect(result.error).toBe('Verification must pass before committing')
  })
})
