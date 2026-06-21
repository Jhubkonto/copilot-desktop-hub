import { randomUUID } from 'crypto'
import { spawn, execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { readFile } from 'fs/promises'
import path from 'path'
import { app, BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { safeHandle } from './safe-handle'
import { getDatabase } from './database'
import { startFeedServer, isFeedRunning, getFeedUrl, getFeedPort } from './local-feed-server'
import { debugTime, debugTimeEnd } from './debug-mode'
import type { BuildCommandName, BuildRecord, BuildStatus, LocalUpdateFeed, PreflightCheck, PublishedEntry, WorkspaceInfo } from '../shared/types'

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

type ExecFileFailure = Error & { stdout?: string | Buffer; stderr?: string | Buffer }

function execOutput(err: unknown): string {
  if (!err || typeof err !== 'object') return ''
  const failure = err as ExecFileFailure
  return [failure.stderr, failure.stdout]
    .map((part) => part ? String(part) : '')
    .find((part) => part.trim().length > 0) ?? ''
}

function npxCommand(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx'
}

export async function getWorkspaceInfo(db: Database.Database): Promise<WorkspaceInfo> {
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
    const [logOut, statusOut] = await Promise.all([
      execFileAsync('git', ['log', '-1', '--format=%D\n%h', '--decorate=short'], { cwd: workspacePath, timeout: 5000 }),
      execFileAsync('git', ['status', '--porcelain'], { cwd: workspacePath, timeout: 5000 }),
      execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workspacePath, timeout: 5000 })
        .then(({ stdout }) => { info.branch = stdout.trim() }),
    ])
    info.isGitRepo = true
    const logLines = logOut.stdout.trim().split('\n')
    info.commitSha = logLines[1]?.trim() || null
    info.dirty = statusOut.stdout.trim().length > 0
  } catch {
    // Not a git repo or git not available
  }

  try {
    const pkgPath = path.join(workspacePath, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { version?: string }
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
    versionCode: (row.version_code as number | null) ?? null,
    platform: row.platform as string,
    command: row.command as BuildCommandName,
    status: row.status as BuildStatus,
    exitCode: (row.exit_code as number | null) ?? null,
    artifactPaths: JSON.parse((row.artifact_paths as string | null) ?? '[]') as string[],
    artifactChecksums: JSON.parse((row.artifact_checksums as string | null) ?? '{}') as Record<string, string>,
    logTail: (row.log_tail as string | null) ?? '',
    startedAt: row.started_at as number,
    finishedAt: (row.finished_at as number | null) ?? null,
  }
}

// ---------------------------------------------------------------------------
// Local update feed helpers
// ---------------------------------------------------------------------------

function getLocalFeedPath(db: Database.Database): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'local_update_feed_path'").get() as { value: string } | undefined
  return row?.value ?? null
}

function getYmlName(): string {
  if (process.platform === 'darwin') return 'latest-mac.yml'
  if (process.platform === 'linux') return 'latest-linux.yml'
  return 'latest.yml'
}

function getInstallerExt(): string {
  if (process.platform === 'win32') return '.exe'
  if (process.platform === 'darwin') return '.dmg'
  return '.AppImage'
}

