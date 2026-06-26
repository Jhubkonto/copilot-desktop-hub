import { BrowserWindow, dialog } from "electron";
import { randomUUID } from "crypto";
import { writeFileSync } from "fs";
import { getDatabase } from "./database";
import { safeHandle } from "./safe-handle";
import {
  DEFAULT_PROJECT_CONFIG,
  type ProjectConfig,
} from "../shared/types";

export { DEFAULT_PROJECT_CONFIG };

export const PROJECT_COLORS = new Set([
  "blue",
  "green",
  "red",
  "purple",
  "orange",
  "pink",
  "yellow",
  "gray",
]);

export function parseProjectConfig(
  configJson: string | null,
): ProjectConfig {
  if (!configJson) return { ...DEFAULT_PROJECT_CONFIG };
  try {
    const raw = JSON.parse(configJson) as Record<string, unknown>;
    // Defensive: rootDirectory may have been stored as an array (dialog returns filePaths array)
    if (Array.isArray(raw.rootDirectory)) {
      raw.rootDirectory = typeof raw.rootDirectory[0] === 'string' ? raw.rootDirectory[0] : '';
    }
    // Strip embedded newlines that can corrupt a path if instructions text was accidentally merged
    if (typeof raw.rootDirectory === 'string' && raw.rootDirectory.includes('\n')) {
      raw.rootDirectory = raw.rootDirectory.split('\n')[0]?.trim() ?? ''
    }
    return { ...DEFAULT_PROJECT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_PROJECT_CONFIG };
  }
}

