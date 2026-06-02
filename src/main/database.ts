import Database from "better-sqlite3";
import { existsSync, mkdirSync, renameSync } from "fs";
import { app } from "electron";
import { join } from "path";

import { initializeBaseSchema, runMigrations } from "./database-migrations";

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const userDataPath = app.getPath("userData");
  const dbDir = join(userDataPath, "data");

  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = join(dbDir, "nexy.db");
  // Migrate from old filename on first run after rename
  const legacyPath = join(dbDir, "copilot-hub.db");
  if (!existsSync(dbPath) && existsSync(legacyPath)) {
    renameSync(legacyPath, dbPath);
  }
  db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  initializeSchema(db);

  return db;
}

function initializeSchema(db: Database.Database): void {
  initializeBaseSchema(db);
  runMigrations(db);

  const insertSetting = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
  );
  insertSetting.run("theme", "dark");
  insertSetting.run("globalHotkey", "Ctrl+Shift+H");
  insertSetting.run("autoStart", "false");
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
