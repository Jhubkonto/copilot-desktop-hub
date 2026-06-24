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
import type { QuizAttempt, QuizGenerationResult } from '../../shared/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return await handler({}, ...args) as T
}

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
  beforeEach(() => {
    state.handlers.clear()
    state.db?.close()
    state.db = new Database(':memory:')
    initializeBaseSchema(state.db)
    runMigrations(state.db)
    registerQuizHandlers()
    mockSendProviderNonStreaming.mockReset()

    // Insert a conversation with a debrief
    state.db!.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('conv-1', 'Git Basics', 1, 1)").run()
    state.db!.prepare(
      "INSERT INTO conversation_debriefs (id, conversation_id, project_id, summary, commands_tools, reproduction_guide, mental_model, generated_at, created_at) VALUES ('d-1', 'conv-1', NULL, 'We learned git', '[\"git checkout\"]', '1. Clone repo', 'Branch early', 1, 1)"
    ).run()
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  describe('conversation:generate-quiz', () => {
    it('returns valid questions from well-formed LLM JSON', async () => {
      mockSendProviderNonStreaming.mockResolvedValueOnce({ content: VALID_QUESTION_JSON })
      const result = await invoke<QuizGenerationResult>('conversation:generate-quiz', 'conv-1')
      expect(result.questions).toHaveLength(2)
      expect(result.questions[0]).toMatchObject({
        question: 'What command creates a new branch?',
        correctIndex: 1,
        category: 'command',
      })
      expect(typeof result.questions[0].id).toBe('string')
    })

    it('returns empty questions array for malformed JSON', async () => {
      mockSendProviderNonStreaming.mockResolvedValueOnce({ content: 'not json at all' })
      const result = await invoke<QuizGenerationResult>('conversation:generate-quiz', 'conv-1')
      expect(result.questions).toHaveLength(0)
    })

    it('returns empty questions array when fewer than 2 valid questions', async () => {
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
      const result = await invoke<QuizGenerationResult>('conversation:generate-quiz', 'conv-1')
      expect(result.questions).toHaveLength(0)
    })

    it('silently drops questions with invalid shape', async () => {
      const mixedJson = JSON.stringify([
        { question: 'Valid', options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: 'OK', category: 'concept' },
        { question: 'Also Valid', options: ['A', 'B', 'C', 'D'], correctIndex: 1, explanation: 'OK', category: 'command' },
        { question: 'Missing options' },
        { options: ['A', 'B', 'C', 'D'], correctIndex: 5 },
      ])
      mockSendProviderNonStreaming.mockResolvedValueOnce({ content: mixedJson })
      const result = await invoke<QuizGenerationResult>('conversation:generate-quiz', 'conv-1')
      expect(result.questions).toHaveLength(2)
    })

    it('strips markdown code fences before parsing', async () => {
      mockSendProviderNonStreaming.mockResolvedValueOnce({ content: '```json\n' + VALID_QUESTION_JSON + '\n```' })
      const result = await invoke<QuizGenerationResult>('conversation:generate-quiz', 'conv-1')
      expect(result.questions).toHaveLength(2)
    })

    it('throws when no debrief exists for the conversation', async () => {
      state.db!.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('no-debrief', 'Empty', 1, 1)").run()
      await expect(invoke('conversation:generate-quiz', 'no-debrief')).rejects.toThrow('No debrief found')
    })
  })

  describe('conversation:save-quiz-attempt', () => {
    it('inserts a row and returns the attempt', async () => {
      const attempt = await invoke<QuizAttempt>('conversation:save-quiz-attempt', 'conv-1', 4, 5)
      expect(attempt.conversation_id).toBe('conv-1')
      expect(attempt.score).toBe(4)
      expect(attempt.total).toBe(5)
      expect(typeof attempt.id).toBe('string')
      expect(attempt.attempted_at).toBeGreaterThan(0)

      const row = state.db!.prepare('SELECT * FROM conversation_quiz_attempts WHERE id = ?').get(attempt.id)
      expect(row).not.toBeNull()
    })
  })

  describe('conversation:list-quiz-attempts', () => {
    it('returns empty array when no attempts', async () => {
      const result = await invoke<QuizAttempt[]>('conversation:list-quiz-attempts', 'conv-1')
      expect(result).toEqual([])
    })

    it('returns attempts ordered newest-first', async () => {
      state.db!.prepare("INSERT INTO conversation_quiz_attempts (id, conversation_id, score, total, attempted_at) VALUES ('a1', 'conv-1', 3, 5, 1000)").run()
      state.db!.prepare("INSERT INTO conversation_quiz_attempts (id, conversation_id, score, total, attempted_at) VALUES ('a2', 'conv-1', 4, 5, 2000)").run()
      state.db!.prepare("INSERT INTO conversation_quiz_attempts (id, conversation_id, score, total, attempted_at) VALUES ('a3', 'conv-1', 5, 5, 3000)").run()

      const result = await invoke<QuizAttempt[]>('conversation:list-quiz-attempts', 'conv-1')
      expect(result).toHaveLength(3)
      expect(result[0].id).toBe('a3')
      expect(result[1].id).toBe('a2')
      expect(result[2].id).toBe('a1')
    })
  })
})
