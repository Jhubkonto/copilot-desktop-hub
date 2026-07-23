import { randomUUID, createHash, randomBytes } from 'crypto'
import { execSync, spawn, execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { networkInterfaces } from 'os'
import { app, BrowserWindow, safeStorage } from 'electron'
import type Database from 'better-sqlite3'
import { safeHandle } from './safe-handle'
import { getDatabase } from './database'
import { startFeedServer, getFeedLanUrl, isFeedRunning } from './local-feed-server'
import { debugTime, debugTimeEnd } from './debug-mode'
import { runBuildProcess, cancelBuildProcess, mapBuildRecord } from './build-runner'
import { startActivity, endActivity } from './activity-tracker'
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

// Keep this in sync with android/app/build.gradle.kts.  Gradle adds this
// offset to the Git commit count so a release rebuilt from an unchanged commit
// can still supersede the prior installed APK.  The desktop must advertise the
// same value in its build records and update manifest.
const ANDROID_RELEASE_BUILD_OFFSET = 1
const ANDROID_VERSION_CODE_ENV = 'NEXY_ANDROID_VERSION_CODE'
const ANDROID_BUILD_ID_ENV = 'NEXY_ANDROID_BUILD_ID'
const ANDROID_COMMIT_SHA_ENV = 'NEXY_ANDROID_COMMIT_SHA'
const ANDROID_SOURCE_DIRTY_ENV = 'NEXY_ANDROID_SOURCE_DIRTY'
const ANDROID_BUILD_TIMESTAMP_ENV = 'NEXY_ANDROID_BUILD_TIMESTAMP'

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
    hasGradleProject: false,
  }

  if (!workspacePath) return info
  info.hasGradleProject = existsSync(path.join(workspacePath, 'gradlew')) || existsSync(path.join(workspacePath, 'gradlew.bat'))

  try {
    const [, statusOut] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workspacePath, timeout: 5000 })
        .then(({ stdout }) => { info.branch = stdout.trim() }),
      execFileAsync('git', ['status', '--porcelain'], { cwd: workspacePath, timeout: 5000 }),
      execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: workspacePath, timeout: 5000 })
        .then(({ stdout }) => { info.commitSha = stdout.trim() }),
      // Mirror the versionCode that app/build.gradle.kts embeds in the APK so
      // the published manifest matches BuildConfig.VERSION_CODE. Without this,
      // an APK can be newer than the manifest advertised to Android and the
      // companion will correctly decline to install it as an update.
      execFileAsync('git', ['rev-list', '--count', 'HEAD'], { cwd: workspacePath, timeout: 5000 })
        .then(({ stdout }) => {
          const count = parseInt(stdout.trim(), 10)
          if (Number.isFinite(count) && count > 0) {
            info.versionCode = count + ANDROID_RELEASE_BUILD_OFFSET
            info.versionName = `1.0.${info.versionCode}`
          }
        }),
    ])
    info.isGitRepo = true
    info.dirty = statusOut.stdout.trim().length > 0
  } catch {
    // not a git repo
  }

  try {
    // If the Gradle project ever exposes versionCode/versionName as project
    // properties, prefer those over the git-derived fallback above.
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

/**
 * Gradle inherits the desktop process environment. On Windows that can point
 * at an extension-provided JRE (for example VS Code's Java extension) rather
 * than a complete JDK. Android's JdkImageTransform requires `jlink`, so make
 * the Android build use a verified JDK explicitly.
 */
function resolveAndroidJdkHome(): string | null {
  const candidates = [
    process.env.JAVA_HOME,
    process.env.JDK_HOME,
    process.platform === 'win32' ? path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Android', 'Android Studio', 'jbr') : undefined,
    process.platform === 'darwin' ? '/Applications/Android Studio.app/Contents/jbr/Contents/Home' : undefined,
    process.platform === 'linux' ? '/opt/android-studio/jbr' : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate))

  const jlinkName = process.platform === 'win32' ? 'jlink.exe' : 'jlink'
  return candidates.find((candidate) => existsSync(path.join(candidate, 'bin', jlinkName))) ?? null
}

function androidGradleArgs(command: AndroidBuildCommandName): string[] {
  const jdkHome = resolveAndroidJdkHome()
  if (!jdkHome) {
    throw new Error('No complete JDK was found for the Android build. Install Android Studio (including its bundled JDK) or set JAVA_HOME to a JDK containing bin/jlink.')
  }
  // The command-line property takes precedence over a stale user Gradle/IDE
  // setting such as the missing VS Code runtime shown in build diagnostics.
  // Quote the value because Android Studio's default JBR path contains spaces
  // on Windows; the build runner invokes Gradle through the platform shell.
  return [`-Dorg.gradle.java.home="${jdkHome}"`, ...ANDROID_COMMANDS[command]]
}

