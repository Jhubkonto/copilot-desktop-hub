import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports of the module under test.
// child_process is mocked here so getWorkspaceInfo (which uses execFileAsync)
// resolves immediately without spawning real git processes.
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class {},
}))

vi.mock('electron-updater', () => ({
  default: { autoUpdater: { setFeedURL: vi.fn() } },
}))

vi.mock('../database', () => ({
  getDatabase: vi.fn(),
}))

vi.mock('../safe-handle', () => ({
  safeHandle: vi.fn(),
}))

vi.mock('../local-feed-server', () => ({
  startFeedServer: vi.fn().mockResolvedValue(0),
  stopFeedServer: vi.fn(),
  getFeedUrl: vi.fn().mockReturnValue(''),
  getFeedPort: vi.fn().mockReturnValue(0),
  isFeedRunning: vi.fn().mockReturnValue(false),
  getFeedDir: vi.fn().mockReturnValue(''),
}))

vi.mock('../ws-server', () => ({
  broadcastToMobile: vi.fn(),
  startWsServer: vi.fn(),
  stopWsServer: vi.fn(),
  getWsStatus: vi.fn(),
  getQrDataUrl: vi.fn(),
  regenerateToken: vi.fn(),
  setWsCommandHandler: vi.fn(),
  getWakelockEnabled: vi.fn(),
  setWakelockEnabled: vi.fn(),
}))

// Hoist spawn + execFile mocks so the vi.mock factory can close over them
const { spawnMockFn, execFileMockFn } = vi.hoisted(() => ({
  spawnMockFn: vi.fn(),
  execFileMockFn: vi.fn(),
}))

vi.mock('child_process', () => ({
  spawn: spawnMockFn,
  execFile: execFileMockFn,
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

function makeChild() {
  const { EventEmitter } = require('events') as typeof import('events')
  type FakeChild = NodeJS.EventEmitter & {
    stdout: NodeJS.EventEmitter
    stderr: NodeJS.EventEmitter
    kill: () => void
  }
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

async function closeChild(child: ReturnType<typeof makeChild>, code: number): Promise<void> {
  await Promise.all(child.listeners('close').map((listener) => Promise.resolve(listener(code))))
}

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startBuildFromMobile', () => {
  let db: Database.Database

  beforeEach(async () => {
    db = createDatabase()
    const { getDatabase } = await import('../database')
    vi.mocked(getDatabase).mockReturnValue(db)

    // execFile called by getWorkspaceInfo (via execFileAsync) — resolve immediately
    execFileMockFn.mockReset()
    execFileMockFn.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: null, result: { stdout: string; stderr: string }) => void,
      ) => { cb(null, { stdout: '', stderr: '' }) },
    )

    spawnMockFn.mockReset()
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run(process.cwd())
  })

  it('returns a buildId and inserts a running record with mobile_initiated=1', async () => {
    const child = makeChild()
    spawnMockFn.mockReturnValue(child)

    const { startBuildFromMobile } = await import('../build-handlers')
    const { buildId } = await startBuildFromMobile('typecheck')

    expect(buildId).toBeTruthy()
    const row = db.prepare('SELECT * FROM build_records WHERE id = ?').get(buildId) as Record<string, unknown>
    expect(row.status).toBe('running')
    expect(row.command).toBe('typecheck')
    expect(row.mobile_initiated).toBe(1)
  })

  it('marks the record as success when the process exits with code 0', async () => {
    const child = makeChild()
    spawnMockFn.mockReturnValue(child)

    const { startBuildFromMobile } = await import('../build-handlers')
    const { buildId } = await startBuildFromMobile('typecheck')

    await closeChild(child, 0)

    const row = db.prepare('SELECT status, exit_code FROM build_records WHERE id = ?').get(buildId) as {
      status: string
      exit_code: number
    }
    expect(row.status).toBe('success')
    expect(row.exit_code).toBe(0)
  })

  it('marks the record as failed when process exits with non-zero code', async () => {
    const child = makeChild()
    spawnMockFn.mockReturnValue(child)

    const { startBuildFromMobile } = await import('../build-handlers')
    const { buildId } = await startBuildFromMobile('test')

    await closeChild(child, 1)

    const row = db.prepare('SELECT status FROM build_records WHERE id = ?').get(buildId) as { status: string }
    expect(row.status).toBe('failed')
  })

  it('broadcasts build:log-chunk lines and build:command-done to mobile', async () => {
    const child = makeChild()
    spawnMockFn.mockReturnValue(child)

    const { broadcastToMobile } = await import('../ws-server')
    const broadcastMock = vi.mocked(broadcastToMobile)
    broadcastMock.mockClear()

    const { startBuildFromMobile } = await import('../build-handlers')
    const { buildId } = await startBuildFromMobile('typecheck')

    child.stdout.emit('data', Buffer.from('line one\nline two\n'))
    await closeChild(child, 0)

    const chunkCalls = broadcastMock.mock.calls.filter((c) => c[0].event === 'build:log-chunk')
    expect(chunkCalls.length).toBeGreaterThanOrEqual(2)
    expect((chunkCalls[0][0].data as Record<string, unknown>).buildId).toBe(buildId)

    const doneCalls = broadcastMock.mock.calls.filter((c) => c[0].event === 'build:command-done')
    expect(doneCalls.length).toBe(1)
    expect((doneCalls[0][0].data as Record<string, unknown>).status).toBe('success')
  })

  it('cancelMobileBuild kills the process and marks record cancelled', async () => {
    const child = makeChild()
    spawnMockFn.mockReturnValue(child)

    const { startBuildFromMobile, cancelMobileBuild } = await import('../build-handlers')
    const { buildId } = await startBuildFromMobile('build')

    const cancelled = cancelMobileBuild(buildId)

    expect(cancelled).toBe(true)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    const row = db.prepare('SELECT status FROM build_records WHERE id = ?').get(buildId) as { status: string }
    expect(row.status).toBe('cancelled')
  })
})
