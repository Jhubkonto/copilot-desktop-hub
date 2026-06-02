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

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { computeBodyOverlap, findFuzzyMatch, registerWikiHandlers } from '../wiki-handlers'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return await handler({}, ...args) as T
}

describe('wiki handlers', () => {
  beforeEach(() => {
    state.handlers.clear()
    state.db?.close()
    state.db = new Database(':memory:')
    initializeBaseSchema(state.db)
    runMigrations(state.db)
    registerWikiHandlers()
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  it('computes word overlap', () => {
    expect(computeBodyOverlap('Alpha beta gamma', 'Alpha beta delta')).toBeGreaterThan(0)
  })

  it('finds fuzzy title matches', () => {
    expect(findFuzzyMatch('Caching strategy notes', [{ id: '1', title: 'Project caching strategy' }])).toEqual({ id: '1', title: 'Project caching strategy' })
  })

  it('creates and lists wiki entries', async () => {
    const entry = await invoke<{ id: string; title: string }>('wiki:create-entry', 'project-1', 'Testing', 'Body', ['tag'])
    const entries = await invoke<Array<{ id: string; title: string }>>('wiki:list-entries', 'project-1')

    expect(entry.id).toBeTruthy()
    expect(entries).toEqual([expect.objectContaining({ title: 'Testing' })])
  })
})
