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
  getNewContentConversations,
  markAllConversationsRead,
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

  it('returns unread summaries newest first and marks every chat read', () => {
    db.prepare("INSERT INTO projects (id, name) VALUES ('project-1', 'Launch')").run()
    db.prepare("INSERT INTO agents (id, config_json) VALUES ('agent-1', '{\"name\":\"Ada\"}')").run()
    db.prepare(`INSERT INTO conversations
      (id, agent_id, project_id, title, created_at, updated_at)
      VALUES ('conversation-1', 'agent-1', 'project-1', 'Ship it', 100, 200)`).run()
    db.prepare(`INSERT INTO messages (id, conversation_id, role, content, timestamp)
      VALUES ('message-1', 'conversation-1', 'assistant', 'The release is ready.', 200)`).run()

    recordUnseenActivity({
      id: 'chat:conversation-1',
      kind: 'chat',
      label: 'Assistant is responding…',
      conversationId: 'conversation-1',
      startedAt: 100,
    })

    expect(getNewContentConversations()).toEqual([expect.objectContaining({
      conversationId: 'conversation-1',
      title: 'Ship it',
      projectName: 'Launch',
      agentName: 'Ada',
      preview: 'The release is ready.',
      newContentAt: 200,
    })])
    expect(markAllConversationsRead()).toBe(0)
    expect(getNewContentConversations()).toEqual([])
  })
})
