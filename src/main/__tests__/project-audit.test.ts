import Database from 'better-sqlite3'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, MIGRATIONS, runMigrations } from '../database-migrations'

let db: Database.Database

vi.mock('../database', () => ({ getDatabase: () => db }))
vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))

function insertHierarchy(database: Database.Database, workspace: string): void {
  database.prepare(`INSERT INTO projects (id, name, color, config_json, created_at, updated_at)
    VALUES ('project-1', 'Product', 'blue', ?, 1, 1)`).run(JSON.stringify({ rootDirectory: workspace }))
  database.prepare(`INSERT INTO project_sources
    (id, project_id, label, kind, local_path, enabled, is_primary, created_at, updated_at)
    VALUES ('source-1', 'project-1', 'Product workspace', 'workspace-root', ?, 1, 1, 1, 1)`).run(workspace)
  const insertRepo = database.prepare(`INSERT INTO project_repositories
    (id, project_id, source_id, label, relative_path, branch, enabled, available, created_at, updated_at)
    VALUES (?, 'project-1', 'source-1', ?, ?, ?, 1, 1, 1, 1)`)
  insertRepo.run('repo-frontend', 'frontend', 'frontend', 'main')
  insertRepo.run('repo-backend', 'backend', 'backend', 'develop')
}

describe('repository-aware project audit', () => {
  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    initializeBaseSchema(db)
    runMigrations(db)
  })

  it('resolves the longest repository root and preserves display casing', async () => {
    const workspace = path.join(process.cwd(), '.test-audit-product')
    insertHierarchy(db, workspace)
    const { inferProjectAuditTarget } = await import('../project-audit')

    const target = inferProjectAuditTarget(path.join(workspace, 'frontend', 'src', 'AndroidManifest.xml'))

    expect(target).toEqual(expect.objectContaining({
      projectId: 'project-1',
      sourceId: 'source-1',
      repositoryId: 'repo-frontend',
      repositoryLabel: 'frontend',
      relativePath: 'src/AndroidManifest.xml',
      displayPath: 'frontend/src/AndroidManifest.xml',
      branch: 'main',
    }))
  })

  it('keeps equal repository-relative paths as distinct touched files', async () => {
    const workspace = path.join(process.cwd(), '.test-audit-product')
    insertHierarchy(db, workspace)
    const { inferProjectAuditTarget, listProjectAuditFiles, recordProjectAuditChange } = await import('../project-audit')
    for (const repo of ['frontend', 'backend']) {
      const target = inferProjectAuditTarget(path.join(workspace, repo, 'src', 'index.ts'))!
      recordProjectAuditChange({
        ...target,
        sessionId: 'session-1',
        title: 'Cross-repository edit',
        source: 'cli-tool',
        status: 'modified',
        lastOperation: 'write',
      })
    }

    const files = listProjectAuditFiles('session-1')
    expect(files).toHaveLength(2)
    expect(new Set(files.map((file) => file.id)).size).toBe(2)
    expect(files.map((file) => [file.repositoryLabel, file.relativePath])).toEqual([
      ['backend', 'src/index.ts'],
      ['frontend', 'src/index.ts'],
    ])
  })

  it('backfills legacy root-relative paths to the longest repository prefix', () => {
    db.close()
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    initializeBaseSchema(db)
    runMigrations(db, MIGRATIONS.filter((migration) => migration.version <= 86))
    const workspace = path.join(process.cwd(), '.test-audit-product')
    insertHierarchy(db, workspace)
    db.prepare(`INSERT INTO project_edit_sessions
      (id, project_id, title, source, created_at, updated_at)
      VALUES ('legacy-session', 'project-1', 'Legacy edit', 'chat-tool', 1, 1)`).run()
    db.prepare(`INSERT INTO project_touched_files
      (session_id, relative_path, status, last_operation, first_touched_at, last_touched_at)
      VALUES ('legacy-session', 'frontend/src/App.tsx', 'modified', 'write', 1, 1)`).run()

    runMigrations(db)
    const row = db.prepare(`SELECT repository_id, repository_label, relative_path, display_path,
      legacy_repository_unknown FROM project_touched_files WHERE session_id = 'legacy-session'`).get()
    expect(row).toEqual({
      repository_id: 'repo-frontend',
      repository_label: 'frontend',
      relative_path: 'src/App.tsx',
      display_path: 'frontend/src/App.tsx',
      legacy_repository_unknown: 0,
    })
  })
})
