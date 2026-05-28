import { getDatabase } from "./database";
import { safeHandle } from "./safe-handle";

export function registerSettingsHandlers(): void {
  const db = getDatabase();

  safeHandle("app:get-settings", () => {
    const rows = db.prepare("SELECT key, value FROM settings").all() as {
      key: string;
      value: string;
    }[];
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  });

  safeHandle("app:get-setting", (_event, key: string) => {
    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as
      | {
          value: string;
        }
      | undefined;
    return row?.value ?? null;
  });

  safeHandle("app:set-setting", (_event, key: string, value: string) => {
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ).run(key, value);
    return true;
  });

  safeHandle("app:get-theme", () => {
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'theme'")
      .get() as { value: string } | undefined;
    return row?.value ?? "dark";
  });

  safeHandle("app:set-theme", (_event, theme: string) => {
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('theme', ?)",
    ).run(theme);
    return true;
  });
}