export function registerProjectHandlers(): void {
  const db = getDatabase();

  safeHandle("project:list", () => {
    const rows = db
      .prepare("SELECT * FROM projects ORDER BY name ASC")
      .all() as Array<{
      id: string;
      name: string;
      color: string;
      default_model: string | null;
      config_json: string | null;
      created_at: number;
      updated_at: number;
    }>;
    return rows.map((r) => ({
      ...r,
      config: parseProjectConfig(r.config_json),
      config_json: undefined,
    }));
  });

  safeHandle("project:create", (_event, name: string, color: string) => {
    const safeName = String(name).trim().slice(0, 100);
    const safeColor = PROJECT_COLORS.has(color) ? color : "blue";
    if (!safeName) throw new Error("Project name is required");
    const id = randomUUID();
    const now = Date.now();
    const defaultConfig = JSON.stringify(DEFAULT_PROJECT_CONFIG);
    db.prepare(
      "INSERT INTO projects (id, name, color, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, safeName, safeColor, defaultConfig, now, now);
    return {
      id,
      name: safeName,
      color: safeColor,
      config: { ...DEFAULT_PROJECT_CONFIG },
      created_at: now,
      updated_at: now,
    };
  });

  safeHandle("project:rename", (_event, id: string, name: string) => {
    const safeName = String(name).trim().slice(0, 100);
    if (!safeName) throw new Error("Project name is required");
    db.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").run(
      safeName,
      Date.now(),
      id,
    );
    return true;
  });

  safeHandle("project:delete", (_event, id: string) => {
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    return true;
  });

  safeHandle("project:duplicate", (_event, id: string) => {
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
      | {
          id: string;
          name: string;
          color: string;
          config_json: string | null;
          default_model: string | null;
        }
      | undefined;
    if (!row) return null;
    const newId = randomUUID();
    const now = Date.now();
    db.prepare(
      "INSERT INTO projects (id, name, color, config_json, default_model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      newId,
      `${row.name} (copy)`,
      row.color,
      row.config_json,
      row.default_model,
      now,
      now,
    );
    return {
      id: newId,
      name: `${row.name} (copy)`,
      color: row.color,
      default_model: row.default_model,
      created_at: now,
      updated_at: now,
    };
  });

  safeHandle("project:export", async (_event, id: string) => {
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
      | {
          id: string;
          name: string;
          color: string;
          config_json: string | null;
          default_model: string | null;
        }
      | undefined;
    if (!row) return false;
    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${row.name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    const data = {
      name: row.name,
      color: row.color,
      default_model: row.default_model,
      config: row.config_json ? JSON.parse(row.config_json) : {},
    };
    writeFileSync(result.filePath, JSON.stringify(data, null, 2), "utf-8");
    return true;
  });

  safeHandle(
    "project:set-conversation",
    (_event, conversationId: string, projectId: string | null) => {
      db.prepare(
        "UPDATE conversations SET project_id = ?, updated_at = ? WHERE id = ?",
      ).run(projectId ?? null, Date.now(), conversationId);
      return true;
    },
  );

  safeHandle(
    "project:set-default-model",
    (_event, id: string, model: string | null) => {
      db.prepare(
        "UPDATE projects SET default_model = ?, updated_at = ? WHERE id = ?",
      ).run(model ?? null, Date.now(), id);
      return true;
    },
  );

  safeHandle(
    "project:update-config",
    (_event, id: string, config: Record<string, unknown>) => {
      const existing = db
        .prepare("SELECT config_json FROM projects WHERE id = ?")
        .get(id) as { config_json: string | null } | undefined;
      const current = existing?.config_json
        ? (JSON.parse(existing.config_json) as Record<string, unknown>)
        : {};
      // Coerce rootDirectory array to string (can happen when dialog filePaths array is stored directly)
      if (Array.isArray(config.rootDirectory)) {
        config.rootDirectory = typeof config.rootDirectory[0] === 'string' ? config.rootDirectory[0] : '';
      }
      if (typeof config.rootDirectory === 'string' && config.rootDirectory.includes('\n')) {
        config.rootDirectory = config.rootDirectory.split('\n')[0]?.trim() ?? ''
      }
      const merged = { ...current, ...config };
      db.prepare(
        "UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ?",
      ).run(JSON.stringify(merged), Date.now(), id);
      return true;
    },
  );

  safeHandle("project:get-config", (_event, id: string) => {
    const row = db
      .prepare("SELECT config_json FROM projects WHERE id = ?")
      .get(id) as { config_json: string | null } | undefined;
    return parseProjectConfig(row?.config_json ?? null);
  });
}

export function registerProjectAgentHandlers(): void {
  const db = getDatabase();

  safeHandle("project:list-agents", (_event, projectId: string) => {
    const rows = db
      .prepare(
        "SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON a.id = pa.agent_id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC, pa.added_at ASC",
      )
      .all(projectId) as {
      agent_id: string;
      config_json: string;
      is_primary: number;
      sort_order: number;
    }[];
    return rows.map((r) => {
      const cfg = JSON.parse(r.config_json) as { name?: string; icon?: string };
      return {
        agentId: r.agent_id,
        agentName: cfg.name ?? "",
        agentIcon: cfg.icon ?? "",
        isPrimary: r.is_primary === 1,
        sortOrder: r.sort_order,
      };
    });
  });

  safeHandle(
    "project:add-agent",
    (_event, projectId: string, agentId: string) => {
      db.prepare(
        "INSERT OR IGNORE INTO project_agents (project_id, agent_id, is_primary, sort_order, added_at) VALUES (?, ?, 0, 0, ?)",
      ).run(projectId, agentId, Date.now());
      return true;
    },
  );

  safeHandle(
    "project:remove-agent",
    (_event, projectId: string, agentId: string) => {
      db.prepare(
        "DELETE FROM project_agents WHERE project_id = ? AND agent_id = ?",
      ).run(projectId, agentId);
      return true;
    },
  );

  safeHandle(
    "project:set-primary-agent",
    (_event, projectId: string, agentId: string) => {
      const setPrimary = db.transaction(() => {
        db.prepare(
          "UPDATE project_agents SET is_primary = 0 WHERE project_id = ?",
        ).run(projectId);
        db.prepare(
          "UPDATE project_agents SET is_primary = 1 WHERE project_id = ? AND agent_id = ?",
        ).run(projectId, agentId);
      });
      setPrimary();
      return true;
    },
  );

  safeHandle(
    "project:reorder-agents",
    (_event, projectId: string, orderedAgentIds: string[]) => {
      const update = db.prepare(
        "UPDATE project_agents SET sort_order = ? WHERE project_id = ? AND agent_id = ?",
      );
      const reorder = db.transaction(() => {
        orderedAgentIds.forEach((agentId, index) => {
          update.run(index, projectId, agentId);
        });
      });
      reorder();
      return true;
    },
  );
}