/**
 * A user-level Gradle property can override JAVA_HOME. Inject the verified JDK
 * into the Gradle launcher's JVM options too, so a stale IDE runtime cannot be
 * selected before project settings are evaluated.
 */
function withVerifiedAndroidJdk(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const jdkHome = resolveAndroidJdkHome()
  if (!jdkHome) return env
  const jdkOption = `-Dorg.gradle.java.home="${jdkHome}"`
  return {
    ...env,
    JAVA_HOME: jdkHome,
    JDK_HOME: jdkHome,
    GRADLE_OPTS: [env.GRADLE_OPTS, jdkOption].filter(Boolean).join(' '),
  }
}

export function getSigningConfig(db: Database.Database): AndroidSigningConfig | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'android_signing_config'").get() as { value: string } | undefined
  if (!row?.value) return null
  try {
    const encryptedRow = db.prepare("SELECT value FROM settings WHERE key = 'android_signing_config_encrypted'").get() as { value: string } | undefined
    const rawValue = encryptedRow?.value === 'true' && safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(row.value, 'base64'))
      : row.value
    return JSON.parse(rawValue) as AndroidSigningConfig
  } catch {
    return null
  }
}

/**
 * Android Studio installs platform-tools in the SDK directory, but does not
 * always add it to the PATH inherited by Electron. Prefer an explicit SDK
 * location so ADB install works out of the box on those installations.
 */
function getAdbCommand(): string {
  const adbFileName = process.platform === 'win32' ? 'adb.exe' : 'adb'
  const sdkRoots = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : undefined,
  ].filter((value): value is string => Boolean(value))

  for (const sdkRoot of sdkRoots) {
    const adbPath = path.join(sdkRoot, 'platform-tools', adbFileName)
    if (existsSync(adbPath)) return adbPath
  }

  return 'adb'
}

function saveSigningConfig(db: Database.Database, config: AndroidSigningConfig): void {
  const rawValue = JSON.stringify(config)
  if (safeStorage.isEncryptionAvailable()) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('android_signing_config', ?)").run(safeStorage.encryptString(rawValue).toString('base64'))
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('android_signing_config_encrypted', 'true')").run()
  } else {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('android_signing_config', ?)").run(rawValue)
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('android_signing_config_encrypted', 'false')").run()
  }
}

function randomSigningSecret(): string {
  return randomBytes(24).toString('base64url')
}

async function ensureAndroidSigningConfig(db: Database.Database): Promise<AndroidSigningConfig> {
  const existing = getSigningConfig(db)
  if (existing && (!existing.generated || existsSync(existing.keystorePath))) return existing

  const signingDir = path.join(app.getPath('userData'), 'android-signing')
  const keystorePath = path.join(signingDir, 'nexy-internal-release.p12')
  const keyAlias = 'nexy-internal-release'
  mkdirSync(signingDir, { recursive: true })

  const keystorePassword = randomSigningSecret()
  const config: AndroidSigningConfig = {
    keystorePath,
    keystorePassword,
    keyAlias,
    keyPassword: keystorePassword,
    generated: true,
  }

  if (!existsSync(keystorePath)) {
    await execFileAsync('keytool', [
      '-genkeypair',
      '-v',
      '-keystore', keystorePath,
      '-storetype', 'PKCS12',
      '-storepass', config.keystorePassword,
      '-keypass', config.keyPassword,
      '-alias', config.keyAlias,
      '-keyalg', 'RSA',
      '-keysize', '2048',
      '-validity', '10000',
      '-dname', 'CN=Nexy Internal Release, OU=Internal, O=Nexy, L=Internal, S=Internal, C=US',
    ], { timeout: 30000 })
  }

  saveSigningConfig(db, config)
  return config
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
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as AndroidUpdateManifest
    return { ...manifest, artifactUrl: refreshArtifactUrl(manifest.artifactUrl) }
  } catch {
    return null
  }
}

