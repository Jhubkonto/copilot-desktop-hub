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

vi.mock('../ws-server', () => ({
  broadcastToMobile: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/nexy-test' },
  BrowserWindow: { getAllWindows: () => [] },
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
  sendProviderNonStreaming: mockSendProviderNonStreaming,
}))

vi.mock('../cli-adapters/claude', () => ({
  ClaudeAdapter: { isAvailable: vi.fn().mockReturnValue(false) },
}))

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { registerQuizHandlers } from '../quiz-handlers'
import type { QuizArtifactResult } from '../../shared/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return await handler({}, ...args) as T
}

const DEBRIEF_JSON = JSON.stringify({
  summary: 'We learned git',
  commandsAndTools: ['git checkout'],
  reproductionGuide: '1. Clone repo',
  mentalModel: 'Branch early',
})

const VALID_QUESTION_JSON = JSON.stringify([
  {
    question: 'What command creates a new branch?',
    options: ['git branch new', 'git checkout -b new', 'git new branch', 'git create new'],
    correctIndex: 1,
    explanation: 'git checkout -b creates and switches to a new branch in one step.',
    category: 'command',
  },
  {
    question: 'What does HEAD refer to?',
    options: ['The first commit', 'The current branch tip', 'The main branch', 'A detached state'],
    correctIndex: 1,
    explanation: 'HEAD is a pointer to the currently checked-out commit or branch.',
    category: 'concept',
  },
])

describe('quiz-handlers', () => {
  beforeEach(async () => {
    state.handlers.clear()
    state.db?.close()
    state.db = new Database(':memory:')
    initializeBaseSchema(state.db)
    runMigrations(state.db)
    fsState.files.clear()
    registerQuizHandlers()
    const { registerDebriefHandlers } = await import('../debrief-handlers')
    registerDebriefHandlers()
    mockSendProviderNonStreaming.mockReset()

    state.db!.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('conv-1', 'Git Basics', 1, 1)").run()
    state.db!.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('m1', 'conv-1', 'user', 'How do branches work?', 1)").run()
    state.db!.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('m2', 'conv-1', 'assistant', 'Branches are refs...', 2)").run()

    // Seed an existing debrief artifact for 'conv-1' via the real debrief handler, so most
    // quiz tests don't also exercise the auto-debrief path (that's covered by its own test).
    mockSendProviderNonStreaming.mockResolvedValueOnce({ content: DEBRIEF_JSON })
    await invoke('conversation:generate-debrief', 'conv-1', null)
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  describe('conversation:generate-quiz', () => {
    it('returns valid questions from well-formed LLM JSON and persists a quiz artifact', async () => {
      mockSendProviderNonStreaming.mockResolvedValueOnce({ content: VALID_QUESTION_JSON })
      const result = await invoke<QuizArtifactResult>('conversation:generate-quiz', 'conv-1', null)
      expect(result.questions).toHaveLength(2)
      expect(result.questions[0]).toMatchObject({
        question: 'What command creates a new branch?',
        correctIndex: 1,
        category: 'command',
      })
      expect(typeof result.questions[0].id).toBe('string')
      expect(result.artifactId).toBeTruthy()
      expect(result.versionId).toBeTruthy()

      const artifactRow = state.db!.prepare('SELECT * FROM artifacts WHERE id = ?').get(result.artifactId) as { kind: string } | undefined
      expect(artifactRow?.kind).toBe('quiz')
      const chatRef = state.db!.prepare('SELECT * FROM artifact_chat_refs WHERE artifact_id = ?').get(result.artifactId) as { conversation_id: string } | undefined
      expect(chatRef?.conversation_id).toBe('conv-1')
    })

    it('re-running on the same conversation creates a second version under the same artifact', async () => {
      mockSendProviderNonStreaming.mockResolvedValueOnce({ content: VALID_QUESTION_JSON })
      const first = await invoke<QuizArtifactResult>('conversation:generate-quiz', 'conv-1', null)

      mockSendProviderNonStreaming.mockResolvedValueOnce({ content: VALID_QUESTION_JSON })
      const second = await invoke<QuizArtifactResult>('conversation:generate-quiz', 'conv-1', null)

      expect(second.artifactId).toBe(first.artifactId)
      expect(second.versionId).not.toBe(first.versionId)
      const versionCount = (state.db!.prepare('SELECT COUNT(*) as c FROM artifact_versions WHERE artifact_id = ?').get(first.artifactId) as { c: number }).c
      expect(versionCount).toBe(2)
    })

    it('throws for malformed JSON', async () => {
      mockSendProviderNonStreaming.mockResolvedValueOnce({ content: 'not json at all' })
      await expect(invoke('conversation:generate-quiz', 'conv-1', null)).rejects.toThrow('not valid JSON')
    })

    it('throws when fewer than 2 valid questions', async () => {
      const oneQuestion = JSON.stringify([
        {
          question: 'Single question',
          options: ['A', 'B', 'C', 'D'],
          correctIndex: 0,
          explanation: 'Because A.',
          category: 'concept',
        },
      ])
      mockSendProviderNonStreaming.mockResolvedValueOnce({ content: oneQuestion })
      await expect(invoke('conversation:generate-quiz', 'conv-1', null)).rejects.toThrow('only 1 were well-formed')
    })

    it('silently drops questions with invalid shape', async () => {
      const mixedJson = JSON.stringify([
        { question: 'Valid', options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: 'OK', category: 'concept' },
        { question: 'Also Valid', options: ['A', 'B', 'C', 'D'], correctIndex: 1, explanation: 'OK', category: 'command' },
        { question: 'Missing options' },
        { options: ['A', 'B', 'C', 'D'], correctIndex: 5 },
      ])
      mockSendProviderNonStreaming.mockResolvedValueOnce({ content: mixedJson })
      const result = await invoke<QuizArtifactResult>('conversation:generate-quiz', 'conv-1', null)
      expect(result.questions).toHaveLength(2)
    })

    it('strips markdown code fences before parsing', async () => {
      mockSendProviderNonStreaming.mockResolvedValueOnce({ content: '```json\n' + VALID_QUESTION_JSON + '\n```' })
      const result = await invoke<QuizArtifactResult>('conversation:generate-quiz', 'conv-1', null)
      expect(result.questions).toHaveLength(2)
    })

    it('transparently generates a debrief first when the conversation has none yet', async () => {
      state.db!.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('no-debrief', 'Fresh', 1, 1)").run()
      state.db!.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('m3', 'no-debrief', 'user', 'Hello', 1)").run()
      state.db!.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('m4', 'no-debrief', 'assistant', 'Hi', 2)").run()

      mockSendProviderNonStreaming.mockClear()
      mockSendProviderNonStreaming
        .mockResolvedValueOnce({ content: DEBRIEF_JSON })
        .mockResolvedValueOnce({ content: VALID_QUESTION_JSON })

      const result = await invoke<QuizArtifactResult>('conversation:generate-quiz', 'no-debrief', null)
      expect(result.questions).toHaveLength(2)
      expect(mockSendProviderNonStreaming).toHaveBeenCalledTimes(2)

      const debriefArtifact = state.db!.prepare(
        `SELECT a.* FROM artifacts a JOIN artifact_chat_refs r ON r.artifact_id = a.id WHERE r.conversation_id = ? AND a.kind = 'debrief'`
      ).get('no-debrief')
      expect(debriefArtifact).toBeTruthy()
    })
  })
})
