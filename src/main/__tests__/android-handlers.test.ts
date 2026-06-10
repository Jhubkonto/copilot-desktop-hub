import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

// ---------------------------------------------------------------------------
// Hoist mocks for child_process so the vi.mock factory can reference them
// ---------------------------------------------------------------------------

const { spawnMock, execSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  execSyncMock: vi.fn(),
}))

vi.mock('child_process', () => ({
  spawn: spawnMock,
  execSync: execSyncMock,
}))

// ---------------------------------------------------------------------------
// Mock electron, database, and safe-handle before importing the module
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class {},
}))

vi.mock('../database', () => ({
  getDatabase: vi.fn(),
}))

vi.mock('../safe-handle', () => ({
  safeHandle: vi.fn(),
}))

vi.mock('../local-feed-server', () => ({
  startFeedServer: vi.fn().mockResolvedValue(12345),
  stopFeedServer: vi.fn(),
  getFeedUrl: vi.fn().mockReturnValue('http://127.0.0.1:12345'),
  getFeedLanUrl: vi.fn().mockReturnValue('http://192.168.1.100:12345'),
  getFeedPort: vi.fn().mockReturnValue(12345),
  isFeedRunning: vi.fn().mockReturnValue(false),
  getFeedDir: vi.fn().mockReturnValue(''),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const openDatabases: Database.Database[] = []

function createDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initializeBaseSchema(db)
  runMigrations(db)
  openDatabases.push(db)
  return db
}

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close()
  }
  spawnMock.mockReset()
  execSyncMock.mockReset()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests: getAndroidWorkspaceInfo
// ---------------------------------------------------------------------------

describe('getAndroidWorkspaceInfo', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createDatabase()
  })

  it('returns git metadata when path is a git repo', async () => {
    execSyncMock
      .mockReturnValueOnce('abc123def456\n')    // git rev-parse HEAD
      .mockReturnValueOnce('main\n')             // git rev-parse --abbrev-ref HEAD
      .mockReturnValueOnce('abc123\n')           // git rev-parse --short HEAD
      .mockReturnValueOnce('')                   // git status --porcelain (clean)
      // gradlew properties throws (caught silently)
      .mockImplementationOnce(() => { throw new Error('no gradlew') })

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('android_workspace_path', ?)").run(process.cwd())

    const { getAndroidWorkspaceInfo } = await import('../android-handlers')
    const info = getAndroidWorkspaceInfo(db)

    expect(info.isGitRepo).toBe(true)
    expect(info.path).toBe(process.cwd())
    expect(info.branch).toBe('main')
    expect(info.commitSha).toBe('abc123')
    expect(info.dirty).toBe(false)
  })

  it('returns isGitRepo false when path is not a git repo', async () => {
    execSyncMock.mockImplementationOnce(() => { throw new Error('not a git repo') })

    const tmpDir = require('os').tmpdir() as string
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('android_workspace_path', ?)").run(tmpDir)

    const { getAndroidWorkspaceInfo } = await import('../android-handlers')
    const info = getAndroidWorkspaceInfo(db)

    expect(info.isGitRepo).toBe(false)
    expect(info.branch).toBeNull()
    expect(info.commitSha).toBeNull()
    expect(info.dirty).toBe(false)
  })

  it('returns null path when no workspace setting is stored', async () => {
    const { getAndroidWorkspaceInfo } = await import('../android-handlers')
    const info = getAndroidWorkspaceInfo(db)

    expect(info.path).toBe('')
    expect(info.isGitRepo).toBe(false)
  })

  it('returns null versionCode/versionName when Gradle is not available', async () => {
    execSyncMock
      .mockReturnValueOnce('abc123def456\n')    // git rev-parse HEAD
      .mockReturnValueOnce('main\n')             // branch
      .mockReturnValueOnce('abc123\n')           // short sha
      .mockReturnValueOnce('')                   // status (clean)
      .mockImplementationOnce(() => { throw new Error('gradlew not found') })

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('android_workspace_path', ?)").run(process.cwd())

    const { getAndroidWorkspaceInfo } = await import('../android-handlers')
    const info = getAndroidWorkspaceInfo(db)

    expect(info.versionCode).toBeNull()
    expect(info.versionName).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests: android:set-workspace-path
// ---------------------------------------------------------------------------

describe('registerAndroidHandlers — android:set-workspace-path', () => {
  let db: Database.Database
  let handlers: Map<string, Function>

  beforeEach(async () => {
    db = createDatabase()
    handlers = new Map()

    const { safeHandle } = await import('../safe-handle')
    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      handlers.set(channel, handler)
    })

    const { getDatabase } = await import('../database')
    vi.mocked(getDatabase).mockReturnValue(db)

    const { registerAndroidHandlers } = await import('../android-handlers')
    registerAndroidHandlers()
  })

  it('persists the path to settings', async () => {
    const handler = handlers.get('android:set-workspace-path')
    expect(handler).toBeDefined()

    // set-workspace-path calls getAndroidWorkspaceInfo which calls execSync for git
    execSyncMock.mockImplementation(() => { throw new Error('not a git repo') })

    const tmpDir = require('os').tmpdir() as string
    await handler?.({}, tmpDir)

    const row = db.prepare("SELECT value FROM settings WHERE key = 'android_workspace_path'").get() as { value: string } | undefined
    expect(row?.value).toBe(tmpDir)
  })

  it('returns workspace info with the new path', async () => {
    execSyncMock.mockImplementation(() => { throw new Error('not a git repo') })

    const handler = handlers.get('android:set-workspace-path')
    const tmpDir = require('os').tmpdir() as string
    const result = await handler?.({}, tmpDir)

    expect(result).toHaveProperty('path', tmpDir)
    expect(result).toHaveProperty('isGitRepo')
  })
})

