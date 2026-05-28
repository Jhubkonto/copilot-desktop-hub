import { randomUUID } from "crypto";
import { getDatabase } from "./database";
import { safeHandle } from "./safe-handle";

export function registerConversationHandlers(): void {
  const db = getDatabase();
  const ensureConversationModelColumn = () => {
    const columns = db
      .prepare("PRAGMA table_info(conversations)")
      .all() as Array<{ name: string }>;
    if (!columns.some((col) => col.name === "model")) {
      db.exec("ALTER TABLE conversations ADD COLUMN model TEXT");
    }
  };

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

  safeHandle("conversation:delete", (_event, id: string) => {
    db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    return true;
  });

  safeHandle("conversation:get-messages", (_event, conversationId: string) => {
    return db
      .prepare(
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC",
      )
      .all(conversationId);
  });

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
    (_event, id: string, model: string | null) => {
      ensureConversationModelColumn();
      db.prepare(
        "UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?",
      ).run(model, Date.now(), id);
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