function parseYmlMeta(content: string): { version: string; installerName: string; size: number } | null {
  const vMatch = /^version:\s*['"]?(.+?)['"]?\s*$/m.exec(content)
  const pMatch = /^path:\s*['"]?(.+?)['"]?\s*$/m.exec(content)
  const sMatch = /size:\s*(\d+)/m.exec(content)
  if (!vMatch || !pMatch) return null
  return {
    version: vMatch[1].trim(),
    installerName: path.basename(pMatch[1].trim()),
    size: sMatch ? parseInt(sMatch[1], 10) : 0,
  }
}

function buildFeedInfo(feedPath: string): LocalUpdateFeed {
  return { feedPath, feedUrl: getFeedUrl(), port: getFeedPort(), running: isFeedRunning() }
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

  safeHandle('build:get-workspace-info', async () => {
    debugTime('build:get-workspace-info')
    const r = await getWorkspaceInfo(db)
    debugTimeEnd('build:get-workspace-info')
    return r
  })

  safeHandle('build:set-workspace-path', async (_event, workspacePath: string) => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run(workspacePath)
    return getWorkspaceInfo(db)
  })

  safeHandle('build:start-command', async (_event, command: BuildCommandName) => {
    const buildId = randomUUID()
    const workspacePath = getWorkspacePath(db)
    const wsInfo = await getWorkspaceInfo(db)
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
    let lastUniqueLine = ''
    let repeatCount = 0

    function appendLog(line: string, stream: 'stdout' | 'stderr'): void {
      if (line === lastUniqueLine) {
        repeatCount++
        const summary = `  [repeated ${repeatCount + 1}×]`
        logLines[logLines.length - 1] = summary
        mainWindow?.webContents.send('build:log-chunk', { buildId, line: summary, stream, replace: true })
        return
      }
      lastUniqueLine = line
      repeatCount = 0
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
    debugTime('build:get-records')
    const rows = db.prepare(
      `SELECT * FROM build_records ORDER BY started_at DESC LIMIT ?`
    ).all(limit ?? 20) as Record<string, unknown>[]
    const r = rows.map(rowToRecord)
    debugTimeEnd('build:get-records')
    return r
  })

  safeHandle('build:run-preflight', async () => {
    const workspacePath = getWorkspacePath(db)
    const checks: PreflightCheck[] = []

    // 1. Git dirty
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: workspacePath,
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      })
      const statusOut = stdout.trim()
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
      await execFileAsync(npxCommand(), ['tsc', '--noEmit', '-p', 'tsconfig.typecheck.json'], {
        cwd: workspacePath,
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      })
      checks.push({ label: 'TypeScript', status: 'ok', detail: 'No errors' })
    } catch (err) {
      const output = execOutput(err)
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

  // ---------------------------------------------------------------------------
  // Local update feed handlers (UPD.6–10)
  // ---------------------------------------------------------------------------

  safeHandle('build:get-feed-info', () => {
    debugTime('build:get-feed-info')
    const feedPath = getLocalFeedPath(db)
    const r = feedPath ? buildFeedInfo(feedPath) : null
    debugTimeEnd('build:get-feed-info')
    return r
  })

  safeHandle('build:set-feed-path', async (_event, newFeedPath: string) => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('local_update_feed_path', ?)").run(newFeedPath)
    if (!existsSync(newFeedPath)) mkdirSync(newFeedPath, { recursive: true })
    const port = await startFeedServer(newFeedPath)
    try {
      const pkg = await import('electron-updater')
      pkg.default.autoUpdater.setFeedURL({ provider: 'generic', url: `http://127.0.0.1:${port}` } as never)
    } catch { /* ignore — autoUpdater may not support setFeedURL in dev */ }
    return buildFeedInfo(newFeedPath)
  })

  safeHandle('build:publish-update', async () => {
    const feedPath = getLocalFeedPath(db)
    if (!feedPath) return { published: false, error: 'No local update feed path configured' }

    const workspacePath = getWorkspacePath(db)
    const releaseDir = path.join(workspacePath, 'release')
    const ymlName = getYmlName()
    const ymlSrc = path.join(releaseDir, ymlName)
    const ext = getInstallerExt()

    // Find the most recently modified installer
    let installerSrc: string | null = null
    if (existsSync(releaseDir)) {
      let latestMtime = 0
      for (const entry of readdirSync(releaseDir)) {
        if (entry.endsWith(ext)) {
          const full = path.join(releaseDir, entry)
          try {
            const st = statSync(full)
            if (st.isFile() && st.mtimeMs > latestMtime) { installerSrc = full; latestMtime = st.mtimeMs }
          } catch { /* skip */ }
        }
      }
    }

    if (!installerSrc) return { published: false, error: `No ${ext} installer found in release/` }
    if (!existsSync(ymlSrc)) return { published: false, error: `${ymlName} not found in release/` }

    const ymlContent = await readFile(ymlSrc, 'utf8')
    const parsed = parseYmlMeta(ymlContent)
    if (!parsed) return { published: false, error: 'Could not parse version from latest.yml' }

    // Backup existing feed before overwriting
    const existingYml = path.join(feedPath, ymlName)
    if (existsSync(existingYml)) {
      try {
        const oldContent = await readFile(existingYml, 'utf8')
        const oldParsed = parseYmlMeta(oldContent)
        if (oldParsed) {
          const backupDir = path.join(feedPath, '_backups', `v${oldParsed.version}`)
          mkdirSync(backupDir, { recursive: true })
          copyFileSync(existingYml, path.join(backupDir, ymlName))
          const oldInstaller = path.join(feedPath, oldParsed.installerName)
          if (existsSync(oldInstaller)) copyFileSync(oldInstaller, path.join(backupDir, oldParsed.installerName))
        }
      } catch { /* backup failure is non-fatal */ }
    }

    mkdirSync(feedPath, { recursive: true })
    copyFileSync(ymlSrc, path.join(feedPath, ymlName))
    copyFileSync(installerSrc, path.join(feedPath, parsed.installerName))

    if (!isFeedRunning()) {
      const port = await startFeedServer(feedPath)
      try {
        const pkg = await import('electron-updater')
        pkg.default.autoUpdater.setFeedURL({ provider: 'generic', url: `http://127.0.0.1:${port}` } as never)
      } catch { /* ignore */ }
    }

    return { published: true, version: parsed.version }
  })

  safeHandle('build:list-published', async () => {
    debugTime('build:list-published')
    const feedPath = getLocalFeedPath(db)
    if (!feedPath || !existsSync(feedPath)) { debugTimeEnd('build:list-published'); return [] }

    const entries: PublishedEntry[] = []
    const ymlName = getYmlName()

    const ymlPath = path.join(feedPath, ymlName)
    if (existsSync(ymlPath)) {
      try {
        const content = await readFile(ymlPath, 'utf8')
        const parsed = parseYmlMeta(content)
        if (parsed) {
          const installerPath = path.join(feedPath, parsed.installerName)
          const mtime = existsSync(installerPath) ? statSync(installerPath).mtimeMs : statSync(ymlPath).mtimeMs
          entries.push({ version: parsed.version, publishedAt: mtime, installerName: parsed.installerName, installerSize: parsed.size, platform: process.platform, isBackup: false })
        }
      } catch { /* skip */ }
    }

    const backupBase = path.join(feedPath, '_backups')
    if (existsSync(backupBase)) {
      for (const vDir of readdirSync(backupBase)) {
        const backupDir = path.join(backupBase, vDir)
        try {
          if (!statSync(backupDir).isDirectory()) continue
          const backupYml = path.join(backupDir, ymlName)
          if (!existsSync(backupYml)) continue
          const content = await readFile(backupYml, 'utf8')
          const parsed = parseYmlMeta(content)
          if (!parsed) continue
          const installerPath = path.join(backupDir, parsed.installerName)
          const mtime = existsSync(installerPath) ? statSync(installerPath).mtimeMs : statSync(backupYml).mtimeMs
          entries.push({ version: parsed.version, publishedAt: mtime, installerName: parsed.installerName, installerSize: parsed.size, platform: process.platform, isBackup: true })
        } catch { /* skip */ }
      }
    }

    const result = entries.sort((a, b) => b.publishedAt - a.publishedAt)
    debugTimeEnd('build:list-published')
    return result
  })

  safeHandle('build:rollback-update', async (_event, version: string) => {
    const feedPath = getLocalFeedPath(db)
    if (!feedPath) return { launched: false, error: 'No local update feed configured' }

    const backupDir = path.join(feedPath, '_backups', `v${version}`)
    if (!existsSync(backupDir)) return { launched: false, error: `No backup found for v${version}` }

    const ymlName = getYmlName()
    const ymlPath = path.join(backupDir, ymlName)
    if (!existsSync(ymlPath)) return { launched: false, error: 'Backup yml not found' }

    const content = await readFile(ymlPath, 'utf8')
    const parsed = parseYmlMeta(content)
    if (!parsed) return { launched: false, error: 'Could not parse backup installer name' }

    const installerPath = path.join(backupDir, parsed.installerName)
    if (!existsSync(installerPath)) return { launched: false, error: 'Backup installer file not found' }

    try {
      const child = spawn(installerPath, [], { detached: true, stdio: 'ignore' })
      child.unref()
      return { launched: true }
    } catch (err) {
      return { launched: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Start local feed server if a path is already configured
  const existingFeedPath = getLocalFeedPath(db)
  if (existingFeedPath && existsSync(existingFeedPath)) {
    startFeedServer(existingFeedPath).catch(() => {})
  }
}
