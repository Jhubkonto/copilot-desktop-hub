import { app, BrowserWindow, dialog } from "electron";
import { randomUUID } from "crypto";
import { readFileSync, statSync, existsSync, readdirSync, openSync, readSync, closeSync, realpathSync } from "fs";
import { readdir } from "fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "path";
import { TextDecoder } from "util";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
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

export interface FsRemoteEntry extends DirectoryEntry {
  // Absolute path, joined server-side with the platform's own separator — the remote (Android)
  // caller must never construct this itself, since it has no idea if the desktop is Windows or
  // POSIX underneath.
  fullPath: string
}

export interface FsRemoteListResult {
  entries: FsRemoteEntry[]
  truncated: boolean
  error?: string
}

const FS_REMOTE_LIST_LIMIT = 2000

// Depth-1 only (unlike the local `fs:list-directory` IPC channel's depth=3 default) — this
// is called over the WebSocket by the Android remote workspace explorer, which lazily
// re-requests on each folder tap rather than pre-fetching a deep tree over the network.
function pathIsWithinRoot(candidate: string, root: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** Remote file access is limited to locations the desktop exposes in its explorer. */
export function isRemotePathAuthorized(filePath: string, authorizedRoots: string[]): boolean {
  if (!filePath || authorizedRoots.length === 0) return false
  try {
    const candidate = resolve(realpathSync(filePath))
    return authorizedRoots.some((root) => {
      try { return pathIsWithinRoot(candidate, resolve(realpathSync(root))) } catch { return false }
    })
  } catch {
    return false
  }
}

export function getFsAuthorizedRoots(): string[] {
  const { home, recents } = getFsStartRoots()
  const artifactRoot = (getDatabase()
    .prepare("SELECT value FROM settings WHERE key = 'artifact_storage_root'")
    .get() as { value?: string } | undefined)?.value
  return [home, getWorkingDirectory(), ...recents, artifactRoot]
    .filter((root, index, roots): root is string => Boolean(root) && roots.indexOf(root) === index)
}

export function listDirectoryEntriesForRemote(path: string, authorizedRoots?: string[]): FsRemoteListResult {
  if (!path || !existsSync(path)) {
    return { entries: [], truncated: false, error: 'Directory not found' }
  }
  if (authorizedRoots && !isRemotePathAuthorized(path, authorizedRoots)) {
    return { entries: [], truncated: false, error: 'This location is not available through the remote explorer' }
  }
  try {
    if (!statSync(path).isDirectory()) {
      return { entries: [], truncated: false, error: 'Not a directory' }
    }
    readdirSync(path)
  } catch {
    // listDirectoryEntries() below silently swallows unreadable dirs into `[]` — probe
    // readdirSync directly first so a permissions error can be told apart from a real empty dir.
    return { entries: [], truncated: false, error: 'Could not read this folder' }
  }
  const entries = listDirectoryEntries(path, 1, '').map((entry) => ({ ...entry, fullPath: join(path, entry.relativePath) }))
  const truncated = entries.length > FS_REMOTE_LIST_LIMIT
  return { entries: entries.slice(0, FS_REMOTE_LIST_LIMIT), truncated }
}

const FS_REMOTE_READ_LIMIT = 512_000
const FS_REMOTE_IMAGE_LIMIT = 16 * 1024 * 1024
const REMOTE_TEXT_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc', '.json', '.yaml', '.yml'])

const REMOTE_IMAGE_MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export function isRemoteImagePath(filePath: string): boolean {
  return extname(filePath).toLowerCase() in REMOTE_IMAGE_MIME_TYPES
}

/** Read a bounded UTF-8 text file for the remote Android document viewer. */
export function readTextFileForRemote(filePath: string, authorizedRoots?: string[]): { path: string; content: string; truncated: boolean; error?: string } {
  if (!filePath || !existsSync(filePath)) return { path: filePath, content: '', truncated: false, error: 'File not found' }
  if (authorizedRoots && !isRemotePathAuthorized(filePath, authorizedRoots)) {
    return { path: filePath, content: '', truncated: false, error: 'This file is not available through the remote explorer' }
  }
  if (!REMOTE_TEXT_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    return { path: filePath, content: '', truncated: false, error: 'Only supported text documents can be viewed' }
  }
  let descriptor: number | undefined
  try {
    if (!statSync(filePath).isFile()) return { path: filePath, content: '', truncated: false, error: 'Not a file' }
    descriptor = openSync(filePath, 'r')
    const buffer = Buffer.alloc(FS_REMOTE_READ_LIMIT + 1)
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0)
    const truncated = bytesRead > FS_REMOTE_READ_LIMIT
    const byteLimit = truncated ? FS_REMOTE_READ_LIMIT : bytesRead
    let content: string
    if (!truncated) {
      content = buffer.subarray(0, byteLimit).toString('utf-8')
    } else {
      // Decode strictly and back up at most four bytes so a multibyte code point is never
      // split at the bounded-read boundary.
      const decoder = new TextDecoder('utf-8', { fatal: true })
      let end = byteLimit
      while (end > byteLimit - 4) {
        try { content = decoder.decode(buffer.subarray(0, end)); break } catch { end -= 1 }
      }
      content ??= buffer.subarray(0, byteLimit).toString('utf-8')
    }
    return {
      path: filePath,
      content: truncated ? `${content}\n\n...[truncated]` : content,
      truncated,
    }
  } catch {
    return { path: filePath, content: '', truncated: false, error: 'Could not read this file' }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/** Read a bounded raster image as base64 for the remote Android image viewer. */
export function readImageFileForRemote(filePath: string, authorizedRoots?: string[]): {
  path: string
  content: string
  truncated: boolean
  mimeType: string
  encoding: 'base64'
  error?: string
} {
  const mimeType = REMOTE_IMAGE_MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const empty = (error?: string) => ({
    path: filePath,
    content: '',
    truncated: false,
    mimeType,
    encoding: 'base64' as const,
    ...(error ? { error } : {}),
  })

  if (!filePath || !existsSync(filePath)) return empty('File not found')
  if (authorizedRoots && !isRemotePathAuthorized(filePath, authorizedRoots)) {
    return empty('This file is not available through the remote explorer')
  }

  let descriptor: number | undefined
  try {
    if (!statSync(filePath).isFile()) return empty('Not a file')
    descriptor = openSync(filePath, 'r')
    const buffer = Buffer.alloc(FS_REMOTE_IMAGE_LIMIT + 1)
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0)
    if (bytesRead > FS_REMOTE_IMAGE_LIMIT) {
      return empty('This image is larger than the 16 MB remote viewing limit')
    }
    return {
      path: filePath,
      content: buffer.subarray(0, bytesRead).toString('base64'),
      truncated: false,
      mimeType,
      encoding: 'base64' as const,
    }
  } catch {
    return empty('Could not read this image')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/** Dispatch a legacy generic file request without ever sending raster bytes through the text reader. */
export function readFileForRemote(filePath: string, authorizedRoots?: string[]) {
  return isRemoteImagePath(filePath)
    ? readImageFileForRemote(filePath, authorizedRoots)
    : readTextFileForRemote(filePath, authorizedRoots)
}

export function getFsStartRoots(): { home: string; recents: string[] } {
  const db = getDatabase()
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'recent_directories'")
    .get() as { value: string } | undefined
  let recents: string[] = []
  try {
    recents = row ? JSON.parse(row.value) : []
  } catch {
    recents = []
  }
  return { home: app.getPath('home'), recents }
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

  safeHandle("context:workspace-summary", async (_event, rootDir?: string) => {
    const cwd = (rootDir && existsSync(rootDir)) ? rootDir : getWorkingDirectory();
    const maxDepth = 3;
    const maxEntries = 200;
    const ignored = new Set([".git", "node_modules", "dist", "release"]);
    const lines: string[] = [cwd];
    let entryCount = 0;
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > maxDepth || entryCount >= maxEntries) return;
      let entries: import("fs").Dirent[];
      try {
        entries = (await readdir(dir, { withFileTypes: true })).filter(
          (entry) => !ignored.has(entry.name),
        );
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entryCount >= maxEntries) break;
        const indent = "  ".repeat(depth);
        lines.push(`${indent}- ${entry.name}${entry.isDirectory() ? "/" : ""}`);
        entryCount += 1;
        if (entry.isDirectory()) {
          await walk(join(dir, entry.name), depth + 1);
        }
      }
    };
    await walk(cwd, 1);
    return lines.join("\n");
  });

  safeHandle("context:git", async () => {
    const cwd = getWorkingDirectory();
    try {
      const [branchResult, statusResult, recentResult] = await Promise.all([
        execAsync("git rev-parse --abbrev-ref HEAD", { cwd }),
        execAsync("git status --short", { cwd }),
        execAsync("git log -5 --oneline", { cwd }),
      ]);
      const branch = branchResult.stdout.trim();
      const status = statusResult.stdout.trim();
      const recent = recentResult.stdout.trim();
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

  safeHandle("context:git-diff", async () => {
    const cwd = getWorkingDirectory();
    try {
      // Check for a valid HEAD first (new repo with no commits has no HEAD)
      try {
        await execAsync("git rev-parse HEAD", { cwd });
      } catch {
        return "No commits yet — diff unavailable.";
      }

      const { stdout } = await execAsync("git diff --stat HEAD", { cwd });
      const stat = stdout.trim();

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
