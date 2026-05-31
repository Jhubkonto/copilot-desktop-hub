import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import {
  MIGRATIONS,
  initializeBaseSchema,
  runMigrations,
  type Migration,
} from '../database-migrations'

const openDatabases: Database.Database[] = []

function createDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  openDatabases.push(db)
  return db
}

function getColumnNames(db: Database.Database, tableName: string) {
  return (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map(
    ({ name }) => name
  )
}

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close()
  }
})

describe('database migrations', () => {
  it('applies all migrations to a fresh DB and sets user_version', () => {
    const db = createDatabase()

    initializeBaseSchema(db)
    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(13)
    expect(getColumnNames(db, 'projects')).toEqual(
      expect.arrayContaining(['default_model', 'config_json'])
    )
    expect(getColumnNames(db, 'messages')).toEqual(
      expect.arrayContaining(['attachments', 'context_snapshot'])
    )
    expect(getColumnNames(db, 'conversations')).toEqual(expect.arrayContaining(['project_id']))
    expect(getColumnNames(db, 'project_wiki_entries')).toEqual(
      expect.arrayContaining(['tags', 'superseded_by'])
    )
  })

  it('is idempotent when run twice', () => {
    const db = createDatabase()

    initializeBaseSchema(db)

    expect(() => {
      runMigrations(db)
      runMigrations(db)
    }).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(13)
  })

  it('only runs pending migrations for a partial upgrade', () => {
    const db = createDatabase()

    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT 'blue',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        default_model TEXT
      );

      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        model TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'team-activity')),
        content TEXT NOT NULL,
        attachments TEXT,
        model TEXT,
        timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
    `)
    db.pragma('user_version = 5')

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(13)
    expect(getColumnNames(db, 'messages')).toEqual(
      expect.arrayContaining(['is_edited', 'previous_content', 'context_snapshot'])
    )
    expect(getColumnNames(db, 'conversations')).toEqual(expect.arrayContaining(['project_id']))
    expect(getColumnNames(db, 'project_wiki_entries')).toEqual(
      expect.arrayContaining(['tags', 'superseded_by'])
    )
    expect(getColumnNames(db, 'projects')).toEqual(expect.arrayContaining(['config_json']))
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get('idx_conversations_project')
    ).toBeTruthy()
  })

  it('re-throws genuine errors', () => {
    const db = createDatabase()
    const failingMigrations: ReadonlyArray<Migration> = [
      ...MIGRATIONS,
      { version: 14, sql: 'ALTER TABLE missing_table ADD COLUMN broken TEXT' },
    ]

    initializeBaseSchema(db)

    expect(() => runMigrations(db, failingMigrations)).toThrow(/missing_table/)
    expect(db.pragma('user_version', { simple: true })).toBe(0)
  })
})
