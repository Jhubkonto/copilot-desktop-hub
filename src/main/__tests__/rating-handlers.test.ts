import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  broadcastToMobile: vi.fn(),
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
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } }]),
  },
}))

vi.mock('../ws-server', () => ({ broadcastToMobile: state.broadcastToMobile }))

vi.mock('../project-handlers', () => ({
  parseProjectConfig: vi.fn((configJson: string | null) => {
    const raw = configJson ? (JSON.parse(configJson) as Record<string, unknown>) : {}
    return { workflowMode: (raw.workflowMode as string) ?? 'single-agent' }
  }),
}))

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import {
  registerRatingHandlers,
  submitRatingForConversation,
  getRatingForConversation,
  deleteRatingForConversation,
  listRatings,
  getRatingStats,
} from '../rating-handlers'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return (await handler({}, ...args)) as T
}

describe('rating-handlers', () => {
  beforeEach(() => {
    state.handlers.clear()
    state.broadcastToMobile.mockClear()
    state.db?.close()
    state.db = new Database(':memory:')
    initializeBaseSchema(state.db)
    runMigrations(state.db)
    registerRatingHandlers()
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  function seedConversation(overrides: Partial<{ agentId: string | null; model: string | null; projectId: string | null }> = {}) {
    const db = state.db!
    db.prepare("INSERT INTO agents (id, config_json) VALUES ('agent-1', '{\"name\":\"Research Agent\"}')").run()
    db.prepare("INSERT INTO skills (id, config_json) VALUES ('skill-1', '{\"name\":\"Deep Research\"}')").run()
    if (overrides.projectId) {
      db.prepare('INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)').run(overrides.projectId, 'Test Project')
    }
    db.prepare(
      `INSERT INTO conversations (id, agent_id, model, project_id, title) VALUES ('conv-1', ?, ?, ?, 'Investigate the flaky login bug')`,
    ).run(overrides.agentId ?? 'agent-1', overrides.model ?? 'claude-sonnet-4-6', overrides.projectId ?? null)
    db.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('m-1', 'conv-1', 'user', 'Please investigate the flaky login bug on staging', 1)",
    ).run()
    db.prepare(
      "INSERT INTO conversation_tool_calls (id, conversation_id, tool_name, server_name, success, created_at) VALUES ('tc-1', 'conv-1', 'search_project_wiki', 'Project Wiki', 1, 1)",
    ).run()
    db.prepare(
      "INSERT INTO conversation_skill_invocations (id, conversation_id, skill_id, agent_id, created_at) VALUES ('si-1', 'conv-1', 'skill-1', 'agent-1', 1)",
    ).run()
  }

  describe('submitRatingForConversation', () => {
    it('rejects out-of-range ratings', () => {
      seedConversation()
      expect(() => submitRatingForConversation('conv-1', 0)).toThrow()
      expect(() => submitRatingForConversation('conv-1', 6)).toThrow()
      expect(() => submitRatingForConversation('conv-1', 3.5)).toThrow()
    })

    it('builds a frozen snapshot from tool calls, skills, agent, and model', () => {
      seedConversation()
      const result = submitRatingForConversation('conv-1', 5, 'Nailed it')

      expect(result.rating).toBe(5)
      expect(result.note).toBe('Nailed it')
      expect(result.snapshot).toMatchObject({
        agentId: 'agent-1',
        agentName: 'Research Agent',
        model: 'claude-sonnet-4-6',
        projectId: null,
        toolNames: ['search_project_wiki'],
        serverNames: ['Project Wiki'],
        skillIds: ['skill-1'],
        skillNames: ['Deep Research'],
      })
      expect(result.snapshot.keywords).toEqual(expect.arrayContaining(['investigate', 'flaky', 'login', 'staging']))
      expect(state.broadcastToMobile).toHaveBeenCalledWith({
        event: 'rating:updated',
        data: { conversationId: 'conv-1', rating: result },
      })
    })

    it('overwrites rather than duplicating on re-rate', () => {
      seedConversation()
      const first = submitRatingForConversation('conv-1', 2, 'meh')
      const second = submitRatingForConversation('conv-1', 5, 'actually great')

      expect(second.id).toBe(first.id)
      expect(second.createdAt).toBe(first.createdAt)
      expect(second.rating).toBe(5)

      const count = state.db!
        .prepare('SELECT COUNT(*) as count FROM conversation_ratings WHERE conversation_id = ?')
        .get('conv-1') as { count: number }
      expect(count.count).toBe(1)
    })

    it('keeps a readable denormalized snapshot after the source agent and skill are deleted', () => {
      seedConversation()
      const result = submitRatingForConversation('conv-1', 4)
      state.db!.prepare("DELETE FROM agents WHERE id = 'agent-1'").run()
      state.db!.prepare("DELETE FROM skills WHERE id = 'skill-1'").run()

      const reloaded = getRatingForConversation('conv-1')
      expect(reloaded).not.toBeNull()
      expect(reloaded!.snapshot.agentName).toBe('Research Agent')
      expect(reloaded!.snapshot.skillNames).toEqual(['Deep Research'])
      expect(reloaded!.id).toBe(result.id)
    })
  })

  describe('getRatingForConversation / deleteRatingForConversation', () => {
    it('returns null when no rating exists', () => {
      seedConversation()
      expect(getRatingForConversation('conv-1')).toBeNull()
    })

    it('round-trips submit then fetch', () => {
      seedConversation()
      submitRatingForConversation('conv-1', 3)
      const fetched = getRatingForConversation('conv-1')
      expect(fetched?.rating).toBe(3)
    })

    it('deletes a rating and reports success/failure correctly', () => {
      seedConversation()
      expect(deleteRatingForConversation('conv-1')).toBe(false)
      submitRatingForConversation('conv-1', 3)
      expect(deleteRatingForConversation('conv-1')).toBe(true)
      expect(getRatingForConversation('conv-1')).toBeNull()
      expect(state.broadcastToMobile).toHaveBeenCalledWith({
        event: 'rating:updated',
        data: { conversationId: 'conv-1', rating: null },
      })
    })
  })

  describe('IPC registration', () => {
    it('round-trips rating:submit / rating:get / rating:delete through the registered handlers', async () => {
      seedConversation()
      const submitted = await invoke<{ rating: number }>('rating:submit', 'conv-1', 4, 'good session')
      expect(submitted.rating).toBe(4)

      const fetched = await invoke<{ rating: number } | null>('rating:get', 'conv-1')
      expect(fetched?.rating).toBe(4)

      const deleted = await invoke<boolean>('rating:delete', 'conv-1')
      expect(deleted).toBe(true)
    })

    it('serves rating:list and rating:get-stats through the registered handlers', async () => {
      seedConversation({ projectId: 'proj-1' })
      await invoke('rating:submit', 'conv-1', 4)

      const list = await invoke<{ conversationId: string }[]>('rating:list')
      expect(list).toHaveLength(1)
      expect(list[0].conversationId).toBe('conv-1')

      const stats = await invoke<{ averageByAgent: { label: string; average: number }[] }>('rating:get-stats')
      expect(stats.averageByAgent).toEqual([{ label: 'Research Agent', average: 4, count: 1 }])
    })
  })

  describe('listRatings', () => {
    it('returns a denormalized row per rated conversation, most recently updated first', () => {
      seedConversation({ projectId: 'proj-1' })
      submitRatingForConversation('conv-1', 5, 'great')

      const list = listRatings()
      expect(list).toEqual([
        expect.objectContaining({
          conversationId: 'conv-1',
          conversationTitle: 'Investigate the flaky login bug',
          projectId: 'proj-1',
          projectName: 'Test Project',
          rating: 5,
          note: 'great',
          agentName: 'Research Agent',
          model: 'claude-sonnet-4-6',
          toolNames: ['search_project_wiki'],
          skillNames: ['Deep Research'],
        }),
      ])
    })
  })

  describe('getRatingStats', () => {
    it('averages ratings per agent/model/skill/server/project and builds a daily trend', () => {
      const db = state.db!
      seedConversation({ projectId: 'proj-1' })
      submitRatingForConversation('conv-1', 4)

      db.prepare("INSERT INTO agents (id, config_json) VALUES ('agent-2', '{\"name\":\"Fixer Agent\"}')").run()
      db.prepare(
        "INSERT INTO conversations (id, agent_id, model, project_id, title) VALUES ('conv-2', 'agent-2', 'gpt-5', 'proj-1', 'Fix the build')",
      ).run()
      submitRatingForConversation('conv-2', 2)

      const stats = getRatingStats()
      expect(stats.averageByAgent).toEqual(
        expect.arrayContaining([
          { label: 'Research Agent', average: 4, count: 1 },
          { label: 'Fixer Agent', average: 2, count: 1 },
        ]),
      )
      expect(stats.averageByProject).toEqual([{ label: 'Test Project', average: 3, count: 2 }])
      expect(stats.trend).toHaveLength(1)
      expect(stats.trend[0].count).toBe(2)
      expect(stats.trend[0].average).toBe(3)
    })
  })
})
