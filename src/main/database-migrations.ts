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
  {
    // Recreate messages table to add 'tool-call' to the role CHECK constraint.
    // CLI adapters persist completed tool calls as history messages so they can
    // be replayed after reopening desktop or Android chat windows.
    version: 16,
    sql: `
      CREATE TABLE IF NOT EXISTS messages_v16 (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'team-activity', 'tool-call')),
        content TEXT NOT NULL,
        model TEXT,
        is_edited INTEGER NOT NULL DEFAULT 0,
        previous_content TEXT,
        context_snapshot TEXT,
        attachments TEXT,
        timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      INSERT OR IGNORE INTO messages_v16 (id, conversation_id, role, content, model, is_edited, previous_content, context_snapshot, attachments, timestamp)
        SELECT id, conversation_id, role, content, model, is_edited, previous_content, context_snapshot, attachments, timestamp FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_v16 RENAME TO messages;
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp);
    `,
  },
  {
    version: 17,
    sql: `
      CREATE TABLE IF NOT EXISTS prompt_library_entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'Custom',
        tags TEXT NOT NULL DEFAULT '[]',
        scope TEXT NOT NULL CHECK (scope IN ('global', 'project')) DEFAULT 'global',
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_prompt_library_scope
        ON prompt_library_entries(scope, project_id, category, updated_at);
    `,
  },
  {
    version: 18,
    sql: `
      CREATE TABLE IF NOT EXISTS prompt_library_versions (
        id TEXT PRIMARY KEY,
        prompt_id TEXT NOT NULL REFERENCES prompt_library_entries(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'Custom',
        tags TEXT NOT NULL DEFAULT '[]',
        scope TEXT NOT NULL CHECK (scope IN ('global', 'project')) DEFAULT 'global',
        project_id TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        UNIQUE(prompt_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt
        ON prompt_library_versions(prompt_id, version DESC);
    `,
  },
  {
    version: 19,
    sql: `
      CREATE TABLE IF NOT EXISTS conversation_summaries (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
        summary TEXT NOT NULL,
        source_message_count INTEGER NOT NULL,
        retained_message_count INTEGER NOT NULL,
        estimated_tokens_before INTEGER NOT NULL,
        target_budget INTEGER NOT NULL,
        strategy TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_summaries_updated
        ON conversation_summaries(updated_at);
    `,
  },
  {
    version: 20,
    sql: "ALTER TABLE conversation_summaries ADD COLUMN summary_json TEXT NOT NULL DEFAULT '{}'",
  },
  {
    version: 21,
    sql: `
      CREATE TABLE IF NOT EXISTS build_records (
        id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        commit_sha TEXT,
        branch TEXT,
        version TEXT,
        platform TEXT NOT NULL,
        command TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        exit_code INTEGER,
        version_code INTEGER,
        artifact_paths TEXT,
        artifact_checksums TEXT,
        log_tail TEXT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER
      )
    `,
  },
  {
    version: 22,
    sql: `
      ALTER TABLE build_records ADD COLUMN version_code INTEGER;
      ALTER TABLE build_records ADD COLUMN artifact_checksums TEXT;
    `,
  },
  {
    version: 23,
    sql: `
      CREATE TABLE IF NOT EXISTS mobile_clients (
        device_id TEXT PRIMARY KEY,
        fcm_token TEXT NOT NULL,
        registered_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 24,
    sql: `
      CREATE TABLE IF NOT EXISTS error_log (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK (source IN ('main', 'renderer', 'unhandled')),
        level TEXT NOT NULL CHECK (level IN ('error', 'warn', 'info', 'debug')),
        message TEXT NOT NULL,
        stack TEXT,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_error_log_timestamp ON error_log(timestamp);
    `,
  },
  {
    version: 25,
    sql: `
      CREATE TABLE IF NOT EXISTS error_reports (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        screenshot_path TEXT,
        log_snapshot TEXT,
        status TEXT NOT NULL CHECK (status IN ('open', 'investigating', 'investigated', 'fixed', 'rejected')) DEFAULT 'open',
        app_version TEXT,
        platform TEXT,
        os_version TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_error_reports_status_created
        ON error_reports(status, created_at);
    `,
  },
  {
    version: 26,
    sql: `
      ALTER TABLE error_reports ADD COLUMN investigation_markdown TEXT;
      ALTER TABLE error_reports ADD COLUMN investigation_confidence TEXT;
      ALTER TABLE error_reports ADD COLUMN investigation_root_cause TEXT;
      ALTER TABLE error_reports ADD COLUMN investigation_affected_files TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE error_reports ADD COLUMN investigation_started_at INTEGER;
      ALTER TABLE error_reports ADD COLUMN investigation_completed_at INTEGER;
    `,
  },
  {
    version: 27,
    sql: `
      ALTER TABLE error_reports ADD COLUMN fix_status TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE error_reports ADD COLUMN fix_staged_files TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE error_reports ADD COLUMN fix_started_at INTEGER;
      ALTER TABLE error_reports ADD COLUMN fix_completed_at INTEGER;
      ALTER TABLE error_reports ADD COLUMN fix_error TEXT;
    `,
  },
  {
    version: 28,
    sql: `
      CREATE TABLE IF NOT EXISTS self_heal_diffs (
        report_id     TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        diff_json     TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        PRIMARY KEY (report_id, relative_path)
      );
    `,
  },
  {
    version: 29,
    sql: `
      CREATE TABLE IF NOT EXISTS self_heal_verification_runs (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
        steps_json TEXT NOT NULL DEFAULT '[]',
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        retry_count INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_self_heal_verification_report
        ON self_heal_verification_runs(report_id, started_at);
    `,
  },
  {
    version: 30,
    sql: `
      CREATE TABLE IF NOT EXISTS self_heal_recovery_runs (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('prepared', 'reloading', 'confirmed', 'rollback-required', 'rolled-back', 'failed')),
        target_commit_sha TEXT,
        target_version TEXT,
        backup_manifest_json TEXT NOT NULL DEFAULT '[]',
        pre_reload_state_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        confirmed_at INTEGER,
        rollback_at INTEGER,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_self_heal_recovery_report
        ON self_heal_recovery_runs(report_id, created_at);
    `,
  },
  {
    version: 31,
    sql: `
      CREATE TABLE IF NOT EXISTS self_heal_history (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        report_title TEXT NOT NULL DEFAULT '',
        investigation_model TEXT,
        investigation_backend TEXT,
        investigation_rounds INTEGER NOT NULL DEFAULT 0,
        fix_applied_at INTEGER,
        verification_passed INTEGER NOT NULL DEFAULT 0,
        verification_failed_step TEXT,
        committed INTEGER NOT NULL DEFAULT 0,
        commit_sha TEXT,
        pushed INTEGER NOT NULL DEFAULT 0,
        reloaded INTEGER NOT NULL DEFAULT 0,
        rolled_back INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'investigating',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_self_heal_history_created
        ON self_heal_history(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_self_heal_history_report
        ON self_heal_history(report_id);
    `,
  },
  {
    version: 32,
    sql: `
      CREATE TABLE IF NOT EXISTS feature_generator_runs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'drafting',
        spec_json TEXT,
        team_json TEXT,
        plan_markdown TEXT,
        staged_files_json TEXT,
        applied_files_json TEXT,
        verification_json TEXT,
        commit_sha TEXT,
        reloaded INTEGER NOT NULL DEFAULT 0,
        rolled_back INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_feature_generator_runs_created
        ON feature_generator_runs(created_at DESC);
    `,
  },
  {
    version: 33,
    sql: `
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        description TEXT,
        storage_root TEXT NOT NULL,
        current_version_id TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_project
        ON artifacts(project_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS artifact_versions (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        notes TEXT,
        spec_json TEXT,
        manifest_json TEXT NOT NULL,
        source_conversation_id TEXT,
        source_message_id TEXT,
        created_by_agent_ids TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact
        ON artifact_versions(artifact_id, version_number DESC);

      CREATE TABLE IF NOT EXISTS artifact_files (
        id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        absolute_path TEXT NOT NULL,
        media_type TEXT NOT NULL,
        role TEXT NOT NULL,
        size_bytes INTEGER,
        checksum TEXT
      );

      CREATE TABLE IF NOT EXISTS artifact_chat_refs (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
        version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE CASCADE,
        project_id TEXT,
        conversation_id TEXT NOT NULL,
        message_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE IF NOT EXISTS artifact_generator_runs (
        id TEXT PRIMARY KEY,
        artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'chatting',
        spec_json TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
    `,
  },
  {
    version: 34,
    sql: `
      CREATE TABLE IF NOT EXISTS agent_mcp_server_trust (
        agent_id  TEXT NOT NULL,
        server_id TEXT NOT NULL,
        trust     TEXT NOT NULL DEFAULT 'always-ask',
        PRIMARY KEY (agent_id, server_id),
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 35,
    sql: `
      DROP TABLE IF EXISTS feature_generator_runs;
    `,
  },
  {
    version: 36,
    sql: `ALTER TABLE messages ADD COLUMN thinking_blocks TEXT`,
  },
  {
    version: 37,
    sql: `
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE IF NOT EXISTS agent_skills (
        agent_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        attached_at INTEGER NOT NULL,
        PRIMARY KEY (agent_id, skill_id),
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_agent_skills_agent
        ON agent_skills(agent_id, sort_order);
    `,
  },
  {
    version: 38,
    sql: `
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        agent_id TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        model TEXT,
        conversation_id TEXT,
        schedule_type TEXT NOT NULL CHECK (schedule_type IN ('one-time', 'daily', 'weekdays', 'weekly', 'monthly')),
        local_time TEXT NOT NULL,
        weekday INTEGER,
        month_day INTEGER,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        tool_policy_json TEXT NOT NULL DEFAULT '{"preApproved":[],"alwaysAsk":[],"neverAllow":[]}',
        notification_pref TEXT NOT NULL DEFAULT 'failures_only' CHECK (notification_pref IN ('always', 'failures_only', 'off')),
        next_run_at INTEGER,
        last_run_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled
        ON scheduled_tasks(enabled, next_run_at);
    `,
  },
  {
    version: 39,
    sql: `
      CREATE TABLE IF NOT EXISTS scheduled_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
        scheduled_at INTEGER,
        started_at INTEGER,
        finished_at INTEGER,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'approval_required', 'success', 'failed', 'skipped')) DEFAULT 'pending',
        error TEXT,
        conversation_id TEXT,
        message_id TEXT,
        trigger_source TEXT NOT NULL CHECK (trigger_source IN ('scheduled', 'manual')) DEFAULT 'scheduled',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        UNIQUE(task_id, scheduled_at)
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_runs_task
        ON scheduled_runs(task_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scheduled_runs_status
        ON scheduled_runs(status, created_at DESC);
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
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'team-activity', 'tool-call')),
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

    CREATE TABLE IF NOT EXISTS error_log (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK (source IN ('main', 'renderer', 'unhandled')),
      level TEXT NOT NULL CHECK (level IN ('error', 'warn', 'info', 'debug')),
      message TEXT NOT NULL,
      stack TEXT,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_error_log_timestamp
      ON error_log(timestamp);

    CREATE TABLE IF NOT EXISTS error_reports (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      screenshot_path TEXT,
      log_snapshot TEXT,
      status TEXT NOT NULL CHECK (status IN ('open', 'investigating', 'investigated', 'fixed', 'rejected')) DEFAULT 'open',
      app_version TEXT,
      platform TEXT,
      os_version TEXT,
      investigation_markdown TEXT,
      investigation_confidence TEXT,
      investigation_root_cause TEXT,
      investigation_affected_files TEXT NOT NULL DEFAULT '[]',
      investigation_started_at INTEGER,
      investigation_completed_at INTEGER,
      fix_status TEXT NOT NULL DEFAULT 'none',
      fix_staged_files TEXT NOT NULL DEFAULT '[]',
      fix_started_at INTEGER,
      fix_completed_at INTEGER,
      fix_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_error_reports_status_created
      ON error_reports(status, created_at);

    CREATE TABLE IF NOT EXISTS self_heal_diffs (
      report_id     TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      diff_json     TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      PRIMARY KEY (report_id, relative_path)
    );

    CREATE TABLE IF NOT EXISTS self_heal_verification_runs (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
      steps_json TEXT NOT NULL DEFAULT '[]',
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      retry_count INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_self_heal_verification_report
      ON self_heal_verification_runs(report_id, started_at);

    CREATE TABLE IF NOT EXISTS self_heal_recovery_runs (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('prepared', 'reloading', 'confirmed', 'rollback-required', 'rolled-back', 'failed')),
      target_commit_sha TEXT,
      target_version TEXT,
      backup_manifest_json TEXT NOT NULL DEFAULT '[]',
      pre_reload_state_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      confirmed_at INTEGER,
      rollback_at INTEGER,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_self_heal_recovery_report
      ON self_heal_recovery_runs(report_id, created_at);

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS agent_skills (
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      attached_at INTEGER NOT NULL,
      PRIMARY KEY (agent_id, skill_id),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agent_skills_agent
      ON agent_skills(agent_id, sort_order);

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

    CREATE TABLE IF NOT EXISTS prompt_library_entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Custom',
      tags TEXT NOT NULL DEFAULT '[]',
      scope TEXT NOT NULL CHECK (scope IN ('global', 'project')) DEFAULT 'global',
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_prompt_library_scope
      ON prompt_library_entries(scope, project_id, category, updated_at);

    CREATE TABLE IF NOT EXISTS prompt_library_versions (
      id TEXT PRIMARY KEY,
      prompt_id TEXT NOT NULL REFERENCES prompt_library_entries(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Custom',
      tags TEXT NOT NULL DEFAULT '[]',
      scope TEXT NOT NULL CHECK (scope IN ('global', 'project')) DEFAULT 'global',
      project_id TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(prompt_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt
      ON prompt_library_versions(prompt_id, version DESC);

    CREATE TABLE IF NOT EXISTS conversation_summaries (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      summary_json TEXT NOT NULL DEFAULT '{}',
      source_message_count INTEGER NOT NULL,
      retained_message_count INTEGER NOT NULL,
      estimated_tokens_before INTEGER NOT NULL,
      target_budget INTEGER NOT NULL,
      strategy TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_summaries_updated
      ON conversation_summaries(updated_at);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      agent_id TEXT,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      model TEXT,
      conversation_id TEXT,
      schedule_type TEXT NOT NULL CHECK (schedule_type IN ('one-time', 'daily', 'weekdays', 'weekly', 'monthly')),
      local_time TEXT NOT NULL,
      weekday INTEGER,
      month_day INTEGER,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      tool_policy_json TEXT NOT NULL DEFAULT '{"preApproved":[],"alwaysAsk":[],"neverAllow":[]}',
      notification_pref TEXT NOT NULL DEFAULT 'failures_only' CHECK (notification_pref IN ('always', 'failures_only', 'off')),
      next_run_at INTEGER,
      last_run_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled
      ON scheduled_tasks(enabled, next_run_at);

    CREATE TABLE IF NOT EXISTS scheduled_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      scheduled_at INTEGER,
      started_at INTEGER,
      finished_at INTEGER,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'approval_required', 'success', 'failed', 'skipped')) DEFAULT 'pending',
      error TEXT,
      conversation_id TEXT,
      message_id TEXT,
      trigger_source TEXT NOT NULL CHECK (trigger_source IN ('scheduled', 'manual')) DEFAULT 'scheduled',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(task_id, scheduled_at)
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_runs_task
      ON scheduled_runs(task_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_scheduled_runs_status
      ON scheduled_runs(status, created_at DESC);
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
