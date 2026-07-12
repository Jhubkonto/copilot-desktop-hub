import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}))

vi.mock('../database', () => ({
  getDatabase: () => {
    if (!state.db) throw new Error('Database not initialized')
    return state.db
  },
}))

vi.mock('../safe-handle', () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    state.handlers.set(channel, handler)
  },
}))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))
vi.mock('../ws-server', () => ({ broadcastToMobile: vi.fn() }))
vi.mock('../project-handlers', () => ({
  parseProjectConfig: vi.fn(() => ({ workflowMode: 'single-agent' })),
}))

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { registerConversationHandlers } from '../conversation-handlers'
import { submitRatingForConversation } from '../rating-handlers'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return (await handler({}, ...args)) as T
}

describe('conversation:list — rating column', () => {
  beforeEach(() => {
    state.handlers.clear()
    state.db?.close()
    state.db = new Database(':memory:')
    initializeBaseSchema(state.db)
    runMigrations(state.db)
    registerConversationHandlers()
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  it('left-joins the rating in, defaulting to null when unrated', async () => {
    const db = state.db!
    db.prepare("INSERT INTO conversations (id, title) VALUES ('conv-1', 'Rated')").run()
    db.prepare("INSERT INTO conversations (id, title) VALUES ('conv-2', 'Unrated')").run()
    submitRatingForConversation('conv-1', 4)

    const list = await invoke<{ id: string; rating: number | null }[]>('conversation:list')
    const byId = Object.fromEntries(list.map((c) => [c.id, c.rating]))

    expect(byId['conv-1']).toBe(4)
    expect(byId['conv-2']).toBeNull()
  })
})
