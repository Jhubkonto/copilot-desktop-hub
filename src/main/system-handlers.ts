import { app, BrowserWindow, dialog } from "electron";
import { writeFileSync } from "fs";
import { safeHandle } from "./safe-handle";

export function registerSystemHandlers(): void {
  safeHandle("app:get-version", () => {
    return app.getVersion();
  });

  safeHandle("app:get-runtime-info", () => {
    return { isPackaged: app.isPackaged };
  });

  safeHandle(
    "app:save-text-file",
    async (_event, defaultFileName: string, content: string) => {
      const win = BrowserWindow.getAllWindows()[0];
      const result = await dialog.showSaveDialog(win, {
        defaultPath: defaultFileName,
        filters: [
          { name: "JSON", extensions: ["json"] },
          { name: "Markdown", extensions: ["md"] },
          { name: "Text", extensions: ["txt"] },
        ],
      });
      if (result.canceled || !result.filePath) return null;
      writeFileSync(result.filePath, content, "utf-8");
      return result.filePath;
    },
  );

  safeHandle("app:set-auto-start", (_event, enabled: boolean) => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true,
    });
    return true;
  });
}
