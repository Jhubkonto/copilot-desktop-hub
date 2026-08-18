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
  app: { getPath: () => '/tmp/nexy-test' },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      { isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } },
    ]),
  },
}))

// In-memory fake filesystem so artifact writes/reads round-trip within a test without
// touching the real disk.
const fsState = vi.hoisted(() => ({ files: new Map<string, string>() }))
vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  statSync: vi.fn((p: string) => ({ size: (fsState.files.get(p) ?? '').length })),
  writeFileSync: vi.fn((p: string, content: string) => { fsState.files.set(p, content) }),
  readFileSync: vi.fn((p: string) => {
    const content = fsState.files.get(p)
    if (content === undefined) throw new Error(`ENOENT: no such file: ${p}`)
    return content
  }),
}))

const mockSendProviderNonStreaming = vi.hoisted(() => vi.fn())
vi.mock('../providers', () => ({
  DEFAULT_PROVIDER_MODEL: 'claude-sonnet-4-6',
  NO_PROVIDER_CONFIGURED_MESSAGE: 'No provider configured',
  getProviderForAgent: vi.fn().mockReturnValue({ provider: 'anthropic', model: 'claude-sonnet-4-6' }),
  getApiKey: vi.fn().mockReturnValue('test-api-key'),
  getProviderCredential: vi.fn().mockReturnValue('test-api-key'),
  sendProviderNonStreaming: mockSendProviderNonStreaming,
}))

vi.mock('../cli-adapters/claude', () => ({
  ClaudeAdapter: { isAvailable: vi.fn().mockReturnValue(false) },
}))

vi.mock('../ws-server', () => ({
  broadcastToMobile: vi.fn(),
  isMobileInForeground: vi.fn().mockReturnValue(false),
}))

vi.mock('../fcm-sender', () => ({
  sendDebriefCompleteNotification: vi.fn(),
}))

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { registerDebriefHandlers } from '../debrief-handlers'
import type { DebriefArtifactResult } from '../../shared/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return await handler({}, ...args) as T
}

