import { randomUUID } from "crypto";
import { getActiveChatTurnSnapshot } from "./active-chat-turns";
import { BrowserWindow, dialog } from "electron";
import { readFileSync } from "fs";
import { getDatabase } from "./database";
import { safeHandle } from "./safe-handle";
import type {
  ConversationCompressionSaveInput,
  ConversationExportPackOptions,
  ConversationForkOptions,
  ConversationImportOptions,
} from "../shared/types";
import { buildConversationExport, buildConversationExportPack } from "./conversation-export";
import { importConversationExport } from "./conversation-import";
import { forkConversation } from "./conversation-fork";
import {
  getConversationCompressionPreview,
  prepareConversationCompressionSummary,
  saveConversationCompressionSummary,
} from "./conversation-compression";
import { parseConversationExport } from "./conversation-serialization";

export {
  buildConversationExport,
  buildConversationExportPack,
  importConversationExport,
  forkConversation,
  prepareConversationCompressionSummary,
  saveConversationCompressionSummary,
  getConversationCompressionPreview,
};

export function registerConversationHandlers(): void {
  const db = getDatabase();
  const columns = db
    .prepare("PRAGMA table_info(conversations)")
    .all() as Array<{ name: string }>;
  const ensureConversationModelColumn = () => {
    if (!columns.some((col) => col.name === "model")) {
      db.exec("ALTER TABLE conversations ADD COLUMN model TEXT");
      columns.push({ name: "model" });
    }
  };
  // Eagerly ensure cli_backend exists so chat dispatch can SELECT it safely.
  if (!columns.some((col) => col.name === "cli_backend")) {
    db.exec("ALTER TABLE conversations ADD COLUMN cli_backend TEXT");
  }

  safeHandle("conversation:list", () => {
    return db
      .prepare("SELECT * FROM conversations ORDER BY updated_at DESC")
      .all();
  });

  safeHandle(
    "conversation:create",
    (_event, agentId?: string, projectId?: string) => {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        "INSERT INTO conversations (id, agent_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, agentId ?? null, projectId ?? null, "New Chat", now, now);
      return {
        id,
        agent_id: agentId ?? null,
        project_id: projectId ?? null,
        title: "New Chat",
        created_at: now,
        updated_at: now,
      };
    },
  );

  safeHandle("conversation:compression-preview", (_event, conversationId: string) => {
    return getConversationCompressionPreview(db, conversationId);
  });

  safeHandle("conversation:prepare-compression-summary", (_event, conversationId: string) => {
    return prepareConversationCompressionSummary(db, conversationId);
  });

  safeHandle("conversation:save-compression-summary", (_event, input: ConversationCompressionSaveInput) => {
    return saveConversationCompressionSummary(db, input);
  });

  safeHandle("conversation:delete", (_event, id: string) => {
    db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    return true;
  });

  safeHandle("conversation:export-json", (_event, conversationId: string) => {
    return buildConversationExport(db, conversationId);
  });

  safeHandle("conversation:export-pack", (_event, conversationId: string, options?: ConversationExportPackOptions) => {
    return buildConversationExportPack(db, conversationId, options ?? { format: "json" });
  });

  safeHandle("conversation:fork", (_event, conversationId: string, options?: ConversationForkOptions) => {
    return forkConversation(db, conversationId, options);
  });

  safeHandle("conversation:import-json", async (_event, options?: ConversationImportOptions) => {
    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: "Import conversation",
      properties: ["openFile"],
      filters: [
        { name: "Nexy conversation", extensions: ["json"] },
        { name: "JSON", extensions: ["json"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const raw = readFileSync(result.filePaths[0], "utf-8");
    const exported = parseConversationExport(JSON.parse(raw));
    return importConversationExport(db, exported, options);
  });

  safeHandle("conversation:get-messages", (_event, conversationId: string) => {
    return db
      .prepare(
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC",
      )
      .all(conversationId);
  });

  safeHandle("chat:get-active-turn", (_event, conversationId: string) => {
    return getActiveChatTurnSnapshot(conversationId);
  });

  safeHandle(
    "conversation:insert-message",
    (_event, conversationId: string, role: string, content: string) => {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        "INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)",
      ).run(id, conversationId, role, content, now);
      db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
      return db.prepare("SELECT * FROM messages WHERE id = ?").get(id);
    },
  );

  safeHandle("conversation:search", (_event, query: string) => {
    if (!query.trim()) {
      return db
        .prepare("SELECT * FROM conversations ORDER BY updated_at DESC")
        .all();
    }
    const searchTerm = `%${query}%`;
    return db
      .prepare(
        `SELECT DISTINCT c.* FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.title LIKE ? OR m.content LIKE ?
         ORDER BY c.updated_at DESC`,
      )
      .all(searchTerm, searchTerm);
  });

  safeHandle("conversation:rename", (_event, id: string, title: string) => {
    db.prepare(
      "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
    ).run(title, Date.now(), id);
    return true;
  });

  safeHandle(
    "conversation:set-model",
    (_event, id: string, model: string | null, cliBackend?: string | null) => {
      ensureConversationModelColumn();
      db.prepare(
        "UPDATE conversations SET model = ?, cli_backend = ?, updated_at = ? WHERE id = ?",
      ).run(model, cliBackend ?? null, Date.now(), id);
      return true;
    },
  );

  safeHandle(
    "conversation:set-pinned",
    (_event, id: string, pinned: boolean) => {
      db.prepare(
        "UPDATE conversations SET pinned = ?, updated_at = ? WHERE id = ?",
      ).run(pinned ? 1 : 0, Date.now(), id);
      return true;
    },
  );

  safeHandle(
    "conversation:update-context",
    (
      _event,
      updates: { conversationId: string; projectId?: string | null; agentId?: string | null },
    ) => {
      const assignments: string[] = [];
      const values: Array<string | number | null> = [];

      if (Object.prototype.hasOwnProperty.call(updates, "projectId")) {
        assignments.push("project_id = ?");
        values.push(updates.projectId ?? null);
      }
      if (Object.prototype.hasOwnProperty.call(updates, "agentId")) {
        assignments.push("agent_id = ?");
        values.push(updates.agentId ?? null);
      }
      if (assignments.length === 0) {
        return true;
      }

      assignments.push("updated_at = ?");
      values.push(Date.now());
      values.push(updates.conversationId);
      db.prepare(
        `UPDATE conversations SET ${assignments.join(", ")} WHERE id = ?`,
      ).run(...values);
      return true;
    },
  );
}

export function registerMessageHandlers(): void {
  const db = getDatabase();

  safeHandle("message:delete", (_event, id: string) => {
    db.prepare("DELETE FROM messages WHERE id = ?").run(id);
    return true;
  });

  safeHandle(
    "message:delete-after",
    (_event, conversationId: string, timestamp: number) => {
      db.prepare(
        "DELETE FROM messages WHERE conversation_id = ? AND timestamp >= ?",
      ).run(conversationId, timestamp);
      return true;
    },
  );
}