// The manifest on disk embeds the feed origin that was current at publish
// time, but the feed server gets a fresh random port each launch and the LAN
// IP can change. Re-point the URL at the live feed so downloads keep working
// across desktop restarts.
function refreshArtifactUrl(artifactUrl: string): string {
  if (!isFeedRunning()) return artifactUrl
  const liveOrigin = getFeedLanUrl(getLocalIp())
  if (!liveOrigin) return artifactUrl
  try {
    return `${liveOrigin}${new URL(artifactUrl).pathname}`
  } catch {
    return artifactUrl
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

// ---------------------------------------------------------------------------
// Shared publish/restore (used by IPC handlers + mobile WS commands)
// ---------------------------------------------------------------------------

async function ensureLanFeedServer(db: Database.Database, androidFeedDir: string): Promise<string> {
  if (!isFeedRunning()) {
    const feedPathRow = db.prepare("SELECT value FROM settings WHERE key = 'local_update_feed_path'").get() as { value: string } | undefined
    await startFeedServer(feedPathRow?.value ?? androidFeedDir)
  }
  return getFeedLanUrl(getLocalIp())
}

export async function publishAndroidUpdate(db: Database.Database): Promise<{ published: boolean; manifest?: AndroidUpdateManifest; error?: string; warning?: string }> {
  // Production update path (UPD.16):
  // 1. Run assembleRelease from desktop — Gradle signs APK via NEXY_KEYSTORE_* env vars.
  // 2. Publish — copies APK to {feedPath}/android/, writes android-update.json.
  // 3. Feed server serves it on all interfaces so Android can reach it over LAN.
  // 4. Next WS connect sends feedUrl (LAN IP) in `connected` event.
  // 5. Android fetches android-update.json, compares versionCode with BuildConfig.VERSION_CODE.
  // 6. User taps Download & Install — the APK is downloaded and handed to the system installer.
  // For production outside LAN: replace feedUrl with a stable HTTPS URL; the manifest schema is unchanged.

  const androidFeedDir = getAndroidFeedDir(db)
  if (!androidFeedDir) return { published: false, error: 'No local update feed path configured' }

  const workspacePath = getAndroidWorkspacePath(db)
  if (!workspacePath) return { published: false, error: 'Android workspace path not configured' }

  const builtRelease = db.prepare(
    `SELECT id, version_code AS versionCode, version, commit_sha AS commitSha,
            artifact_paths AS artifactPaths, artifact_checksums AS artifactChecksums,
            started_at AS startedAt
       FROM build_records
      WHERE platform = 'android' AND command = 'assembleRelease' AND status = 'success'
      ORDER BY finished_at DESC LIMIT 1`
  ).get() as {
    id: string
    versionCode: number | null
    version: string | null
    commitSha: string | null
    artifactPaths: string | null
    artifactChecksums: string | null
    startedAt: number
  } | undefined

  let apkSrc: string | null = null
  let recordedChecksum: string | null = null
  if (builtRelease) {
    const recordedPaths = JSON.parse(builtRelease.artifactPaths ?? '[]') as string[]
    apkSrc = recordedPaths.find((candidate) =>
      candidate.toLowerCase().endsWith('.apk') &&
      !path.basename(candidate).toLowerCase().includes('unsigned') &&
      existsSync(candidate)
    ) ?? null
    if (!apkSrc) {
      return {
        published: false,
        error: 'The latest successful release build has no installable APK artifact. Run assembleRelease again before publishing.',
      }
    }
    const checksums = JSON.parse(builtRelease.artifactChecksums ?? '{}') as Record<string, string>
    recordedChecksum = checksums[apkSrc] ?? null
  }

  // Legacy fallback for build records created before artifact tracking existed.
  const releaseApkDir = path.join(workspacePath, 'app', 'build', 'outputs', 'apk', 'release')
  if (!builtRelease && existsSync(releaseApkDir)) {
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
  if (!apkSrc) return { published: false, error: 'No release APK found — click the "assembleRelease" button under Android Build first, then Publish.' }

  // An unsigned APK cannot be installed by Android. Do not put one on the feed:
  // doing so makes the update flow look successful even though every device
  // will reject the artifact at the final system-installer step.
  if (path.basename(apkSrc).toLowerCase().includes('unsigned')) {
    return {
      published: false,
      error: 'The release APK is unsigned and cannot be installed. Run assembleRelease from the current Nexy Desktop app (it creates a signing key automatically), then publish the resulting app-release.apk.',
    }
  }

  mkdirSync(androidFeedDir, { recursive: true })

  if (recordedChecksum) {
    const currentChecksum = await computeSha256(apkSrc)
    if (currentChecksum !== recordedChecksum) {
      return {
        published: false,
        error: 'The release APK changed after its build record was created. Run assembleRelease again so the published metadata and APK cannot get out of sync.',
      }
    }
  }

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
  const feedLanUrl = await ensureLanFeedServer(db, androidFeedDir)

  const manifest: AndroidUpdateManifest = {
    versionCode: builtRelease?.versionCode ?? wsInfo.versionCode ?? 1,
    versionName: builtRelease?.version ?? wsInfo.versionName ?? '1.0',
    commitSha: builtRelease?.commitSha ?? wsInfo.commitSha,
    buildId: builtRelease?.id ?? null,
    sourceDirty: wsInfo.dirty,
    builtAt: builtRelease?.startedAt ?? null,
    changelog: '',
    checksum,
    artifactUrl: `${feedLanUrl}/android/${apkName}`,
    publishedAt: Date.now(),
  }

  await writeFile(path.join(androidFeedDir, 'android-update.json'), JSON.stringify(manifest, null, 2), 'utf8')

  return { published: true, manifest }
}

/**
 * Allocate a code before a release build starts. Git commit count cannot do
 * this: rebuilding an unchanged checkout would otherwise produce the exact
 * same APK versionCode and Android would reject it as an update.
 */
function reserveReleaseVersionCode(db: Database.Database, fallbackCode: number | null): number {
  const recorded = db.prepare(
    "SELECT MAX(version_code) AS versionCode FROM build_records WHERE platform = 'android' AND command IN ('assembleRelease', 'bundleRelease')"
  ).get() as { versionCode: number | null } | undefined
  const base = Math.max(fallbackCode ?? 0, recorded?.versionCode ?? 0)
  return Math.max(base + 1, 1)
}

function buildAndroidBuildEnv(
  signingConfig: AndroidSigningConfig | null,
  versionCode: number | null,
  buildId: string,
  workspaceInfo: AndroidWorkspaceInfo,
  buildTimestamp: number,
): NodeJS.ProcessEnv {
  const env = signingConfig ? buildSigningEnv(signingConfig) : { ...process.env }
  const withJdk = withVerifiedAndroidJdk(env)
  return {
    ...withJdk,
    ...(versionCode == null ? {} : { [ANDROID_VERSION_CODE_ENV]: String(versionCode) }),
    [ANDROID_BUILD_ID_ENV]: buildId,
    [ANDROID_COMMIT_SHA_ENV]: workspaceInfo.commitSha ?? 'unknown',
    [ANDROID_SOURCE_DIRTY_ENV]: String(workspaceInfo.dirty),
    [ANDROID_BUILD_TIMESTAMP_ENV]: String(buildTimestamp),
  }
}

export async function restoreAndroidVersion(db: Database.Database, versionCode: number): Promise<{ restored: boolean; manifest?: AndroidUpdateManifest; error?: string }> {
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

  const feedLanUrl = await ensureLanFeedServer(db, androidFeedDir)
  const restoredManifest: AndroidUpdateManifest = {
    ...entry,
    artifactUrl: `${feedLanUrl}/android/${apkName}`,
    publishedAt: entry.publishedAt,
  }
  await writeFile(path.join(androidFeedDir, 'android-update.json'), JSON.stringify(restoredManifest, null, 2), 'utf8')

  return { restored: true, manifest: restoredManifest }
}

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

// Scans the Gradle output dir for the command's artifacts produced since the
// build started and hashes them. Shared by the IPC handler and the mobile
// (WS) build starter.
async function collectAndroidArtifacts(
  workspacePath: string,
  command: AndroidBuildCommandName,
  sinceMtime: number,
): Promise<{ artifactPaths: string[]; artifactChecksums: Record<string, string> }> {
  const artifactDir = getArtifactDir(workspacePath, command)
  let artifactPaths: string[] = []
  if (artifactDir && existsSync(artifactDir)) {
    try {
      artifactPaths = readdirSync(artifactDir)
        .map((f) => path.join(artifactDir, f))
        .filter((f) => {
          try { return statSync(f).isFile() && statSync(f).mtimeMs >= sinceMtime } catch { return false }
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
}

// ---------------------------------------------------------------------------
// Mobile-initiated Android build API (called from ws-handlers.ts)
// ---------------------------------------------------------------------------

// Reuses the desktop build's `build:log-chunk` / `build:command-done` event
// channel (mirrored to mobile) so the companion's existing build-log UI renders
// the Gradle output. The record is stored with platform 'android' so it lands
// in Android Build Records and can be published/restored.
export async function startAndroidBuildFromMobile(
  command: AndroidBuildCommandName,
  mainWindow?: BrowserWindow,
): Promise<{ buildId: string }> {
  const db = getDatabase()
  const workspacePath = getAndroidWorkspacePath(db)
  if (!workspacePath) throw new Error('Android workspace path not configured')

  const buildId = randomUUID()
  const workspaceInfo = await getAndroidWorkspaceInfo(db)
  const releaseVersionCode = SIGNING_COMMANDS.has(command)
    ? reserveReleaseVersionCode(db, workspaceInfo.versionCode)
    : workspaceInfo.versionCode
  const wsInfo = releaseVersionCode === workspaceInfo.versionCode ? workspaceInfo : {
    ...workspaceInfo,
    versionCode: releaseVersionCode,
    versionName: `1.0.${releaseVersionCode}`,
  }
  const now = Date.now()
  const gradlew = getGradlew()
  const args = androidGradleArgs(command)
  const useSigningEnv = SIGNING_COMMANDS.has(command)
  const signingConfig = useSigningEnv ? await ensureAndroidSigningConfig(db) : null
  const env = buildAndroidBuildEnv(
    signingConfig,
    SIGNING_COMMANDS.has(command) ? releaseVersionCode : null,
    buildId,
    workspaceInfo,
    now,
  )

  db.prepare(
    `INSERT INTO build_records
      (id, workspace_path, commit_sha, branch, version, version_code, platform, command, status, started_at, mobile_initiated)
     VALUES (?, ?, ?, ?, ?, ?, 'android', ?, 'running', ?, 1)`
  ).run(buildId, workspacePath, wsInfo.commitSha, wsInfo.branch, wsInfo.versionName, wsInfo.versionCode, command, now)

  startActivity({ id: `android-build:${buildId}`, kind: 'build', label: `Android build (${command})…`, detail: wsInfo.branch ?? undefined })

  runBuildProcess({
    db,
    buildId,
    spawnCmd: gradlew,
    spawnArgs: args,
    cwd: workspacePath,
    env,
    logEvent: 'build:log-chunk',
    doneEvent: 'build:command-done',
    window: mainWindow,
    mirrorToMobile: true,
    registry: activeAndroidProcesses,
    collectArtifacts: () => collectAndroidArtifacts(workspacePath, command, now),
    onDone: () => endActivity(`android-build:${buildId}`),
  })

  return { buildId }
}

export function cancelAndroidBuildFromMobile(buildId: string): boolean {
  return cancelBuildProcess({
    db: getDatabase(),
    buildId,
    registry: activeAndroidProcesses,
    mobileDoneEvent: 'build:command-done',
    onCancelled: () => endActivity(`android-build:${buildId}`),
  })
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

    const workspaceInfo = await getAndroidWorkspaceInfo(db)
    const releaseVersionCode = SIGNING_COMMANDS.has(command)
      ? reserveReleaseVersionCode(db, workspaceInfo.versionCode)
      : workspaceInfo.versionCode
    const wsInfo = releaseVersionCode === workspaceInfo.versionCode ? workspaceInfo : {
      ...workspaceInfo,
      versionCode: releaseVersionCode,
      versionName: `1.0.${releaseVersionCode}`,
    }
    const now = Date.now()
    const gradlew = getGradlew()
    const args = androidGradleArgs(command)
    const useSigningEnv = SIGNING_COMMANDS.has(command)
    const signingConfig = useSigningEnv ? await ensureAndroidSigningConfig(db) : null
    const env = buildAndroidBuildEnv(
      signingConfig,
      SIGNING_COMMANDS.has(command) ? releaseVersionCode : null,
      buildId,
      workspaceInfo,
      now,
    )

    db.prepare(
      `INSERT INTO build_records
        (id, workspace_path, commit_sha, branch, version, version_code, platform, command, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, 'android', ?, 'running', ?)`
    ).run(buildId, workspacePath, wsInfo.commitSha, wsInfo.branch, wsInfo.versionName, wsInfo.versionCode, command, now)

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
      collectArtifacts: () => collectAndroidArtifacts(workspacePath, command, now),
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
    saveSigningConfig(db, { ...config, generated: false })
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
      const adbCommand = getAdbCommand()
      const output = execSync(`"${adbCommand}" devices -l`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
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
      let output = ''
      // Do not invoke cmd.exe here. Apart from being unnecessary, shell mode
      // can misquote paths and makes a failed adb invocation look like an APK
      // install failure. adb reports most install diagnostics on stdout.
      const child = spawn(getAdbCommand(), ['-s', serial, 'install', '-r', apkPath], { shell: false, windowsHide: true })
      child.stdout?.on('data', (d: Buffer) => { output += d.toString() })
      child.stderr?.on('data', (d: Buffer) => { output += d.toString() })
      child.on('error', (error) => resolve({ success: false, error: `Could not start ADB: ${error.message}` }))
      child.on('close', (code) => {
        if (code === 0) resolve({ success: true })
        else resolve({ success: false, error: output.trim() || `adb install exited with code ${code}` })
      })
    })
  })

  safeHandle('android:publish-update', () => publishAndroidUpdate(db))

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

  safeHandle('android:restore-version', (_event, versionCode: number) => restoreAndroidVersion(db, versionCode))
}
