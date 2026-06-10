import { randomUUID, createHash } from 'crypto'
import { execSync, spawn } from 'child_process'
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import path from 'path'
import { networkInterfaces } from 'os'
import { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { safeHandle } from './safe-handle'
import { getDatabase } from './database'
import { startFeedServer, isFeedRunning, getFeedLanUrl } from './local-feed-server'
import type {
  AndroidBuildCommandName,
  AndroidWorkspaceInfo,
  AndroidSigningConfig,
  AndroidUpdateManifest,
  AdbDevice,
  BuildRecord,
  BuildStatus,
  PreflightCheck,
} from '../shared/types'

// ---------------------------------------------------------------------------
// In-flight process registry
// ---------------------------------------------------------------------------

import type { ChildProcess } from 'child_process'
const activeAndroidProcesses = new Map<string, ChildProcess>()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAndroidWorkspacePath(db: Database.Database): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'android_workspace_path'").get() as { value: string } | undefined
  return row?.value ?? null
}

export function getAndroidWorkspaceInfo(db: Database.Database): AndroidWorkspaceInfo {
  const workspacePath = getAndroidWorkspacePath(db) ?? ''
  const info: AndroidWorkspaceInfo = {
    path: workspacePath,
    branch: null,
    commitSha: null,
    dirty: false,
    versionCode: null,
    versionName: null,
    isGitRepo: false,
  }

  if (!workspacePath) return info

  try {
    execSync('git rev-parse HEAD', { cwd: workspacePath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    info.isGitRepo = true
    info.branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: workspacePath, encoding: 'utf8' }).trim()
    info.commitSha = execSync('git rev-parse --short HEAD', { cwd: workspacePath, encoding: 'utf8' }).trim()
    const statusOut = execSync('git status --porcelain', { cwd: workspacePath, encoding: 'utf8' }).trim()
    info.dirty = statusOut.length > 0
  } catch {
    // not a git repo
  }

  try {
    const gradlew = getGradlew()
    const output = execSync(`${gradlew} properties -q --no-daemon`, {
      cwd: workspacePath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    })
    const vcMatch = /^versionCode:\s*(\d+)/m.exec(output)
    const vnMatch = /^versionName:\s*(.+)/m.exec(output)
    if (vcMatch) info.versionCode = parseInt(vcMatch[1], 10)
    if (vnMatch) info.versionName = vnMatch[1].trim()
  } catch {
    // gradle not available or project not configured
  }

  return info
}

function getGradlew(): string {
  return process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
}

function getSigningConfig(db: Database.Database): AndroidSigningConfig | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'android_signing_config'").get() as { value: string } | undefined
  if (!row?.value) return null
  try {
    return JSON.parse(row.value) as AndroidSigningConfig
  } catch {
    return null
  }
}

function buildSigningEnv(config: AndroidSigningConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NEXY_KEYSTORE_PATH: config.keystorePath,
    NEXY_KEYSTORE_PASSWORD: config.keystorePassword,
    NEXY_KEY_ALIAS: config.keyAlias,
    NEXY_KEY_PASSWORD: config.keyPassword,
  }
}

function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

function getAndroidFeedDir(db: Database.Database): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'local_update_feed_path'").get() as { value: string } | undefined
  if (!row?.value) return null
  return path.join(row.value, 'android')
}

function getLocalIp(): string {
  const ifaces = networkInterfaces()
  const candidates: string[] = []
  for (const iface of Object.values(ifaces)) {
    if (!iface) continue
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) candidates.push(info.address)
    }
  }
  // Prefer 192.168.* (home LAN) then 10.* then others
  candidates.sort((a, b) => {
    const score = (ip: string) =>
      ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2
    return score(a) - score(b)
  })
  return candidates[0] ?? '127.0.0.1'
}

