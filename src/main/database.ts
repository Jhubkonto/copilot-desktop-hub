import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (db) return db

  const userDataPath = app.getPath('userData')
  const dbDir = join(userDataPath, 'data')

  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true })
  }

  const dbPath = join(dbDir, 'copilot-hub.db')
  db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  initializeSchema(db)

  return db
}

function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT 'blue',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      model TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT 'New Chat',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      model TEXT,
      is_edited INTEGER NOT NULL DEFAULT 0,
      previous_content TEXT,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, timestamp);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `)

  // Migrations: add columns that may not exist yet
  try {
    db.exec('ALTER TABLE projects ADD COLUMN default_model TEXT')
  } catch {
    // Column already exists
  }

  try {
    db.exec('ALTER TABLE messages ADD COLUMN attachments TEXT')
  } catch {
    // Column already exists
  }

  try {
    db.exec('ALTER TABLE conversations ADD COLUMN model TEXT')
  } catch {
    // Column already exists
  }

  try {
    db.exec('ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0')
  } catch {
    // Column already exists
  }

  try {
    db.exec('ALTER TABLE messages ADD COLUMN model TEXT')
  } catch {
    // Column already exists
  }

  try {
    db.exec('ALTER TABLE messages ADD COLUMN is_edited INTEGER NOT NULL DEFAULT 0')
  } catch {
    // Column already exists
  }

  try {
    db.exec('ALTER TABLE messages ADD COLUMN previous_content TEXT')
  } catch {
    // Column already exists
  }

  // Migrations: add project_id to conversations for existing users
  const convColumns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>
  if (!convColumns.some((col) => col.name === 'project_id')) {
    db.exec('ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL')
  }
  // Always ensure the index exists (safe for both new and existing installs)
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id, updated_at)')

  // Insert default settings if they don't exist
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  )
  insertSetting.run('theme', 'dark')
  insertSetting.run('globalHotkey', 'Ctrl+Shift+H')
  insertSetting.run('autoStart', 'false')
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
