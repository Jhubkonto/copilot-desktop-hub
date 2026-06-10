import { randomUUID } from 'crypto'
import { execSync, spawn } from 'child_process'
import { existsSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { app, BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { safeHandle } from './safe-handle'
import { getDatabase } from './database'
import type { BuildCommandName, BuildRecord, BuildStatus, PreflightCheck, WorkspaceInfo } from '../shared/types'

// ---------------------------------------------------------------------------
// In-flight process registry
// ---------------------------------------------------------------------------

import type { ChildProcess } from 'child_process'
const activeBuildProcesses = new Map<string, ChildProcess>()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWorkspacePath(db: Database.Database): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'build_workspace_path'").get() as { value: string } | undefined
  return row?.value ?? process.cwd()
}

export function getWorkspaceInfo(db: Database.Database): WorkspaceInfo {
  const workspacePath = getWorkspacePath(db)
  const info: WorkspaceInfo = {
    path: workspacePath,
    branch: null,
    commitSha: null,
    dirty: false,
    version: null,
    isGitRepo: false,
  }

  try {
    execSync('git rev-parse HEAD', { cwd: workspacePath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    info.isGitRepo = true
    info.branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: workspacePath, encoding: 'utf8' }).trim()
    info.commitSha = execSync('git rev-parse --short HEAD', { cwd: workspacePath, encoding: 'utf8' }).trim()
    const statusOut = execSync('git status --porcelain', { cwd: workspacePath, encoding: 'utf8' }).trim()
    info.dirty = statusOut.length > 0
  } catch {
    // Not a git repo or git not available
  }

  try {
    const pkgPath = path.join(workspacePath, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(require('fs').readFileSync(pkgPath, 'utf8')) as { version?: string }
      info.version = pkg.version ?? null
    }
  } catch {
    // ignore
  }

  return info
}

const BUILD_COMMANDS: Record<BuildCommandName, string> = {
  typecheck: 'npx tsc --noEmit -p tsconfig.typecheck.json',
  test: 'npx vitest run',
  build: 'npm run build',
  package: 'npm run package',
}

function rowToRecord(row: Record<string, unknown>): BuildRecord {
  return {
    id: row.id as string,
    workspacePath: row.workspace_path as string,
    commitSha: (row.commit_sha as string | null) ?? null,
    branch: (row.branch as string | null) ?? null,
    version: (row.version as string | null) ?? null,
    platform: row.platform as string,
    command: row.command as BuildCommandName,
    status: row.status as BuildStatus,
    exitCode: (row.exit_code as number | null) ?? null,
    artifactPaths: JSON.parse((row.artifact_paths as string | null) ?? '[]') as string[],
    logTail: (row.log_tail as string | null) ?? '',
    startedAt: row.started_at as number,
    finishedAt: (row.finished_at as number | null) ?? null,
  }
}

function scanArtifacts(releaseDir: string, beforeMtime: number): string[] {
  if (!existsSync(releaseDir)) return []
  const found: string[] = []
  for (const entry of readdirSync(releaseDir)) {
    const full = path.join(releaseDir, entry)
    try {
      const st = statSync(full)
      if (st.isFile() && st.mtimeMs >= beforeMtime) found.push(full)
    } catch {
      // ignore
    }
  }
  return found
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerBuildHandlers(mainWindow?: BrowserWindow): void {
  const db = getDatabase()

  safeHandle('build:get-workspace-info', () => getWorkspaceInfo(db))

  safeHandle('build:set-workspace-path', (_event, workspacePath: string) => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run(workspacePath)
    return getWorkspaceInfo(db)
  })

  safeHandle('build:start-command', (_event, command: BuildCommandName) => {
    const buildId = randomUUID()
    const workspacePath = getWorkspacePath(db)
    const wsInfo = getWorkspaceInfo(db)
    const now = Date.now()

    db.prepare(
      `INSERT INTO build_records
        (id, workspace_path, commit_sha, branch, version, platform, command, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)`
    ).run(buildId, workspacePath, wsInfo.commitSha, wsInfo.branch, wsInfo.version, process.platform, command, now)

    const cmd = BUILD_COMMANDS[command]
    const child = spawn(cmd, [], { shell: true, cwd: workspacePath })
    activeBuildProcesses.set(buildId, child)

    const logLines: string[] = []
    const MAX_LOG_CHARS = 4096

    function appendLog(line: string, stream: 'stdout' | 'stderr'): void {
      logLines.push(line)
      mainWindow?.webContents.send('build:log-chunk', { buildId, line, stream })
    }

    function buildLogTail(): string {
      const joined = logLines.join('\n')
      return joined.length > MAX_LOG_CHARS ? joined.slice(-MAX_LOG_CHARS) : joined
    }

    child.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        if (line) appendLog(line, 'stdout')
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        if (line) appendLog(line, 'stderr')
      }
    })

    child.on('close', (code) => {
      activeBuildProcesses.delete(buildId)
      const exitCode = code ?? -1
      const status: BuildStatus = exitCode === 0 ? 'success' : 'failed'
      const finishedAt = Date.now()
      const logTail = buildLogTail()
      const releaseDir = path.join(workspacePath, 'release')
      const artifactPaths = command === 'package' ? scanArtifacts(releaseDir, now) : []

      db.prepare(
        `UPDATE build_records
         SET status = ?, exit_code = ?, finished_at = ?, log_tail = ?, artifact_paths = ?
         WHERE id = ?`
      ).run(status, exitCode, finishedAt, logTail, JSON.stringify(artifactPaths), buildId)

      mainWindow?.webContents.send('build:command-done', { buildId, status, exitCode })
    })

    return { buildId }
  })

  safeHandle('build:cancel-command', (_event, buildId: string) => {
    const child = activeBuildProcesses.get(buildId)
    if (!child) return false
    child.kill('SIGTERM')
    activeBuildProcesses.delete(buildId)
    db.prepare(
      `UPDATE build_records SET status = 'cancelled', finished_at = ? WHERE id = ?`
    ).run(Date.now(), buildId)
    return true
  })

  safeHandle('build:get-records', (_event, limit?: number) => {
    const rows = db.prepare(
      `SELECT * FROM build_records ORDER BY started_at DESC LIMIT ?`
    ).all(limit ?? 20) as Record<string, unknown>[]
    return rows.map(rowToRecord)
  })

  safeHandle('build:run-preflight', () => {
    const workspacePath = getWorkspacePath(db)
    const checks: PreflightCheck[] = []

    // 1. Git dirty
    try {
      const statusOut = execSync('git status --porcelain', { cwd: workspacePath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
      if (statusOut.length > 0) {
        const lineCount = statusOut.split('\n').length
        checks.push({ label: 'Git working tree', status: 'warn', detail: `${lineCount} modified or untracked file(s)` })
      } else {
        checks.push({ label: 'Git working tree', status: 'ok', detail: 'Clean' })
      }
    } catch {
      checks.push({ label: 'Git working tree', status: 'warn', detail: 'Could not run git status' })
    }

    // 2. node_modules
    const lockFile = path.join(workspacePath, 'node_modules', '.package-lock.json')
    if (existsSync(lockFile)) {
      checks.push({ label: 'node_modules', status: 'ok', detail: 'Present' })
    } else {
      checks.push({ label: 'node_modules', status: 'fail', detail: 'Missing — run npm install' })
    }

    // 3. Signing config
    const signingKey = process.platform === 'win32'
      ? process.env['WIN_CSC_LINK']
      : process.env['CSC_LINK']
    if (signingKey) {
      checks.push({ label: 'Code signing', status: 'ok', detail: 'Signing key configured' })
    } else {
      checks.push({ label: 'Code signing', status: 'warn', detail: 'No signing key env var set — unsigned build only' })
    }

    // 4. TypeScript
    try {
      execSync('npx tsc --noEmit -p tsconfig.typecheck.json', {
        cwd: workspacePath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      checks.push({ label: 'TypeScript', status: 'ok', detail: 'No errors' })
    } catch (err) {
      const output = err instanceof Error && 'stderr' in err ? String((err as NodeJS.ErrnoException & { stderr?: string }).stderr) : ''
      const firstError = output.split('\n').find((l) => l.trim().length > 0) ?? 'Type errors found'
      checks.push({ label: 'TypeScript', status: 'fail', detail: firstError })
    }

    return { checks }
  })

  safeHandle('build:launch-dev', () => {
    if (app.isPackaged) {
      return { launched: false, error: 'Only available in dev mode' }
    }
    const workspacePath = getWorkspacePath(db)
    try {
      const child = spawn(process.execPath, ['.'], {
        cwd: workspacePath,
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ELECTRON_IS_DEV: '1' },
      })
      child.unref()
      return { launched: true }
    } catch (err) {
      return { launched: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
