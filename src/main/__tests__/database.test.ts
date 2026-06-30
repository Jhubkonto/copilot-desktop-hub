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

function insertConversation(db: Database.Database, id = 'conv-1') {
  db.prepare(
    "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(id, 'Test', 1, 1)
}

function insertMessageWithRole(db: Database.Database, role: string, conversationId = 'conv-1') {
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)"
  ).run(`msg-${role}`, conversationId, role, 'content', 1)
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

    expect(db.pragma('user_version', { simple: true })).toBe(46)
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
    expect(getColumnNames(db, 'agent_delegations')).toEqual(
      expect.arrayContaining(['conversation_id', 'leader_agent_id', 'specialist_agent_id', 'status'])
    )
    expect(getColumnNames(db, 'conversation_summaries')).toEqual(
      expect.arrayContaining(['conversation_id', 'summary', 'summary_json', 'source_message_count', 'retained_message_count'])
    )
    expect(getColumnNames(db, 'error_log')).toEqual(
      expect.arrayContaining(['source', 'level', 'message', 'stack', 'timestamp'])
    )
    expect(getColumnNames(db, 'error_reports')).toEqual(
      expect.arrayContaining(['title', 'description', 'screenshot_path', 'log_snapshot', 'status', 'created_at', 'updated_at'])
    )
    expect(getColumnNames(db, 'error_reports')).toEqual(
      expect.arrayContaining(['investigation_markdown', 'investigation_confidence', 'investigation_root_cause', 'investigation_affected_files'])
    )
    expect(getColumnNames(db, 'remote_edit_verification_runs')).toEqual(
      expect.arrayContaining(['report_id', 'status', 'steps_json', 'retry_count', 'error'])
    )
    expect(getColumnNames(db, 'remote_edit_recovery_runs')).toEqual(
      expect.arrayContaining(['report_id', 'status', 'target_commit_sha', 'backup_manifest_json', 'pre_reload_state_json'])
    )
    expect(getColumnNames(db, 'skills')).toEqual(
      expect.arrayContaining(['id', 'config_json', 'created_at', 'updated_at'])
    )
    expect(getColumnNames(db, 'agent_skills')).toEqual(
      expect.arrayContaining(['agent_id', 'skill_id', 'sort_order', 'attached_at'])
    )
    expect(getColumnNames(db, 'build_records')).toEqual(
      expect.arrayContaining(['mobile_initiated'])
    )
    expect(getColumnNames(db, 'conversation_debriefs')).toEqual(
      expect.arrayContaining(['conversation_id', 'summary', 'commands_tools', 'reproduction_guide', 'mental_model'])
    )
    expect(getColumnNames(db, 'conversations')).toEqual(expect.arrayContaining(['completed_at', 'cli_backend']))
    expect(getColumnNames(db, 'conversation_quiz_attempts')).toEqual(
      expect.arrayContaining(['conversation_id', 'score', 'total', 'attempted_at'])
    )
    expect(getColumnNames(db, 'error_reports')).toEqual(
      expect.arrayContaining(['request_type', 'request_origin', 'workspace_root', 'project_id']),
    )
    expect(getColumnNames(db, 'project_edit_sessions')).toEqual(
      expect.arrayContaining(['project_id', 'conversation_id', 'agent_id', 'title', 'source', 'created_at', 'updated_at'])
    )
    expect(getColumnNames(db, 'project_touched_files')).toEqual(
      expect.arrayContaining(['session_id', 'relative_path', 'status', 'last_operation', 'diff_json'])
    )
  })

  it('allows persisted tool call messages on a fresh DB', () => {
    const db = createDatabase()

    initializeBaseSchema(db)
    runMigrations(db)
    insertConversation(db)

    expect(() => insertMessageWithRole(db, 'tool-call')).not.toThrow()
  })

  it('is idempotent when run twice', () => {
    const db = createDatabase()

    initializeBaseSchema(db)

    expect(() => {
      runMigrations(db)
      runMigrations(db)
    }).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(46)
  })

  it('only runs pending migrations for a partial upgrade', () => {
    const db = createDatabase()

    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

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

    expect(db.pragma('user_version', { simple: true })).toBe(46)
    expect(getColumnNames(db, 'messages')).toEqual(
      expect.arrayContaining(['is_edited', 'previous_content', 'context_snapshot'])
    )
    expect(getColumnNames(db, 'conversations')).toEqual(expect.arrayContaining(['project_id']))
    expect(getColumnNames(db, 'project_wiki_entries')).toEqual(
      expect.arrayContaining(['tags', 'superseded_by'])
    )
    expect(getColumnNames(db, 'projects')).toEqual(expect.arrayContaining(['config_json']))
    expect(getColumnNames(db, 'conversation_summaries')).toEqual(
      expect.arrayContaining(['summary_json'])
    )
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get('idx_conversations_project')
    ).toBeTruthy()
    expect(getColumnNames(db, 'remote_edit_verification_runs')).toEqual(
      expect.arrayContaining(['report_id', 'status', 'steps_json'])
    )
    expect(getColumnNames(db, 'remote_edit_recovery_runs')).toEqual(
      expect.arrayContaining(['report_id', 'status', 'backup_manifest_json'])
    )
    expect(getColumnNames(db, 'agent_skills')).toEqual(
      expect.arrayContaining(['agent_id', 'skill_id', 'sort_order'])
    )
  })

  it('upgrades a v15 messages table to allow persisted tool call messages', () => {
    const db = createDatabase()

    db.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        model TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        project_id TEXT,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'team-activity')),
        content TEXT NOT NULL,
        model TEXT,
        is_edited INTEGER NOT NULL DEFAULT 0,
        previous_content TEXT,
        context_snapshot TEXT,
        attachments TEXT,
        timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
    `)
    db.pragma('user_version = 15')
    insertConversation(db)
    insertMessageWithRole(db, 'assistant')

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(46)
    expect(() => insertMessageWithRole(db, 'tool-call')).not.toThrow()
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM messages WHERE role = ?").get('assistant')
    ).toEqual({ count: 1 })
  })

  it('re-throws genuine errors', () => {
    const db = createDatabase()
    const failingMigrations: ReadonlyArray<Migration> = [
      ...MIGRATIONS,
      { version: 17, sql: 'ALTER TABLE missing_table ADD COLUMN broken TEXT' },
    ]

    initializeBaseSchema(db)

    expect(() => runMigrations(db, failingMigrations)).toThrow(/missing_table/)
    expect(db.pragma('user_version', { simple: true })).toBe(0)
  })
})
