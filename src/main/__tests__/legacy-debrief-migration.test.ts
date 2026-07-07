import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/nexy-test' },
}))

const fsState = vi.hoisted(() => ({ files: new Map<string, string>() }))
vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  statSync: vi.fn((p: string) => ({ size: (fsState.files.get(p) ?? '').length })),
  writeFileSync: vi.fn((p: string, content: string) => { fsState.files.set(p, content) }),
  readFileSync: vi.fn((p: string) => {
    const content = fsState.files.get(p)
    if (content === undefined) throw new Error(`ENOENT: no such file: ${p}`)
    return content
  }),
}))

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { migrateLegacyDebriefsToArtifacts } from '../legacy-debrief-migration'

describe('migrateLegacyDebriefsToArtifacts', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeBaseSchema(db)
    runMigrations(db)
    fsState.files.clear()
  })

  afterEach(() => {
    db.close()
  })

  it('wraps an existing legacy debrief row as version 1 of a new debrief artifact', () => {
    db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('conv-1', 'Git Basics', 1000, 1000)").run()
    db.prepare(
      `INSERT INTO conversation_debriefs (id, conversation_id, project_id, summary, commands_tools, reproduction_guide, mental_model, generated_at, created_at)
       VALUES ('d-1', 'conv-1', NULL, 'We learned git', '["git checkout"]', '1. Clone repo', 'Branch early', 1000, 1000)`
    ).run()

    migrateLegacyDebriefsToArtifacts(db)

    const artifact = db.prepare("SELECT * FROM artifacts WHERE kind = 'debrief'").get() as { id: string; current_version_id: string } | undefined
    expect(artifact).toBeTruthy()
    const version = db.prepare('SELECT * FROM artifact_versions WHERE id = ?').get(artifact!.current_version_id) as { version_number: number } | undefined
    expect(version?.version_number).toBe(1)
    const files = db.prepare('SELECT * FROM artifact_files WHERE version_id = ?').all(artifact!.current_version_id) as { relative_path: string }[]
    expect(files.map((f) => f.relative_path).sort()).toEqual(['debrief.json', 'debrief.md'])
    const chatRef = db.prepare('SELECT * FROM artifact_chat_refs WHERE artifact_id = ?').get(artifact!.id) as { conversation_id: string } | undefined
    expect(chatRef?.conversation_id).toBe('conv-1')

    const jsonFile = files.find((f) => f.relative_path === 'debrief.json')!
    const jsonRow = db.prepare('SELECT absolute_path FROM artifact_files WHERE version_id = ? AND relative_path = ?').get(artifact!.current_version_id, 'debrief.json') as { absolute_path: string }
    const content = JSON.parse(fsState.files.get(jsonRow.absolute_path)!) as { summary: string }
    expect(content.summary).toBe('We learned git')
    expect(jsonFile).toBeTruthy()
  })

  it('is idempotent — running twice does not duplicate artifacts', () => {
    db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('conv-1', 'Test', 1000, 1000)").run()
    db.prepare(
      `INSERT INTO conversation_debriefs (id, conversation_id, project_id, summary, commands_tools, reproduction_guide, mental_model, generated_at, created_at)
       VALUES ('d-1', 'conv-1', NULL, 'Summary', '[]', 'Guide', 'Model', 1000, 1000)`
    ).run()

    migrateLegacyDebriefsToArtifacts(db)
    migrateLegacyDebriefsToArtifacts(db)

    const count = (db.prepare("SELECT COUNT(*) as c FROM artifacts WHERE kind = 'debrief'").get() as { c: number }).c
    expect(count).toBe(1)
  })

  it('skips a row whose conversation no longer exists, without throwing', () => {
    db.prepare(
      `INSERT INTO conversation_debriefs (id, conversation_id, project_id, summary, commands_tools, reproduction_guide, mental_model, generated_at, created_at)
       VALUES ('d-1', 'gone-conv', NULL, 'Summary', '[]', 'Guide', 'Model', 1000, 1000)`
    ).run()

    expect(() => migrateLegacyDebriefsToArtifacts(db)).not.toThrow()
    const count = (db.prepare("SELECT COUNT(*) as c FROM artifacts WHERE kind = 'debrief'").get() as { c: number }).c
    expect(count).toBe(0)
  })

  it('does nothing on a fresh DB with no legacy debriefs', () => {
    expect(() => migrateLegacyDebriefsToArtifacts(db)).not.toThrow()
    const count = (db.prepare("SELECT COUNT(*) as c FROM artifacts").get() as { c: number }).c
    expect(count).toBe(0)
  })
})
