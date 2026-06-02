import Database from "better-sqlite3";

export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: ReadonlyArray<Migration> = [
  { version: 1, sql: "ALTER TABLE projects ADD COLUMN default_model TEXT" },
  { version: 2, sql: "ALTER TABLE messages ADD COLUMN attachments TEXT" },
  { version: 3, sql: "ALTER TABLE conversations ADD COLUMN model TEXT" },
  {
    version: 4,
    sql: "ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
  },
  { version: 5, sql: "ALTER TABLE messages ADD COLUMN model TEXT" },
  {
    version: 6,
    sql: "ALTER TABLE messages ADD COLUMN is_edited INTEGER NOT NULL DEFAULT 0",
  },
  { version: 7, sql: "ALTER TABLE messages ADD COLUMN previous_content TEXT" },
  { version: 8, sql: "ALTER TABLE messages ADD COLUMN context_snapshot TEXT" },
  {
    version: 9,
    sql: "ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL",
  },
  {
    version: 10,
    sql: "CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id, updated_at)",
  },
  { version: 11, sql: "ALTER TABLE projects ADD COLUMN config_json TEXT" },
  {
    // Recreate messages table to add 'team-activity' to the role CHECK constraint.
    // SQLite does not support ALTER COLUMN, so we do a table-swap migration.
    version: 12,
    sql: `
      CREATE TABLE IF NOT EXISTS messages_v12 (
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
      INSERT OR IGNORE INTO messages_v12 (id, conversation_id, role, content, model, is_edited, previous_content, context_snapshot, attachments, timestamp)
        SELECT id, conversation_id, role, content, model, is_edited, previous_content, context_snapshot, attachments, timestamp FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_v12 RENAME TO messages;
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp);
    `,
  },
  {
    version: 13,
    sql: `
      CREATE TABLE IF NOT EXISTS project_wiki_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        source_conversation_id TEXT,
        source_message_id TEXT,
        superseded_by TEXT REFERENCES project_wiki_entries(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_wiki_project ON project_wiki_entries(project_id, updated_at);
    `,
  },
  {
    version: 14,
    sql: `
      CREATE TABLE IF NOT EXISTS agent_delegations (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        leader_agent_id TEXT NOT NULL,
        specialist_agent_id TEXT NOT NULL,
        task TEXT NOT NULL,
        result TEXT,
        status TEXT NOT NULL CHECK (status IN ('done', 'error')),
        duration_ms INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_delegations_conversation ON agent_delegations(conversation_id, created_at);
    `,
  },
  {
    version: 15,
    sql: `
      UPDATE settings SET value = 'none' WHERE key = 'auth_mode' AND value = 'copilot';
      DELETE FROM settings WHERE key IN ('auth_token', 'auth_user');
      UPDATE agents
      SET config_json = replace(config_json, '"backend":"copilot-api"', '"backend":"gh-copilot"')
      WHERE instr(config_json, '"backend":"copilot-api"') > 0;
      UPDATE agents
      SET config_json = replace(config_json, '"backend": "copilot-api"', '"backend": "gh-copilot"')
      WHERE instr(config_json, '"backend": "copilot-api"') > 0;
    `,
  },
];


export function initializeBaseSchema(db: Database.Database): void {
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
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'team-activity')),
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

    CREATE TABLE IF NOT EXISTS agent_knowledge_files (
      id          TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL,
      file_path   TEXT NOT NULL,
      inject_mode TEXT NOT NULL DEFAULT 'always',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_mcp_tool_overrides (
      agent_id     TEXT NOT NULL,
      server_id    TEXT NOT NULL,
      tool_name    TEXT NOT NULL,
      enabled      INTEGER NOT NULL DEFAULT 1,
      approval     TEXT NOT NULL DEFAULT 'always-ask',
      instructions TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (agent_id, server_id, tool_name)
    );

    CREATE TABLE IF NOT EXISTS project_agents (
      project_id   TEXT NOT NULL,
      agent_id     TEXT NOT NULL,
      is_primary   INTEGER NOT NULL DEFAULT 0,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      added_at     INTEGER NOT NULL,
      PRIMARY KEY (project_id, agent_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id)   REFERENCES agents(id)   ON DELETE CASCADE
    );
  `);
}

function isIgnorableMigrationError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes("duplicate column name") || message.includes("already exists");
}

export function runMigrations(
  db: Database.Database,
  migrations: ReadonlyArray<Migration> = MIGRATIONS,
): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;
  const pending = migrations.filter((migration) => migration.version > currentVersion);

  if (pending.length === 0) {
    return;
  }

  const applyPendingMigrations = db.transaction(() => {
    for (const migration of pending) {
      try {
        db.exec(migration.sql);
      } catch (error: unknown) {
        if (!isIgnorableMigrationError(error)) {
          throw error;
        }
      }
    }

    db.pragma(`user_version = ${pending[pending.length - 1].version}`);
  });

  applyPendingMigrations();
}