function rowToRecord(row: Record<string, unknown>): BuildRecord {
  return {
    id: row.id as string,
    workspacePath: row.workspace_path as string,
    commitSha: (row.commit_sha as string | null) ?? null,
    branch: (row.branch as string | null) ?? null,
    version: (row.version as string | null) ?? null,
    platform: row.platform as string,
    command: row.command as AndroidBuildCommandName,
    status: row.status as BuildStatus,
    exitCode: (row.exit_code as number | null) ?? null,
    artifactPaths: JSON.parse((row.artifact_paths as string | null) ?? '[]') as string[],
    logTail: (row.log_tail as string | null) ?? '',
    startedAt: row.started_at as number,
    finishedAt: (row.finished_at as number | null) ?? null,
  }
}

const ANDROID_COMMANDS: Record<AndroidBuildCommandName, string[]> = {
  test: ['test'],
  assembleDebug: ['assembleDebug'],
  assembleRelease: ['assembleRelease'],
  bundleRelease: ['bundleRelease'],
}

const SIGNING_COMMANDS: ReadonlySet<AndroidBuildCommandName> = new Set(['assembleRelease', 'bundleRelease'])

function getArtifactDir(workspacePath: string, command: AndroidBuildCommandName): string {
  if (command === 'bundleRelease') return path.join(workspacePath, 'app', 'build', 'outputs', 'bundle', 'release')
  if (command === 'assembleRelease') return path.join(workspacePath, 'app', 'build', 'outputs', 'apk', 'release')
  if (command === 'assembleDebug') return path.join(workspacePath, 'app', 'build', 'outputs', 'apk', 'debug')
  return ''
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerAndroidHandlers(mainWindow?: BrowserWindow): void {
  const db = getDatabase()

  safeHandle('android:get-workspace-info', () => getAndroidWorkspaceInfo(db))

  safeHandle('android:set-workspace-path', (_event, workspacePath: string) => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('android_workspace_path', ?)").run(workspacePath)
    return getAndroidWorkspaceInfo(db)
  })

  safeHandle('android:start-command', (_event, command: AndroidBuildCommandName) => {
    const buildId = randomUUID()
    const workspacePath = getAndroidWorkspacePath(db)
    if (!workspacePath) return { buildId, error: 'Android workspace path not configured' }

    const wsInfo = getAndroidWorkspaceInfo(db)
    const now = Date.now()

    db.prepare(
      `INSERT INTO build_records
        (id, workspace_path, commit_sha, branch, version, platform, command, status, started_at)
       VALUES (?, ?, ?, ?, ?, 'android', ?, 'running', ?)`
    ).run(buildId, workspacePath, wsInfo.commitSha, wsInfo.branch, wsInfo.versionName, command, now)

    const gradlew = getGradlew()
    const args = ANDROID_COMMANDS[command]
    const useSigningEnv = SIGNING_COMMANDS.has(command)
    const signingConfig = useSigningEnv ? getSigningConfig(db) : null
    const env = signingConfig ? buildSigningEnv(signingConfig) : process.env

    const child = spawn(gradlew, args, { shell: true, cwd: workspacePath, env })
    activeAndroidProcesses.set(buildId, child)

    const logLines: string[] = []
    const MAX_LOG_CHARS = 4096

    function appendLog(line: string, stream: 'stdout' | 'stderr'): void {
      logLines.push(line)
      mainWindow?.webContents.send('android:log-chunk', { buildId, line, stream })
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
      activeAndroidProcesses.delete(buildId)
      const exitCode = code ?? -1
      const status: BuildStatus = exitCode === 0 ? 'success' : 'failed'
      const finishedAt = Date.now()
      const logTail = buildLogTail()

      const artifactDir = getArtifactDir(workspacePath, command)
      let artifactPaths: string[] = []
      if (artifactDir && existsSync(artifactDir)) {
        try {
          artifactPaths = readdirSync(artifactDir)
            .map((f) => path.join(artifactDir, f))
            .filter((f) => {
              try { return statSync(f).isFile() && statSync(f).mtimeMs >= now } catch { return false }
            })
        } catch { /* ignore */ }
      }

      db.prepare(
        `UPDATE build_records
         SET status = ?, exit_code = ?, finished_at = ?, log_tail = ?, artifact_paths = ?
         WHERE id = ?`
      ).run(status, exitCode, finishedAt, logTail, JSON.stringify(artifactPaths), buildId)

      mainWindow?.webContents.send('android:command-done', { buildId, status, exitCode })
    })

    return { buildId }
  })

  safeHandle('android:cancel-command', (_event, buildId: string) => {
    const child = activeAndroidProcesses.get(buildId)
    if (!child) return false
    child.kill('SIGTERM')
    activeAndroidProcesses.delete(buildId)
    db.prepare(`UPDATE build_records SET status = 'cancelled', finished_at = ? WHERE id = ?`).run(Date.now(), buildId)
    return true
  })

  safeHandle('android:get-records', (_event, limit?: number) => {
    const rows = db.prepare(
      `SELECT * FROM build_records WHERE platform = 'android' ORDER BY started_at DESC LIMIT ?`
    ).all(limit ?? 20) as Record<string, unknown>[]
    return rows.map(rowToRecord)
  })

  safeHandle('android:get-signing-config', () => getSigningConfig(db))

  safeHandle('android:set-signing-config', (_event, config: AndroidSigningConfig) => {
    if (!config.keystorePath || !config.keyAlias || !config.keystorePassword || !config.keyPassword) {
      throw new Error('All signing config fields are required')
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('android_signing_config', ?)").run(JSON.stringify(config))
    return true
  })

  safeHandle('android:validate-signing-config', () => {
    const checks: PreflightCheck[] = []
    const config = getSigningConfig(db)

    if (!config) {
      checks.push({ label: 'Signing config', status: 'fail', detail: 'No signing config saved' })
      return { valid: false, checks }
    }
    checks.push({ label: 'Signing config', status: 'ok', detail: 'Config present' })

    if (!existsSync(config.keystorePath)) {
      checks.push({ label: 'Keystore file', status: 'fail', detail: `Not found: ${config.keystorePath}` })
    } else {
      checks.push({ label: 'Keystore file', status: 'ok', detail: 'File exists' })
    }

    try {
      execSync(
        `keytool -list -keystore "${config.keystorePath}" -storepass "${config.keystorePassword}" -alias "${config.keyAlias}"`,
        { stdio: 'pipe', encoding: 'utf8' }
      )
      checks.push({ label: 'Keystore alias', status: 'ok', detail: `Alias "${config.keyAlias}" verified` })
    } catch {
      checks.push({ label: 'Keystore alias', status: 'fail', detail: 'keytool verification failed — check password and alias' })
    }

    const valid = checks.every((c) => c.status !== 'fail')
    return { valid, checks }
  })

  safeHandle('android:list-adb-devices', () => {
    try {
      const output = execSync('adb devices -l', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
      const lines = output.split('\n').slice(1) // skip "List of devices attached" header
      const devices: AdbDevice[] = []
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const parts = trimmed.split(/\s+/)
        if (parts.length < 2) continue
        const serial = parts[0]
        const rawState = parts[1]
        const state: AdbDevice['state'] =
          rawState === 'device' ? 'device' :
          rawState === 'offline' ? 'offline' :
          rawState === 'unauthorized' ? 'unauthorized' : 'unknown'
        const modelMatch = /model:(\S+)/.exec(trimmed)
        const productMatch = /product:(\S+)/.exec(trimmed)
        devices.push({
          serial,
          state,
          model: modelMatch ? modelMatch[1] : null,
          product: productMatch ? productMatch[1] : null,
        })
      }
      return devices
    } catch {
      return []
    }
  })

  safeHandle('android:install-apk', async (_event, serial: string, apkPath: string) => {
    const workspacePath = getAndroidWorkspacePath(db)
    if (workspacePath && !apkPath.startsWith(workspacePath)) {
      return { success: false, error: 'APK path must be inside the Android workspace' }
    }
    if (!existsSync(apkPath)) {
      return { success: false, error: `APK not found: ${apkPath}` }
    }

    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      let stderr = ''
      const child = spawn('adb', ['-s', serial, 'install', '-r', apkPath], { shell: true })
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
      child.on('close', (code) => {
        if (code === 0) resolve({ success: true })
        else resolve({ success: false, error: stderr.trim() || `adb install exited with code ${code}` })
      })
    })
  })

  safeHandle('android:publish-update', async () => {
    // Production update path (UPD.16):
    // 1. Run assembleRelease from desktop — Gradle signs APK via NEXY_KEYSTORE_* env vars.
    // 2. Click "Publish release APK to feed" — copies APK to {feedPath}/android/, writes android-update.json.
    // 3. Feed server restarts bound to 0.0.0.0 so Android can reach it over LAN.
    // 4. Next WS connect sends feedUrl (LAN IP) in `connected` event.
    // 5. Android fetches android-update.json, compares versionCode with BuildConfig.VERSION_CODE.
    // 6. User taps Download & Install — DownloadManager downloads APK, system PackageInstaller handles install.
    // For production outside LAN: replace feedUrl with a stable HTTPS URL; the manifest schema is unchanged.

    const androidFeedDir = getAndroidFeedDir(db)
    if (!androidFeedDir) return { published: false, error: 'No local update feed path configured' }

    const workspacePath = getAndroidWorkspacePath(db)
    if (!workspacePath) return { published: false, error: 'Android workspace path not configured' }

    const releaseApkDir = path.join(workspacePath, 'app', 'build', 'outputs', 'apk', 'release')
    let apkSrc: string | null = null
    if (existsSync(releaseApkDir)) {
      let latestMtime = 0
      for (const entry of readdirSync(releaseApkDir)) {
        if (entry.endsWith('.apk')) {
          const full = path.join(releaseApkDir, entry)
          try {
            const st = statSync(full)
            if (st.isFile() && st.mtimeMs > latestMtime) { apkSrc = full; latestMtime = st.mtimeMs }
          } catch { /* skip */ }
        }
      }
    }
    if (!apkSrc) return { published: false, error: 'No release APK found in app/build/outputs/apk/release/' }

    mkdirSync(androidFeedDir, { recursive: true })

    const apkName = path.basename(apkSrc)
    const destApk = path.join(androidFeedDir, apkName)
    copyFileSync(apkSrc, destApk)

    const checksum = await computeSha256(destApk)
    const wsInfo = getAndroidWorkspaceInfo(db)
    const lanIp = getLocalIp()

    // Restart feed server bound to all interfaces so Android can reach it over LAN
    const feedPathRow = db.prepare("SELECT value FROM settings WHERE key = 'local_update_feed_path'").get() as { value: string } | undefined
    const feedRootPath = feedPathRow?.value ?? androidFeedDir
    const port = await startFeedServer(feedRootPath, '0.0.0.0')
    const feedLanUrl = getFeedLanUrl(lanIp)

    const artifactUrl = `${feedLanUrl}/android/${apkName}`
    const manifest: AndroidUpdateManifest = {
      versionCode: wsInfo.versionCode ?? 1,
      versionName: wsInfo.versionName ?? '1.0',
      commitSha: wsInfo.commitSha,
      changelog: '',
      checksum,
      artifactUrl,
      publishedAt: Date.now(),
    }

    writeFileSync(path.join(androidFeedDir, 'android-update.json'), JSON.stringify(manifest, null, 2), 'utf8')

    return { published: true, manifest }
  })

  safeHandle('android:get-update-manifest', () => {
    const androidFeedDir = getAndroidFeedDir(db)
    if (!androidFeedDir) return null
    const manifestPath = path.join(androidFeedDir, 'android-update.json')
    if (!existsSync(manifestPath)) return null
    try {
      return JSON.parse(readFileSync(manifestPath, 'utf8')) as AndroidUpdateManifest
    } catch {
      return null
    }
  })
}