// ---------------------------------------------------------------------------
// Tests: android:start-command
// ---------------------------------------------------------------------------

describe('registerAndroidHandlers — android:start-command', () => {
  let db: Database.Database
  let handlers: Map<string, Function>

  beforeEach(async () => {
    db = createDatabase()
    handlers = new Map()
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('android_workspace_path', ?)").run(process.cwd())

    spawnMock.mockReturnValue({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
    })

    // getAndroidWorkspaceInfo calls execSync for git — mock it to throw (caught silently)
    execSyncMock.mockImplementation(() => { throw new Error('no git here') })

    const { safeHandle } = await import('../safe-handle')
    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      handlers.set(channel, handler)
    })

    const { getDatabase } = await import('../database')
    vi.mocked(getDatabase).mockReturnValue(db)

    const { registerAndroidHandlers } = await import('../android-handlers')
    registerAndroidHandlers()
  })

  it('inserts a build_records row with platform=android', async () => {
    const handler = handlers.get('android:start-command')
    await handler?.({}, 'assembleDebug')

    const row = db.prepare("SELECT * FROM build_records WHERE platform = 'android'").get() as Record<string, unknown> | undefined
    expect(row).toBeDefined()
    expect(row?.command).toBe('assembleDebug')
    expect(row?.status).toBe('running')
    expect(row?.platform).toBe('android')
  })

  it('spawns assembleDebug with correct args', async () => {
    const handler = handlers.get('android:start-command')
    await handler?.({}, 'assembleDebug')

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['assembleDebug'],
      expect.objectContaining({ shell: true })
    )
  })

  it('spawns assembleRelease with correct args', async () => {
    const handler = handlers.get('android:start-command')
    await handler?.({}, 'assembleRelease')

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['assembleRelease'],
      expect.any(Object)
    )
  })

  it('injects signing env vars for assembleRelease', async () => {
    const signingConfig = { keystorePath: '/key.jks', keystorePassword: 'pass', keyAlias: 'key', keyPassword: 'kpass' }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('android_signing_config', ?)").run(JSON.stringify(signingConfig))

    const handler = handlers.get('android:start-command')
    await handler?.({}, 'assembleRelease')

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['assembleRelease'],
      expect.objectContaining({
        env: expect.objectContaining({
          NEXY_KEYSTORE_PATH: '/key.jks',
          NEXY_KEY_ALIAS: 'key',
        })
      })
    )
  })

  it('does NOT inject signing env vars for assembleDebug', async () => {
    const signingConfig = { keystorePath: '/key.jks', keystorePassword: 'pass', keyAlias: 'key', keyPassword: 'kpass' }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('android_signing_config', ?)").run(JSON.stringify(signingConfig))

    const handler = handlers.get('android:start-command')
    await handler?.({}, 'assembleDebug')

    const callArgs = spawnMock.mock.calls[0]
    const spawnEnv = callArgs[2]?.env ?? process.env
    expect(spawnEnv).not.toHaveProperty('NEXY_KEYSTORE_PATH')
  })

  it('does NOT inject signing env vars for test', async () => {
    const handler = handlers.get('android:start-command')
    await handler?.({}, 'test')

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['test'],
      expect.any(Object)
    )
    const callArgs = spawnMock.mock.calls[0]
    const spawnEnv = callArgs[2]?.env ?? process.env
    expect(spawnEnv).not.toHaveProperty('NEXY_KEYSTORE_PATH')
  })

  it('returns a buildId', async () => {
    const handler = handlers.get('android:start-command')
    const result = await handler?.({}, 'test')
    expect(result).toHaveProperty('buildId')
    expect(typeof result.buildId).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// Tests: android:get-records
// ---------------------------------------------------------------------------

describe('registerAndroidHandlers — android:get-records', () => {
  let db: Database.Database
  let handlers: Map<string, Function>

  beforeEach(async () => {
    db = createDatabase()
    handlers = new Map()

    const { safeHandle } = await import('../safe-handle')
    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      handlers.set(channel, handler)
    })

    const { getDatabase } = await import('../database')
    vi.mocked(getDatabase).mockReturnValue(db)

    const { registerAndroidHandlers } = await import('../android-handlers')
    registerAndroidHandlers()
  })

  it('returns only android platform records', async () => {
    db.prepare(
      `INSERT INTO build_records (id, workspace_path, platform, command, status, started_at)
       VALUES ('r1', '/ws', 'android', 'assembleDebug', 'success', 1000)`
    ).run()
    db.prepare(
      `INSERT INTO build_records (id, workspace_path, platform, command, status, started_at)
       VALUES ('r2', '/ws', 'win32', 'package', 'success', 1001)`
    ).run()

    const handler = handlers.get('android:get-records')
    const records = await handler?.({})
    expect(records).toHaveLength(1)
    expect(records[0].id).toBe('r1')
    expect(records[0].platform).toBe('android')
  })

  it('does not return desktop build records', async () => {
    db.prepare(
      `INSERT INTO build_records (id, workspace_path, platform, command, status, started_at)
       VALUES ('d1', '/ws', 'win32', 'typecheck', 'success', 999)`
    ).run()

    const handler = handlers.get('android:get-records')
    const records = await handler?.({})
    expect(records).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Tests: android:set-signing-config / android:get-signing-config
// ---------------------------------------------------------------------------

describe('registerAndroidHandlers — signing config', () => {
  let db: Database.Database
  let handlers: Map<string, Function>

  beforeEach(async () => {
    db = createDatabase()
    handlers = new Map()

    const { safeHandle } = await import('../safe-handle')
    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      handlers.set(channel, handler)
    })

    const { getDatabase } = await import('../database')
    vi.mocked(getDatabase).mockReturnValue(db)

    const { registerAndroidHandlers } = await import('../android-handlers')
    registerAndroidHandlers()
  })

  it('round-trips signing config as JSON', async () => {
    const config = { keystorePath: '/key.jks', keystorePassword: 'pass123', keyAlias: 'mykey', keyPassword: 'kp456' }

    const setHandler = handlers.get('android:set-signing-config')
    await setHandler?.({}, config)

    const getHandler = handlers.get('android:get-signing-config')
    const retrieved = await getHandler?.({})
    expect(retrieved).toEqual(config)
  })

  it('returns null when no config is stored', async () => {
    const handler = handlers.get('android:get-signing-config')
    const result = await handler?.({})
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests: android:list-adb-devices
// ---------------------------------------------------------------------------

describe('registerAndroidHandlers — android:list-adb-devices', () => {
  let db: Database.Database
  let handlers: Map<string, Function>

  beforeEach(async () => {
    db = createDatabase()
    handlers = new Map()

    const { safeHandle } = await import('../safe-handle')
    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      handlers.set(channel, handler)
    })

    const { getDatabase } = await import('../database')
    vi.mocked(getDatabase).mockReturnValue(db)

    const { registerAndroidHandlers } = await import('../android-handlers')
    registerAndroidHandlers()
  })

  it('parses adb devices -l output correctly', async () => {
    execSyncMock.mockReturnValue(
      'List of devices attached\nR58M123456\tdevice product:beyond1 model:SM_G973F transport_id:1\n'
    )

    const handler = handlers.get('android:list-adb-devices')
    const devices = await handler?.({})
    expect(devices).toHaveLength(1)
    expect(devices[0].serial).toBe('R58M123456')
    expect(devices[0].state).toBe('device')
    expect(devices[0].model).toBe('SM_G973F')
  })

  it('returns empty array when adb is not found', async () => {
    execSyncMock.mockImplementation(() => { throw new Error('adb not found') })

    const handler = handlers.get('android:list-adb-devices')
    const devices = await handler?.({})
    expect(devices).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Tests: android:publish-update
// ---------------------------------------------------------------------------

describe('registerAndroidHandlers — android:publish-update', () => {
  let db: Database.Database
  let handlers: Map<string, Function>

  beforeEach(async () => {
    db = createDatabase()
    handlers = new Map()

    const { safeHandle } = await import('../safe-handle')
    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      handlers.set(channel, handler)
    })

    const { getDatabase } = await import('../database')
    vi.mocked(getDatabase).mockReturnValue(db)

    const { registerAndroidHandlers } = await import('../android-handlers')
    registerAndroidHandlers()
  })

  it('returns error when no feed path is configured', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('android_workspace_path', ?)").run(process.cwd())

    const handler = handlers.get('android:publish-update')
    const result = await handler?.({})
    expect(result.published).toBe(false)
    expect(result.error).toContain('feed path')
  })

  it('returns error when no release APK exists', async () => {
    const tmpDir = require('os').tmpdir() as string
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('android_workspace_path', ?)").run(tmpDir)
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('local_update_feed_path', ?)").run(tmpDir)

    const handler = handlers.get('android:publish-update')
    const result = await handler?.({})
    expect(result.published).toBe(false)
    expect(result.error).toContain('APK')
  })

  it('writes manifest JSON when APK and feed path are present', async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import('fs')
    const { join } = await import('path')
    const tmpDir = require('os').tmpdir() as string
    const wsDir = join(tmpDir, `nexy-android-test-${Date.now()}`)
    const feedDir = join(tmpDir, `nexy-feed-test-${Date.now()}`)
    const apkDir = join(wsDir, 'app', 'build', 'outputs', 'apk', 'release')

    mkdirSync(apkDir, { recursive: true })
    mkdirSync(feedDir, { recursive: true })
    writeFileSync(join(apkDir, 'app-release.apk'), Buffer.alloc(100))

    try {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('android_workspace_path', ?)").run(wsDir)
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('local_update_feed_path', ?)").run(feedDir)

      const handler = handlers.get('android:publish-update')
      const result = await handler?.({})

      expect(result.published).toBe(true)
      expect(result.manifest).toBeDefined()
      expect(result.manifest?.artifactUrl).toContain('android')

      const { existsSync, readFileSync } = await import('fs')
      const manifestPath = join(feedDir, 'android', 'android-update.json')
      expect(existsSync(manifestPath)).toBe(true)
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      expect(manifest).toHaveProperty('versionCode')
      expect(manifest).toHaveProperty('checksum')
      expect(manifest).toHaveProperty('artifactUrl')
      expect(manifest).toHaveProperty('publishedAt')
    } finally {
      rmSync(wsDir, { recursive: true, force: true })
      rmSync(feedDir, { recursive: true, force: true })
    }
  })
})
