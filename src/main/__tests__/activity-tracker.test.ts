import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const { getDatabaseMock } = vi.hoisted(() => ({ getDatabaseMock: vi.fn() }))

vi.mock('electron', () => ({
  app: { setBadgeCount: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  nativeImage: { createFromDataURL: vi.fn(() => ({})) },
  Notification: { isSupported: vi.fn(() => false) },
}))
vi.mock('../database', () => ({ getDatabase: getDatabaseMock }))
vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))
vi.mock('../ws-server', () => ({ broadcastToMobile: vi.fn() }))

import { endActivity, getActivitySnapshot, startActivity } from '../activity-tracker'
import { resetActivityBadgeForTests } from '../activity-badge'

let db: Database.Database

beforeEach(() => {
  resetActivityBadgeForTests()
  db = new Database(':memory:')
  initializeBaseSchema(db)
  runMigrations(db)
  getDatabaseMock.mockReturnValue(db)
})

afterEach(() => {
  getActivitySnapshot().forEach((activity) => endActivity(activity.id))
  db.close()
})

describe('activity display context', () => {
  it('resolves chat, project, and agent names from a conversation id', () => {
    db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run('project-1', 'Nexy Development')
    db.prepare('INSERT INTO agents (id, config_json) VALUES (?, ?)').run(
      'agent-1',
      JSON.stringify({ name: 'Lead Architect' }),
    )
    db.prepare(
      'INSERT INTO conversations (id, agent_id, project_id, title) VALUES (?, ?, ?, ?)',
    ).run('conversation-1', 'agent-1', 'project-1', 'Clarify activity feed')

    startActivity({
      id: 'chat:conversation-1',
      kind: 'chat',
      label: 'Assistant is responding…',
      conversationId: 'conversation-1',
    })

    expect(getActivitySnapshot()).toEqual([
      expect.objectContaining({
        projectId: 'project-1',
        projectName: 'Nexy Development',
        conversationTitle: 'Clarify activity feed',
        agentId: 'agent-1',
        agentName: 'Lead Architect',
      }),
    ])
  })

  it('resolves a project name for non-chat project activity', () => {
    db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run('project-2', 'Android Companion')

    startActivity({
      id: 'workflow:project-2',
      kind: 'automated-workflow-generator',
      label: 'Generating workflow…',
      projectId: 'project-2',
    })

    expect(getActivitySnapshot()[0]?.projectName).toBe('Android Companion')
  })
})
