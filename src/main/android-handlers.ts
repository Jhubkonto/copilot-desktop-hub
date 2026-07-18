import { randomUUID, createHash } from 'crypto'
import { execSync, spawn, execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { networkInterfaces } from 'os'
import { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { safeHandle } from './safe-handle'
import { getDatabase } from './database'
import { startFeedServer, getFeedLanUrl } from './local-feed-server'
import { debugTime, debugTimeEnd } from './debug-mode'
import { runBuildProcess, cancelBuildProcess, mapBuildRecord } from './build-runner'
import type {
  AndroidBuildCommandName,
  AndroidWorkspaceInfo,
  AndroidSigningConfig,
  AndroidUpdateManifest,
  AdbDevice,
  PreflightCheck,
} from '../shared/types'
import { saveFcmServiceAccount, getFcmConfigStatus } from './fcm-sender'

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

export async function getAndroidWorkspaceInfo(db: Database.Database): Promise<AndroidWorkspaceInfo> {
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
    const [, statusOut] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workspacePath, timeout: 5000 })
        .then(({ stdout }) => { info.branch = stdout.trim() }),
      execFileAsync('git', ['status', '--porcelain'], { cwd: workspacePath, timeout: 5000 }),
      execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: workspacePath, timeout: 5000 })
        .then(({ stdout }) => { info.commitSha = stdout.trim() }),
    ])
    info.isGitRepo = true
    info.dirty = statusOut.stdout.trim().length > 0
  } catch {
    // not a git repo
  }

  try {
    const gradlew = getGradlew()
    const { stdout } = await execFileAsync(gradlew, ['properties', '-q', '--no-daemon'], {
      cwd: workspacePath,
      timeout: 8000,
    })
    const vcMatch = /^versionCode:\s*(\d+)/m.exec(stdout)
    const vnMatch = /^versionName:\s*(.+)/m.exec(stdout)
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

export function computeSha256(filePath: string): Promise<string> {
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

export async function getAndroidUpdateManifest(db: Database.Database): Promise<AndroidUpdateManifest | null> {
  const androidFeedDir = getAndroidFeedDir(db)
  if (!androidFeedDir) return null
  const manifestPath = path.join(androidFeedDir, 'android-update.json')
  if (!existsSync(manifestPath)) return null
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8')) as AndroidUpdateManifest
  } catch {
    return null
  }
}

function getPublishHistoryPath(androidFeedDir: string): string {
  return path.join(androidFeedDir, 'android-update-history.json')
}

async function readPublishHistory(androidFeedDir: string): Promise<AndroidUpdateManifest[]> {
  const historyPath = getPublishHistoryPath(androidFeedDir)
  if (!existsSync(historyPath)) return []
  try {
    return JSON.parse(await readFile(historyPath, 'utf8')) as AndroidUpdateManifest[]
  } catch {
    return []
  }
}

async function appendPublishHistory(androidFeedDir: string, manifest: AndroidUpdateManifest, archiveApkPath: string): Promise<void> {
  const MAX_HISTORY = 5
  const entry = { ...manifest, archiveApkPath }
  const existing = await readPublishHistory(androidFeedDir)
  const updated = [entry, ...existing.filter((e) => e.versionCode !== manifest.versionCode)].slice(0, MAX_HISTORY)
  await writeFile(getPublishHistoryPath(androidFeedDir), JSON.stringify(updated, null, 2), 'utf8')
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

function isInsideDirectory(candidatePath: string, directoryPath: string): boolean {
  const relative = path.relative(path.resolve(directoryPath), path.resolve(candidatePath))
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerAndroidHandlers(mainWindow?: BrowserWindow): void {
  const db = getDatabase()

  safeHandle('android:get-workspace-info', async () => {
    debugTime('android:get-workspace-info')
    const r = await getAndroidWorkspaceInfo(db)
    debugTimeEnd('android:get-workspace-info')
    return r
  })

  safeHandle('android:set-workspace-path', async (_event, workspacePath: string) => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('android_workspace_path', ?)").run(workspacePath)
    return getAndroidWorkspaceInfo(db)
  })

  safeHandle('android:start-command', async (_event, command: AndroidBuildCommandName) => {
    const buildId = randomUUID()
    const workspacePath = getAndroidWorkspacePath(db)
    // Thrown so safeHandle returns the standard { error } shape instead of a
    // success-shaped object carrying an error field.
    if (!workspacePath) throw new Error('Android workspace path not configured')

    const wsInfo = await getAndroidWorkspaceInfo(db)
    const now = Date.now()

    db.prepare(
      `INSERT INTO build_records
        (id, workspace_path, commit_sha, branch, version, version_code, platform, command, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, 'android', ?, 'running', ?)`
    ).run(buildId, workspacePath, wsInfo.commitSha, wsInfo.branch, wsInfo.versionName, wsInfo.versionCode, command, now)

    const gradlew = getGradlew()
    const args = ANDROID_COMMANDS[command]
    const useSigningEnv = SIGNING_COMMANDS.has(command)
    const signingConfig = useSigningEnv ? getSigningConfig(db) : null
    const env = signingConfig ? buildSigningEnv(signingConfig) : process.env

    runBuildProcess({
      db,
      buildId,
      spawnCmd: gradlew,
      spawnArgs: args,
      cwd: workspacePath,
      env,
      logEvent: 'android:log-chunk',
      doneEvent: 'android:command-done',
      window: mainWindow,
      registry: activeAndroidProcesses,
      collectArtifacts: async () => {
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
        const artifactChecksums: Record<string, string> = {}
        await Promise.all(artifactPaths.map(async (artifactPath) => {
          try {
            artifactChecksums[artifactPath] = await computeSha256(artifactPath)
          } catch {
            // Leave checksum absent for files that disappear before hashing.
          }
        }))
        return { artifactPaths, artifactChecksums }
      },
    })

    return { buildId }
  })

  safeHandle('android:cancel-command', (_event, buildId: string) => {
    return cancelBuildProcess({ db, buildId, registry: activeAndroidProcesses })
  })

  safeHandle('android:get-records', (_event, limit?: number) => {
    debugTime('android:get-records')
    const rows = db.prepare(
      `SELECT * FROM build_records WHERE platform = 'android' ORDER BY started_at DESC LIMIT ?`
    ).all(limit ?? 20) as Record<string, unknown>[]
    const r = rows.map(mapBuildRecord)
    debugTimeEnd('android:get-records')
    return r
  })

  safeHandle('android:get-signing-config', () => {
    debugTime('android:get-signing-config')
    const r = getSigningConfig(db)
    debugTimeEnd('android:get-signing-config')
    return r
  })

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
    if (workspacePath && !isInsideDirectory(apkPath, workspacePath)) {
      return { success: false, error: 'APK path must be inside the Android workspace' }
    }
    if (path.extname(apkPath).toLowerCase() !== '.apk') {
      return { success: false, error: 'ADB install requires an APK artifact' }
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

    // Archive the previous release before overwriting so rollback is possible
    const prevManifest = await getAndroidUpdateManifest(db)
    if (prevManifest) {
      const prevApkName = prevManifest.artifactUrl.split('/').pop()
      const prevApkInFeed = prevApkName ? path.join(androidFeedDir, prevApkName) : null
      if (prevApkInFeed && existsSync(prevApkInFeed)) {
        const archiveDir = path.join(androidFeedDir, 'archive')
        mkdirSync(archiveDir, { recursive: true })
        const archiveName = `nexy-v${prevManifest.versionCode}-${prevManifest.publishedAt}.apk`
        const archivePath = path.join(archiveDir, archiveName)
        if (!existsSync(archivePath)) copyFileSync(prevApkInFeed, archivePath)
        await appendPublishHistory(androidFeedDir, prevManifest, archivePath)
      }
    }

    const apkName = path.basename(apkSrc)
    const destApk = path.join(androidFeedDir, apkName)
    copyFileSync(apkSrc, destApk)

    const checksum = await computeSha256(destApk)
    const wsInfo = await getAndroidWorkspaceInfo(db)
    const lanIp = getLocalIp()

    // Restart feed server bound to all interfaces so Android can reach it over LAN
    const feedPathRow = db.prepare("SELECT value FROM settings WHERE key = 'local_update_feed_path'").get() as { value: string } | undefined
    const feedRootPath = feedPathRow?.value ?? androidFeedDir
    await startFeedServer(feedRootPath, '0.0.0.0')
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

    await writeFile(path.join(androidFeedDir, 'android-update.json'), JSON.stringify(manifest, null, 2), 'utf8')

    return { published: true, manifest }
  })

  safeHandle('android:get-update-manifest', async () => {
    debugTime('android:get-update-manifest')
    const r = await getAndroidUpdateManifest(db)
    debugTimeEnd('android:get-update-manifest')
    return r
  })

  safeHandle('android:save-fcm-service-account', (_event, json: string) => {
    try {
      saveFcmServiceAccount(db, json)
      return { saved: true }
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeHandle('android:get-fcm-config-status', () => {
    debugTime('android:get-fcm-config-status')
    const r = getFcmConfigStatus(db)
    debugTimeEnd('android:get-fcm-config-status')
    return r
  })

  safeHandle('android:get-publish-history', async () => {
    debugTime('android:get-publish-history')
    const androidFeedDir = getAndroidFeedDir(db)
    const r = androidFeedDir ? await readPublishHistory(androidFeedDir) : []
    debugTimeEnd('android:get-publish-history')
    return r
  })

  safeHandle('android:restore-version', async (_event, versionCode: number) => {
    const androidFeedDir = getAndroidFeedDir(db)
    if (!androidFeedDir) return { restored: false, error: 'No local update feed path configured' }

    const history = await readPublishHistory(androidFeedDir)
    const entry = history.find((e) => e.versionCode === versionCode) as (AndroidUpdateManifest & { archiveApkPath?: string }) | undefined
    if (!entry) return { restored: false, error: `Version ${versionCode} not found in publish history` }

    const archivePath = entry.archiveApkPath
    if (!archivePath || !existsSync(archivePath)) {
      return { restored: false, error: `Archived APK for version ${versionCode} not found` }
    }

    const apkName = path.basename(archivePath)
    const destApk = path.join(androidFeedDir, apkName)
    copyFileSync(archivePath, destApk)

    const lanIp = getLocalIp()
    const feedPathRow = db.prepare("SELECT value FROM settings WHERE key = 'local_update_feed_path'").get() as { value: string } | undefined
    const feedRootPath = feedPathRow?.value ?? androidFeedDir
    await startFeedServer(feedRootPath, '0.0.0.0')
    const feedLanUrl = getFeedLanUrl(lanIp)

    const restoredManifest: AndroidUpdateManifest = {
      ...entry,
      artifactUrl: `${feedLanUrl}/android/${apkName}`,
      publishedAt: entry.publishedAt,
    }
    await writeFile(path.join(androidFeedDir, 'android-update.json'), JSON.stringify(restoredManifest, null, 2), 'utf8')

    return { restored: true, manifest: restoredManifest }
  })
}
