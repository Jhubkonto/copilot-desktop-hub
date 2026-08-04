import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'
import {
  addProjectSource,
  ensureLegacyProjectSource,
  listProjectSources,
  primarySourcePath,
  removeProjectRepository,
  removeProjectSource,
  setPrimarySourcePath,
} from '../project-sources'

describe('project source hierarchy compatibility', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeBaseSchema(db)
    runMigrations(db)
    db.prepare("INSERT INTO projects (id, name, color, config_json) VALUES ('p1', 'Portal', 'blue', '{}')").run()
  })

  it('backfills one stable primary source from legacy rootDirectory', () => {
    ensureLegacyProjectSource(db, 'p1', 'C:\\work\\portal')
    const first = listProjectSources(db, 'p1')
    ensureLegacyProjectSource(db, 'p1', 'C:\\work\\portal')
    const second = listProjectSources(db, 'p1')

    expect(second.sources).toHaveLength(1)
    expect(second.sources[0].id).toBe(first.sources[0].id)
    expect(second.sources[0].isPrimary).toBe(true)
    expect(primarySourcePath(second)).toContain('portal')
  })

  it('supports unrelated source folders and promotes a replacement primary', async () => {
    await addProjectSource(db, 'p1', { localPath: 'C:\\work\\frontend', scan: false })
    await addProjectSource(db, 'p1', { localPath: 'D:\\shared\\infrastructure', scan: false })
    const hierarchy = listProjectSources(db, 'p1')

    expect(hierarchy.sources).toHaveLength(2)
    const primary = hierarchy.sources.find((source) => source.isPrimary)!
    const afterRemoval = removeProjectSource(db, 'p1', primary.id)
    expect(afterRemoval.sources).toHaveLength(1)
    expect(afterRemoval.sources[0].isPrimary).toBe(true)
  })

  it('maps legacy rootDirectory updates onto the primary source', async () => {
    await addProjectSource(db, 'p1', { localPath: 'C:\\work\\old', scan: false })
    setPrimarySourcePath(db, 'p1', 'C:\\work\\new')
    expect(primarySourcePath(listProjectSources(db, 'p1'))).toContain('new')
  })

  it('clears repositories discovered under a replaced primary source path', async () => {
    await addProjectSource(db, 'p1', { localPath: 'C:\\work\\old', scan: false })
    const source = listProjectSources(db, 'p1').sources[0]
    db.prepare(`INSERT INTO project_repositories
      (id, project_id, source_id, label, relative_path, remote_url, branch, dirty,
       enabled, available, verify_commands_json, created_at, updated_at)
      VALUES ('repo-old', 'p1', ?, 'api', 'services/api', 'https://example.com/old.git',
              'main', 0, 0, 1, '["npm test"]', 1, 1)`)
      .run(source.id)

    setPrimarySourcePath(db, 'p1', 'C:\\work\\new')

    const hierarchy = listProjectSources(db, 'p1')
    expect(hierarchy.sources[0].id).toBe(source.id)
    expect(hierarchy.repositories).toEqual([])
  })

  it('preserves repository rows when the primary source path is unchanged', async () => {
    await addProjectSource(db, 'p1', { localPath: 'C:\\work\\portal', scan: false })
    const source = listProjectSources(db, 'p1').sources[0]
    db.prepare(`INSERT INTO project_repositories
      (id, project_id, source_id, label, relative_path, enabled, available, created_at, updated_at)
      VALUES ('repo-existing', 'p1', ?, 'portal', '', 1, 1, 1, 1)`)
      .run(source.id)

    setPrimarySourcePath(db, 'p1', 'C:\\work\\portal')

    expect(listProjectSources(db, 'p1').repositories.map((repo) => repo.id))
      .toEqual(['repo-existing'])
  })

  it('removes only the selected repository from Nexy', async () => {
    await addProjectSource(db, 'p1', { localPath: 'C:\\work\\portal', scan: false })
    const source = listProjectSources(db, 'p1').sources[0]
    const insert = db.prepare(`INSERT INTO project_repositories
      (id, project_id, source_id, label, relative_path, enabled, available, created_at, updated_at)
      VALUES (?, 'p1', ?, ?, ?, 1, 1, 1, 1)`)
    insert.run('repo-keep', source.id, 'frontend', 'frontend')
    insert.run('repo-remove', source.id, 'backend', 'backend')

    const hierarchy = removeProjectRepository(db, 'p1', 'repo-remove')

    expect(hierarchy.repositories.map((repo) => repo.id)).toEqual(['repo-keep'])
    expect(hierarchy.sources).toHaveLength(1)
  })
})
