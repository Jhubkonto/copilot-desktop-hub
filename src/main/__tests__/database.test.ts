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

    expect(db.pragma('user_version', { simple: true })).toBe(66)
    expect(getColumnNames(db, 'projects')).toEqual(
      expect.arrayContaining(['default_model', 'config_json'])
    )
    expect(getColumnNames(db, 'messages')).toEqual(
      expect.arrayContaining(['attachments', 'context_snapshot', 'input_tokens', 'output_tokens', 'provider', 'finish_reason'])
    )
    expect(getColumnNames(db, 'conversations')).toEqual(expect.arrayContaining(['project_id', 'archived']))
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
    // conversation_quiz_attempts (migration 43) is dropped by migration 61 — Quiz now persists
    // its questions as a versioned artifact instead of a score-only attempt row.
    expect(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name),
    ).not.toContain('conversation_quiz_attempts')
    expect(getColumnNames(db, 'error_reports')).toEqual(
      expect.arrayContaining(['request_type', 'request_origin', 'workspace_root', 'project_id', 'conversation_id']),
    )
    expect(getColumnNames(db, 'project_edit_sessions')).toEqual(
      expect.arrayContaining(['project_id', 'conversation_id', 'agent_id', 'title', 'source', 'created_at', 'updated_at'])
    )
    expect(getColumnNames(db, 'project_touched_files')).toEqual(
      expect.arrayContaining(['session_id', 'relative_path', 'status', 'last_operation', 'diff_json'])
    )
    expect(getColumnNames(db, 'sync_devices')).toEqual(
      expect.arrayContaining(['id', 'dataset_id', 'protocol_version', 'last_received_sequence'])
    )
    expect(getColumnNames(db, 'sync_entity_versions')).toEqual(
      expect.arrayContaining(['entity_type', 'entity_id', 'version', 'source_updated_at'])
    )
    expect(getColumnNames(db, 'sync_conflicts')).toEqual(
      expect.arrayContaining(['entity_type', 'entity_id', 'local_payload_json', 'remote_payload_json'])
    )
    expect(getColumnNames(db, 'sync_entity_history')).toEqual(
      expect.arrayContaining(['entity_type', 'entity_id', 'version', 'payload_json'])
    )
    expect(getColumnNames(db, 'sync_attachments')).toEqual(
      expect.arrayContaining(['content_hash', 'size_bytes', 'content', 'received_bytes', 'completed_at', 'attachment_id', 'message_id'])
    )
    expect(getColumnNames(db, 'sync_desktop_changes')).toEqual(
      expect.arrayContaining(['sequence', 'device_id', 'dataset_id', 'entity_type', 'entity_version'])
    )
  })

  it('renames legacy self_heal_* tables to remote_edit_* left behind by an in-place migration edit', () => {
    // Simulates a real DB that had already applied migrations 28-31 back when they
    // used self_heal_* table names, before those migration entries were edited in
    // place (instead of appending a new migration) to use remote_edit_* names.
    const db = createDatabase()
    initializeBaseSchema(db)
    const migrationsUpToLegacyNaming = MIGRATIONS.filter((migration) => migration.version <= 31).map(
      (migration): Migration => {
        if (migration.version !== 28 && migration.version !== 29 && migration.version !== 30 && migration.version !== 31) {
          return migration
        }
        // Re-apply the pre-rename SQL these versions originally shipped with.
        const legacySql = {
          28: `CREATE TABLE IF NOT EXISTS self_heal_diffs (
                 report_id TEXT NOT NULL, relative_path TEXT NOT NULL, diff_json TEXT NOT NULL,
                 PRIMARY KEY (report_id, relative_path)
               );`,
          29: `CREATE TABLE IF NOT EXISTS self_heal_verification_runs (
                 id TEXT PRIMARY KEY, report_id TEXT NOT NULL, status TEXT NOT NULL,
                 steps_json TEXT NOT NULL DEFAULT '[]', started_at INTEGER NOT NULL,
                 completed_at INTEGER, retry_count INTEGER NOT NULL DEFAULT 0, error TEXT
               );`,
          30: `CREATE TABLE IF NOT EXISTS self_heal_recovery_runs (
                 id TEXT PRIMARY KEY, report_id TEXT NOT NULL, status TEXT NOT NULL,
                 target_commit_sha TEXT, target_version TEXT,
                 backup_manifest_json TEXT NOT NULL DEFAULT '[]', pre_reload_state_json TEXT NOT NULL DEFAULT '{}',
                 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                 confirmed_at INTEGER, rollback_at INTEGER, error TEXT
               );`,
          31: `CREATE TABLE IF NOT EXISTS self_heal_history (
                 id TEXT PRIMARY KEY, report_id TEXT NOT NULL, report_title TEXT NOT NULL DEFAULT '',
                 investigation_model TEXT, investigation_backend TEXT, investigation_rounds INTEGER NOT NULL DEFAULT 0,
                 fix_applied_at INTEGER, verification_passed INTEGER NOT NULL DEFAULT 0, verification_failed_step TEXT,
                 committed INTEGER NOT NULL DEFAULT 0, commit_sha TEXT, pushed INTEGER NOT NULL DEFAULT 0,
                 reloaded INTEGER NOT NULL DEFAULT 0, rolled_back INTEGER NOT NULL DEFAULT 0,
                 status TEXT NOT NULL DEFAULT 'investigating', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
               );`,
        }[migration.version]
        return { version: migration.version, sql: legacySql }
      },
    )
    runMigrations(db, migrationsUpToLegacyNaming)
    db.prepare(
      `INSERT INTO self_heal_history (id, report_id, report_title, status, created_at, updated_at)
       VALUES ('hist-1', 'report-1', 'Legacy entry', 'investigating', 1, 1)`,
    ).run()

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(66)
    const tableNames = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    ).map((row) => row.name)
    expect(tableNames).not.toContain('self_heal_diffs')
    expect(tableNames).not.toContain('self_heal_verification_runs')
    expect(tableNames).not.toContain('self_heal_recovery_runs')
    expect(tableNames).not.toContain('self_heal_history')
    expect(tableNames).toEqual(expect.arrayContaining([
      'remote_edit_diffs', 'remote_edit_verification_runs', 'remote_edit_recovery_runs', 'remote_edit_history',
    ]))
    // migration 50 (a one-time wipe of Code Changes test data, run right after this rename)
    // intentionally clears remote_edit_history along with the rest of the Code Changes tables,
    // so the renamed row from the legacy self_heal_history table does not survive to the end
    // of the migration chain — only the rename itself (verified above) is under test here.
    expect(db.prepare('SELECT * FROM remote_edit_history WHERE id = ?').get('hist-1')).toBeUndefined()
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
    expect(db.pragma('user_version', { simple: true })).toBe(66)
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

    expect(db.pragma('user_version', { simple: true })).toBe(66)
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

    expect(db.pragma('user_version', { simple: true })).toBe(66)
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

  it('rolls back the whole pending batch (leaving user_version unchanged) when a table-rebuild migration hits "already exists" on a bare CREATE TABLE', () => {
    // Regression test: a prior bug in runMigrations treated "duplicate column name" /
    // "already exists" as ignorable for any statement, including the bare CREATE TABLE step of
    // a table-rebuild sequence — where the error does not prove the rebuild's end-state is
    // correct (e.g. a stray intermediate table left by a prior interrupted run). Swallowing it
    // there could mark an incomplete rebuild as done. A bare CREATE TABLE (not IF NOT EXISTS)
    // must always re-throw "already exists", even though CREATE TABLE IF NOT EXISTS and plain
    // ALTER TABLE ADD COLUMN statements may still ignore it. The whole pending batch runs in one
    // transaction, so an unswallowed error here rolls everything in this run back — including
    // migration 1's otherwise-successful CREATE TABLE — leaving user_version unchanged so the
    // full batch is retried from scratch on the next app start (same as the pre-existing
    // 're-throws genuine errors' behavior).
    const db = createDatabase()
    const migrations: ReadonlyArray<Migration> = [
      { version: 1, sql: 'CREATE TABLE t_v2 (id TEXT PRIMARY KEY)' },
      {
        // Simulates a rebuild whose CREATE TABLE step collides with a stray leftover table
        // from an interrupted prior run — the INSERT/DROP/RENAME steps that would complete
        // the rebuild never run once this throws.
        version: 2,
        sql: `
          CREATE TABLE t_v2 (id TEXT PRIMARY KEY, extra TEXT);
          INSERT INTO t_v2 (id) SELECT id FROM t_v2;
        `,
      },
      { version: 3, sql: 'CREATE TABLE unrelated (id TEXT PRIMARY KEY)' },
    ]

    expect(() => runMigrations(db, migrations)).toThrow(/already exists/)
    expect(db.pragma('user_version', { simple: true })).toBe(0)
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'unrelated'").get(),
    ).toBeUndefined()
  })

  it('lets independent ALTER TABLE ADD COLUMN statements in the same migration proceed even if an earlier one is already applied', () => {
    // Companion regression test: migration 22 in MIGRATIONS chains two unrelated ADD COLUMN
    // statements, where the first can legitimately hit "duplicate column name" on a fresh
    // install (that column already shipped in migration 21's CREATE TABLE) while the second is
    // still genuinely pending. Fixing the table-rebuild case must not regress this — each
    // statement's ignorable error must only affect that statement, not the ones after it.
    const db = createDatabase()
    const migrations: ReadonlyArray<Migration> = [
      { version: 1, sql: 'CREATE TABLE t (id TEXT PRIMARY KEY, already_there TEXT)' },
      {
        version: 2,
        sql: `
          ALTER TABLE t ADD COLUMN already_there TEXT;
          ALTER TABLE t ADD COLUMN still_pending TEXT;
        `,
      },
    ]

    expect(() => runMigrations(db, migrations)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(2)
    expect(getColumnNames(db, 't')).toEqual(expect.arrayContaining(['already_there', 'still_pending']))
  })

  it('still tolerates a single-statement migration re-hitting "duplicate column name"', () => {
    const db = createDatabase()
    const migrations: ReadonlyArray<Migration> = [
      { version: 1, sql: 'CREATE TABLE t (id TEXT PRIMARY KEY, name TEXT)' },
      // Simulates a column that was already added by some other path — a single ALTER TABLE
      // ADD COLUMN statement re-hitting "duplicate column name" safely proves the column
      // already exists, so this remains ignorable.
      { version: 2, sql: 'ALTER TABLE t ADD COLUMN name TEXT' },
      { version: 3, sql: 'CREATE TABLE unrelated (id TEXT PRIMARY KEY)' },
    ]

    expect(() => runMigrations(db, migrations)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(3)
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'unrelated'").get(),
    ).toBeTruthy()
  })

  it('repairs a DB stuck past migration 47 without request_type, left behind by the old error-swallowing bug', () => {
    // Simulates a real DB where migration 47's table-rebuild silently failed partway
    // (e.g. hit "already exists" on a stray error_reports_v47 table from an interrupted
    // prior run) and the old runMigrations bug marked user_version past 47 anyway, leaving
    // request_type / custom_type_label permanently missing from error_reports.
    const db = createDatabase()
    initializeBaseSchema(db)
    const migrationsUpTo46 = MIGRATIONS.filter((migration) => migration.version <= 46)
    runMigrations(db, migrationsUpTo46)
    db.prepare(
      `INSERT INTO error_reports (id, title, description, status, created_at, updated_at)
       VALUES ('report-1', 'Stuck report', 'desc', 'open', 1, 1)`,
    ).run()
    // Simulate the old bug's outcome: user_version bumped past 47 despite the rebuild
    // never having actually happened (request_type is still absent from error_reports).
    db.pragma('user_version = 48')

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(66)
    expect(getColumnNames(db, 'error_reports')).toEqual(
      expect.arrayContaining(['request_type', 'request_origin', 'workspace_root', 'project_id', 'custom_type_label']),
    )
    // migration 50 (a one-time wipe of Code Changes test data, run right after this repair)
    // intentionally clears error_reports along with the rest of the Code Changes tables, so
    // the repaired row does not survive to the end of the migration chain — only the column
    // repair itself (verified above) is under test here.
    expect(db.prepare('SELECT * FROM error_reports WHERE id = ?').get('report-1')).toBeUndefined()
  })
})
