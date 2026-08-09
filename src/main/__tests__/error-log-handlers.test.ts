import { EventEmitter } from 'events'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const { safeHandlers, mockLogPath } = vi.hoisted(() => ({
  safeHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  mockLogPath: { value: 'C:\\tmp\\nexy-main.log' },
}))

vi.mock('../safe-handle', () => ({
  safeHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    safeHandlers.set(channel, handler)
  }),
}))

vi.mock('electron-log/main', () => ({
  default: {
    transports: {
      file: {
        getFile: () => ({ path: mockLogPath.value }),
      },
    },
  },
}))

let db: Database.Database

vi.mock('../database', () => ({
  getDatabase: () => db,
}))

function createDatabase() {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  initializeBaseSchema(database)
  runMigrations(database)
  return database
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = safeHandlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return handler({}, ...args) as T
}

describe('error log handlers', () => {
  beforeEach(() => {
    safeHandlers.clear()
    vi.resetModules()
    db = createDatabase()
  })

  afterEach(() => {
    db.close()
  })

  it('persists entries and returns recent entries oldest first', async () => {
    const { recordErrorLogEntry, registerErrorLogHandlers } = await import('../error-log-handlers')
    registerErrorLogHandlers()

    recordErrorLogEntry({ source: 'main', level: 'error', message: 'first', timestamp: 10 })
    recordErrorLogEntry({ source: 'renderer', level: 'warn', message: 'second', stack: 'app.ts:1', timestamp: 20 })

    const entries = await invoke<unknown[]>('errors:get-recent', 10)

    expect(entries).toEqual([
      expect.objectContaining({ source: 'main', level: 'error', message: 'first', timestamp: 10 }),
      expect.objectContaining({ source: 'renderer', level: 'warn', message: 'second', stack: 'app.ts:1', timestamp: 20 }),
    ])
  })

  it('captures renderer console warnings and broadcasts live entries', async () => {
    const { initErrorLogCapture } = await import('../error-log-handlers')
    const webContents = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> }
    webContents.send = vi.fn()
    const win = {
      isDestroyed: () => false,
      webContents,
    }

    initErrorLogCapture(win as never)
    webContents.emit('console-message', {}, 2, 'renderer warning', 7, 'app.js')

    const row = db.prepare('SELECT * FROM error_log').get() as Record<string, unknown>
    expect(row).toEqual(expect.objectContaining({
      source: 'renderer',
      level: 'warn',
      message: 'renderer warning',
      stack: 'app.js:7',
    }))
    expect(webContents.send).toHaveBeenCalledWith('errors:new', expect.objectContaining({
      source: 'renderer',
      level: 'warn',
      message: 'renderer warning',
    }))
  })

  it('prunes entries older than the one-week retention window', async () => {
    const { recordErrorLogEntry, pruneErrorLog } = await import('../error-log-handlers')
    const now = 30 * 24 * 60 * 60 * 1000
    const weekMs = 7 * 24 * 60 * 60 * 1000
    recordErrorLogEntry({ source: 'main', level: 'info', message: 'stale', timestamp: now - weekMs - 1 })
    recordErrorLogEntry({ source: 'main', level: 'info', message: 'fresh', timestamp: now - 1000 })

    const deleted = pruneErrorLog(now)

    expect(deleted).toBe(1)
    const rows = db.prepare('SELECT message FROM error_log').all() as { message: string }[]
    expect(rows).toEqual([{ message: 'fresh' }])
  })

  it('sweeps expired entries when error-log capture initializes', async () => {
    const { recordErrorLogEntry, initErrorLogCapture } = await import('../error-log-handlers')
    const staleTs = Date.now() - (8 * 24 * 60 * 60 * 1000)
    recordErrorLogEntry({ source: 'main', level: 'info', message: 'ancient', timestamp: staleTs })
    const webContents = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> }
    webContents.send = vi.fn()

    initErrorLogCapture({ isDestroyed: () => false, webContents } as never)

    expect(db.prepare('SELECT COUNT(*) AS count FROM error_log').get()).toEqual({ count: 0 })
  })

  it('clears persisted and renderer-buffer entries', async () => {
    const { initErrorLogCapture, registerErrorLogHandlers } = await import('../error-log-handlers')
    const webContents = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> }
    webContents.send = vi.fn()
    registerErrorLogHandlers()
    initErrorLogCapture({ isDestroyed: () => false, webContents } as never)
    webContents.emit('console-message', {}, 3, 'renderer error', 9, 'app.js')

    expect(await invoke<unknown[]>('errors:get-renderer-console')).toHaveLength(1)
    await invoke<boolean>('errors:clear')

    expect(db.prepare('SELECT COUNT(*) AS count FROM error_log').get()).toEqual({ count: 0 })
    expect(await invoke<unknown[]>('errors:get-renderer-console')).toEqual([])
  })
})
