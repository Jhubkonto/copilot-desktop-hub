import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const { getDatabaseMock } = vi.hoisted(() => ({ getDatabaseMock: vi.fn() }))

vi.mock('electron', () => ({
  app: { setBadgeCount: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  nativeImage: { createFromDataURL: vi.fn(() => ({})) },
}))
vi.mock('../database', () => ({ getDatabase: getDatabaseMock }))

import {
  getUnseenActivityCount,
  getUnseenConversationIds,
  recordUnseenActivity,
  resetActivityBadgeForTests,
  setViewedConversation,
} from '../activity-badge'

let db: Database.Database

beforeEach(() => {
  resetActivityBadgeForTests()
  db = new Database(':memory:')
  initializeBaseSchema(db)
  runMigrations(db)
  getDatabaseMock.mockReturnValue(db)
})

afterEach(() => {
  db.close()
})

describe('desktop activity badges', () => {
  it('deduplicates completed activity by destination and clears it when viewed', () => {
    const activity = {
      id: 'chat:conversation-1',
      kind: 'chat' as const,
      label: 'Assistant is responding…',
      conversationId: 'conversation-1',
      startedAt: Date.now(),
    }

    recordUnseenActivity(activity)
    recordUnseenActivity(activity)

    expect(getUnseenActivityCount()).toBe(1)
    expect(getUnseenConversationIds()).toEqual(['conversation-1'])
    expect(setViewedConversation('conversation-1')).toBe(0)
    expect(getUnseenConversationIds()).toEqual([])
  })

  it('restores persisted unseen destinations after reinitialization', () => {
    recordUnseenActivity({
      id: 'build:1',
      kind: 'build',
      label: 'Build complete',
      startedAt: Date.now(),
    })
    resetActivityBadgeForTests()

    expect(getUnseenActivityCount()).toBe(1)
  })

  it('only exposes chat destinations to the conversation history', () => {
    recordUnseenActivity({
      id: 'build:1',
      kind: 'build',
      label: 'Build complete',
      startedAt: Date.now(),
    })

    expect(getUnseenConversationIds()).toEqual([])
  })
})
