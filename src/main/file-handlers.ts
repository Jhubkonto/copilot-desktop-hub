import { app, BrowserWindow, dialog } from "electron";
import { randomUUID } from "crypto";
import { readFileSync, statSync, existsSync, readdirSync } from "fs";
import { basename, isAbsolute, join, resolve } from "path";
import { execSync } from "child_process";
import { getDatabase } from "./database";
import { safeHandle } from "./safe-handle";

export function registerFileHandlers(): void {
  const db = getDatabase();

  safeHandle("file:open-dialog", async () => {
    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Code & Text",
          extensions: [
            "ts",
            "tsx",
            "js",
            "jsx",
            "py",
            "rs",
            "go",
            "java",
            "cpp",
            "c",
            "h",
            "hpp",
            "cs",
            "rb",
            "php",
            "swift",
            "kt",
            "scala",
            "sh",
            "bash",
            "zsh",
            "ps1",
            "sql",
            "json",
            "yaml",
            "yml",
            "toml",
            "xml",
            "html",
            "css",
            "scss",
            "less",
            "md",
            "txt",
            "csv",
            "log",
            "env",
            "cfg",
            "ini",
            "conf",
          ],
        },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (result.canceled) return [];

    return result.filePaths.map((filePath) => {
      const stat = statSync(filePath);
      return {
        id: randomUUID(),
        name: basename(filePath),
        path: filePath,
        size: stat.size,
      };
    });
  });

  safeHandle("file:get-cwd", () => {
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'working_directory'")
      .get() as { value: string } | undefined;
    if (row?.value) return row.value;
    const defaultDir = app.getPath("home");
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('working_directory', ?)",
    ).run(defaultDir);
    return defaultDir;
  });

  safeHandle("file:set-cwd", (_event, cwd: string) => {
    if (!cwd || !existsSync(cwd)) {
      throw new Error(`Directory does not exist: ${cwd}`);
    }
    const stat = statSync(cwd);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${cwd}`);
    }
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('working_directory', ?)",
    ).run(cwd);
    return true;
  });

  safeHandle("file:get-recent-dirs", () => {
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'recent_directories'")
      .get() as { value: string } | undefined;
    try {
      return row ? JSON.parse(row.value) : [];
    } catch {
      return [];
    }
  });

  safeHandle("file:add-recent-dir", (_event, path: string) => {
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'recent_directories'")
      .get() as { value: string } | undefined;
    let dirs: string[] = [];
    try {
      dirs = row ? JSON.parse(row.value) : [];
    } catch {
      dirs = [];
    }
    dirs = [path, ...dirs.filter((d: string) => d !== path)].slice(0, 5);
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('recent_directories', ?)",
    ).run(JSON.stringify(dirs));
    return dirs;
  });

  safeHandle('fs:list-directory', (_event, path: string, depth?: number) => {
    if (!path) throw new Error('Path is required')
    if (!existsSync(path)) throw new Error(`Directory does not exist: ${path}`)
    const stat = statSync(path)
    if (!stat.isDirectory()) throw new Error(`Path is not a directory: ${path}`)
    return listDirectoryEntries(path, depth ?? 3, '')
  })
}

export interface DirectoryEntry {
  name: string
  relativePath: string
  type: 'file' | 'dir'
}

const FS_IGNORE = new Set([
  '.git', 'node_modules', 'dist', '.next', '__pycache__',
  '.cache', 'coverage', '.nyc_output', 'build', 'out',
  '.DS_Store', 'Thumbs.db', '.svn', '.hg',
])

export function listDirectoryEntries(
  rootPath: string,
  maxDepth: number,
  relBase: string,
): DirectoryEntry[] {
  if (maxDepth <= 0) return []
  let entries: DirectoryEntry[]
  try {
    entries = readdirSync(rootPath).map((name) => {
      const fullPath = join(rootPath, name)
      const relativePath = relBase ? `${relBase}/${name}` : name
      try {
        const s = statSync(fullPath)
        return { name, relativePath, type: s.isDirectory() ? ('dir' as const) : ('file' as const) }
      } catch {
        return null
      }
    }).filter((e): e is DirectoryEntry => e !== null)
  } catch {
    return []
  }

  const result: DirectoryEntry[] = []
  for (const entry of entries) {
    if (FS_IGNORE.has(entry.name)) continue
    result.push(entry)
    if (entry.type === 'dir') {
      const children = listDirectoryEntries(
        join(rootPath, entry.name),
        maxDepth - 1,
        entry.relativePath,
      )
      result.push(...children)
    }
  }
  return result
}

export function getWorkingDirectory(): string {
  const db = getDatabase();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'working_directory'")
    .get() as { value: string } | undefined;
  if (row?.value && existsSync(row.value)) return row.value;
  return app.getPath("home");
}

export function registerContextHandlers(): void {
  safeHandle("context:read-file", (_event, filePath: string) => {
    if (!filePath) {
      throw new Error("File path is required");
    }
    const cwd = getWorkingDirectory();
    const resolvedPath = isAbsolute(filePath)
      ? filePath
      : resolve(cwd, filePath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`File does not exist: ${resolvedPath}`);
    }
    const content = readFileSync(resolvedPath, "utf-8");
    const limit = 12000;
    const truncated = content.length > limit;
    return {
      path: resolvedPath,
      content: truncated
        ? `${content.slice(0, limit)}\n\n...[truncated]`
        : content,
      truncated,
    };
  });

  safeHandle("context:workspace-summary", () => {
    const cwd = getWorkingDirectory();
    const maxDepth = 3;
    const maxEntries = 200;
    const ignored = new Set([".git", "node_modules", "dist", "release"]);
    const lines: string[] = [cwd];
    let entryCount = 0;
    const walk = (dir: string, depth: number) => {
      if (depth > maxDepth || entryCount >= maxEntries) return;
      const entries = readdirSync(dir, { withFileTypes: true }).filter(
        (entry) => !ignored.has(entry.name),
      );
      for (const entry of entries) {
        if (entryCount >= maxEntries) break;
        const indent = "  ".repeat(depth);
        lines.push(`${indent}- ${entry.name}${entry.isDirectory() ? "/" : ""}`);
        entryCount += 1;
        if (entry.isDirectory()) {
          walk(join(dir, entry.name), depth + 1);
        }
      }
    };
    walk(cwd, 1);
    return lines.join("\n");
  });

  safeHandle("context:git", () => {
    const cwd = getWorkingDirectory();
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd,
        encoding: "utf8",
      }).trim();
      const status = execSync("git status --short", {
        cwd,
        encoding: "utf8",
      }).trim();
      const recent = execSync("git log -5 --oneline", {
        cwd,
        encoding: "utf8",
      }).trim();
      return [
        `Branch: ${branch}`,
        "",
        "Status:",
        status || "(clean)",
        "",
        "Recent commits:",
        recent || "(none)",
      ].join("\n");
    } catch {
      return "Git context unavailable for the current working directory.";
    }
  });

  safeHandle("context:git-diff", () => {
    const cwd = getWorkingDirectory();
    try {
      // Check for a valid HEAD first (new repo with no commits has no HEAD)
      try {
        execSync("git rev-parse HEAD", { cwd, encoding: "utf8" });
      } catch {
        return "No commits yet — diff unavailable.";
      }

      const stat = execSync("git diff --stat HEAD", {
        cwd,
        encoding: "utf8",
      }).trim();

      if (!stat) {
        return "No changes since last commit.";
      }

      // Cap the stat output to avoid context overflows
      const lines = stat.split("\n");
      const MAX_LINES = 150;
      const truncated = lines.length > MAX_LINES;
      const output = truncated
        ? lines.slice(0, MAX_LINES).join("\n") + `\n... (${lines.length - MAX_LINES} more lines truncated)`
        : stat;

      return `Diff summary (staged + unstaged vs HEAD):\n\n${output}`;
    } catch {
      return "Git diff unavailable for the current working directory.";
    }
  });
}
