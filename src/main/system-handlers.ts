import { app, BrowserWindow, dialog } from "electron";
import { writeFileSync } from "fs";
import { retrieveToken } from "./auth";
import { httpsRequestWithResponse } from "./http-client";
import { safeHandle } from "./safe-handle";

export function registerSystemHandlers(): void {
  safeHandle("app:get-version", () => {
    return app.getVersion();
  });

  safeHandle(
    "app:save-text-file",
    async (_event, defaultFileName: string, content: string) => {
      const win = BrowserWindow.getAllWindows()[0];
      const result = await dialog.showSaveDialog(win, {
        defaultPath: defaultFileName,
        filters: [
          { name: "Markdown", extensions: ["md"] },
          { name: "Text", extensions: ["txt"] },
        ],
      });
      if (result.canceled || !result.filePath) return null;
      writeFileSync(result.filePath, content, "utf-8");
      return result.filePath;
    },
  );

  safeHandle(
    "app:create-gist",
    async (_event, filename: string, content: string, description?: string) => {
      const githubToken = retrieveToken();
      if (!githubToken) {
        throw new Error("Not authenticated — sign in with GitHub first");
      }

      const body = JSON.stringify({
        description: description || "Shared from Copilot Desktop Hub",
        public: false,
        files: {
          [filename || "conversation.md"]: {
            content,
          },
        },
      });

      const response = await httpsRequestWithResponse(
        {
          hostname: "api.github.com",
          path: "/gists",
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${githubToken}`,
            "User-Agent": "CopilotDesktopHub",
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        body,
      );

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`GitHub Gist API error (HTTP ${response.status})`);
      }

      const parsed = JSON.parse(response.data) as { html_url?: string };
      if (!parsed.html_url) {
        throw new Error("GitHub Gist API did not return a URL");
      }
      return parsed.html_url;
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
