import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const { getDatabaseMock } = vi.hoisted(() => ({ getDatabaseMock: vi.fn() }))

vi.mock('electron', () => ({ app: { isPackaged: false }, BrowserWindow: class {} }))
vi.mock('../database', () => ({ getDatabase: getDatabaseMock }))
vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))
vi.mock('../providers', () => ({
  DEFAULT_PROVIDER_MODEL: 'gpt-5-mini',
  NO_PROVIDER_CONFIGURED_MESSAGE: 'No provider configured.',
  getProviderForAgent: vi.fn(() => ({ provider: 'openai', model: 'gpt-4o' })),
  getApiKey: vi.fn(() => 'test-key'),
  sendProviderNonStreaming: vi.fn(),
}))
vi.mock('../cli-adapters/claude', () => ({ ClaudeAdapter: { isAvailable: vi.fn(() => false) } }))
vi.mock('../activity-tracker', () => ({ startActivity: vi.fn(), endActivity: vi.fn() }))
vi.mock('../artifacts', () => ({
  createPendingArtifactForConversation: vi.fn(),
  findArtifactForConversation: vi.fn(),
  markArtifactGenerationFailed: vi.fn(),
  readArtifactVersionFile: vi.fn(),
  writeArtifactVersionForConversation: vi.fn(),
}))
vi.mock('../debrief-handlers', () => ({ buildConversationTranscript: vi.fn() }))

import { recordQuizAttempt, getQuizAttempts } from '../quiz-handlers'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initializeBaseSchema(db)
  runMigrations(db)
  getDatabaseMock.mockReturnValue(db)
})

afterEach(() => {
  db.close()
})

describe('quiz attempts persistence', () => {
  it('creates the quiz_attempts table via migration', () => {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='quiz_attempts'").get()
    expect(table).toBeTruthy()
  })

  it('records an attempt and reads it back with parsed JSON fields', () => {
    const saved = recordQuizAttempt({
      artifactId: 'art-1',
      versionId: 'ver-1',
      conversationId: 'conv-1',
      projectId: null,
      score: 3,
      total: 5,
      categoryBreakdown: { concept: { correct: 2, total: 3 }, command: { correct: 1, total: 2 } },
      missedQuestions: ['What does safeHandle validate?', 'Which pragma tracks schema version?'],
    })

    expect(saved.id).toBeTruthy()
    expect(saved.attemptedAt).toBeGreaterThan(0)

    const attempts = getQuizAttempts('art-1')
    expect(attempts).toHaveLength(1)
    expect(attempts[0].score).toBe(3)
    expect(attempts[0].total).toBe(5)
    expect(attempts[0].categoryBreakdown.concept).toEqual({ correct: 2, total: 3 })
    expect(attempts[0].missedQuestions).toEqual(['What does safeHandle validate?', 'Which pragma tracks schema version?'])
  })

  it('returns attempts for an artifact newest-first and isolates by artifact id', () => {
    recordQuizAttempt({ artifactId: 'art-1', versionId: 'v1', score: 1, total: 5, categoryBreakdown: {}, missedQuestions: [] })
    recordQuizAttempt({ artifactId: 'art-1', versionId: 'v1', score: 4, total: 5, categoryBreakdown: {}, missedQuestions: [] })
    recordQuizAttempt({ artifactId: 'art-2', versionId: 'v9', score: 5, total: 5, categoryBreakdown: {}, missedQuestions: [] })

    const art1 = getQuizAttempts('art-1')
    expect(art1).toHaveLength(2)
    expect(art1[0].attemptedAt).toBeGreaterThanOrEqual(art1[1].attemptedAt)
    expect(getQuizAttempts('art-2')).toHaveLength(1)
    expect(getQuizAttempts('missing')).toHaveLength(0)
  })
})