describe('debrief-handlers', () => {
  beforeEach(() => {
    state.handlers.clear()
    state.db?.close()
    state.db = new Database(':memory:')
    initializeBaseSchema(state.db)
    runMigrations(state.db)
    fsState.files.clear()
    registerDebriefHandlers()
    mockSendProviderNonStreaming.mockReset()
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  it('adds completed_at column to conversations via migrations', () => {
    const columns = (state.db!.prepare('PRAGMA table_info(conversations)').all() as { name: string }[]).map(r => r.name)
    expect(columns).toContain('completed_at')
  })

  describe('conversation:mark-complete', () => {
    it('sets completed_at on a conversation', async () => {
      state.db!.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('conv-1', 'Test', 1, 1)").run()
      const result = await invoke<boolean>('conversation:mark-complete', 'conv-1')
      expect(result).toBe(true)
      const row = state.db!.prepare('SELECT completed_at FROM conversations WHERE id = ?').get('conv-1') as { completed_at: number }
      expect(row.completed_at).toBeGreaterThan(0)
    })

    it('returns false for unknown conversation', async () => {
      const result = await invoke<boolean>('conversation:mark-complete', 'nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('conversation:get-debrief', () => {
    it('returns null for a conversation with no debrief', async () => {
      const result = await invoke<DebriefArtifactResult | null>('conversation:get-debrief', 'conv-1')
      expect(result).toBeNull()
    })

    it('returns a debrief after it has been created', async () => {
      state.db!.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('conv-1', 'Test', 1, 1)").run()
      state.db!.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('m1', 'conv-1', 'user', 'Hello', 1)").run()
      state.db!.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('m2', 'conv-1', 'assistant', 'Hi', 2)").run()
      mockSendProviderNonStreaming.mockResolvedValueOnce({
        content: JSON.stringify({ summary: 'Summary', commandsAndTools: [], reproductionGuide: 'Guide', mentalModel: 'Model' }),
      })
      await invoke('conversation:generate-debrief', 'conv-1', null)

      const result = await invoke<DebriefArtifactResult | null>('conversation:get-debrief', 'conv-1')
      expect(result).not.toBeNull()
      expect(result!.debrief.summary).toBe('Summary')
      expect(result!.debrief.commandsTools).toEqual([])
    })
  })

  describe('conversation:generate-debrief', () => {
    beforeEach(() => {
      state.db!.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('conv-1', 'Test', 1, 1)").run()
      state.db!.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('m1', 'conv-1', 'user', 'Hello', 1)").run()
      state.db!.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('m2', 'conv-1', 'assistant', 'Hi', 2)").run()
    })

    it('generates and persists a debrief artifact with valid LLM JSON', async () => {
      mockSendProviderNonStreaming.mockResolvedValueOnce({
        content: JSON.stringify({
          summary: 'We said hello',
          commandsAndTools: ['greet'],
          reproductionGuide: '1. Say hello',
          mentalModel: 'Simple greeting exchange',
        }),
      })

      const result = await invoke<DebriefArtifactResult>('conversation:generate-debrief', 'conv-1', null)

      expect(result.debrief.summary).toBe('We said hello')
      expect(result.debrief.commandsTools).toEqual(['greet'])
      expect(result.debrief.reproductionGuide).toBe('1. Say hello')
      expect(result.debrief.mentalModel).toBe('Simple greeting exchange')
      expect(result.debrief.conversationId).toBe('conv-1')
      expect(result.artifactId).toBeTruthy()
      expect(result.versionId).toBeTruthy()

      const artifactRow = state.db!.prepare('SELECT * FROM artifacts WHERE id = ?').get(result.artifactId) as { kind: string } | undefined
      expect(artifactRow?.kind).toBe('debrief')

      // Confirm it was persisted and readable back
      const fetched = await invoke<DebriefArtifactResult | null>('conversation:get-debrief', 'conv-1')
      expect(fetched).not.toBeNull()
      expect(fetched!.debrief.summary).toBe('We said hello')
    })

    it('throws when LLM returns malformed JSON', async () => {
      mockSendProviderNonStreaming.mockResolvedValueOnce({ content: 'not json' })
      await expect(invoke('conversation:generate-debrief', 'conv-1', null)).rejects.toThrow()
    })

    it('throws when conversation has no messages', async () => {
      state.db!.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('empty-conv', 'Empty', 1, 1)").run()
      await expect(invoke('conversation:generate-debrief', 'empty-conv', null)).rejects.toThrow('no messages')
    })

    it('re-running creates a new version under the same artifact rather than replacing it', async () => {
      mockSendProviderNonStreaming.mockResolvedValueOnce({
        content: JSON.stringify({ summary: 'First', commandsAndTools: [], reproductionGuide: 'Step 1', mentalModel: 'A' }),
      })
      const first = await invoke<DebriefArtifactResult>('conversation:generate-debrief', 'conv-1', null)

      mockSendProviderNonStreaming.mockResolvedValueOnce({
        content: JSON.stringify({ summary: 'Second', commandsAndTools: [], reproductionGuide: 'Step 2', mentalModel: 'B' }),
      })
      const second = await invoke<DebriefArtifactResult>('conversation:generate-debrief', 'conv-1', null)

      expect(second.artifactId).toBe(first.artifactId)
      expect(second.versionId).not.toBe(first.versionId)
      const versionCount = (state.db!.prepare('SELECT COUNT(*) as c FROM artifact_versions WHERE artifact_id = ?').get(first.artifactId) as { c: number }).c
      expect(versionCount).toBe(2)

      const fetched = await invoke<DebriefArtifactResult | null>('conversation:get-debrief', 'conv-1')
      expect(fetched!.debrief.summary).toBe('Second')
    })
  })
})
