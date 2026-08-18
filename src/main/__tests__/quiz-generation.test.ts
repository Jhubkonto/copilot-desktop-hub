import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QuizSpec } from '../../shared/types'

const { findArtifactMock, readVersionFileMock, transcriptMock } = vi.hoisted(() => ({
  findArtifactMock: vi.fn(),
  readVersionFileMock: vi.fn(),
  transcriptMock: vi.fn(),
}))

vi.mock('electron', () => ({ app: { isPackaged: false }, BrowserWindow: class {} }))
vi.mock('../database', () => ({ getDatabase: vi.fn() }))
vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))
vi.mock('../providers', () => ({
  DEFAULT_PROVIDER_MODEL: 'gpt-5-mini',
  NO_PROVIDER_CONFIGURED_MESSAGE: 'No provider configured.',
  getProviderForAgent: vi.fn(() => ({ provider: 'openai', model: 'gpt-4o' })),
  getApiKey: vi.fn(() => 'test-key'),
  getProviderCredential: vi.fn(() => 'test-key'),
  sendProviderNonStreaming: vi.fn(),
}))
vi.mock('../cli-adapters/claude', () => ({ ClaudeAdapter: { isAvailable: vi.fn(() => false) } }))
vi.mock('../activity-tracker', () => ({ startActivity: vi.fn(), endActivity: vi.fn() }))
vi.mock('../artifacts', () => ({
  createPendingArtifactForConversation: vi.fn(),
  findArtifactForConversation: findArtifactMock,
  markArtifactGenerationFailed: vi.fn(),
  readArtifactVersionFile: readVersionFileMock,
  writeArtifactVersionForConversation: vi.fn(),
}))
vi.mock('../debrief-handlers', () => ({
  buildConversationTranscript: transcriptMock,
}))

import { buildQuizSystemPrompt, buildQuizSourceContent } from '../quiz-handlers'

const fakeDb = {
  prepare: () => ({ get: () => undefined, all: () => [] }),
} as never

afterEach(() => {
  findArtifactMock.mockReset()
  readVersionFileMock.mockReset()
  transcriptMock.mockReset()
})

describe('buildQuizSystemPrompt', () => {
  it('defaults to 5-8 questions at medium difficulty with no focus', () => {
    const prompt = buildQuizSystemPrompt({})
    expect(prompt).toContain('5-8 objects')
    expect(prompt).toContain('Difficulty: medium')
    expect(prompt).not.toContain('FOCUS:')
  })

  it('honours an explicit count, difficulty, and topic', () => {
    const spec: QuizSpec = { questionCount: 10, difficulty: 'hard', topic: 'the IPC layer' }
    const prompt = buildQuizSystemPrompt(spec)
    expect(prompt).toContain('exactly 10 objects')
    expect(prompt).toContain('Difficulty: hard')
    expect(prompt).toContain('FOCUS:')
    expect(prompt).toContain('the IPC layer')
  })

  it('clamps an out-of-range count into the 3-12 band', () => {
    expect(buildQuizSystemPrompt({ questionCount: 99 })).toContain('exactly 12 objects')
    expect(buildQuizSystemPrompt({ questionCount: 1 })).toContain('exactly 3 objects')
  })

  it('adds a re-test instruction when focusQuestions are supplied', () => {
    const prompt = buildQuizSystemPrompt({ focusQuestions: ['What does safeHandle do?'] })
    expect(prompt).toContain('previously got these questions wrong')
    expect(prompt).toContain('What does safeHandle do?')
  })
})

describe('buildQuizSourceContent', () => {
  it('uses the raw conversation transcript by default and never touches a debrief', () => {
    transcriptMock.mockReturnValue('User: hi\n\nAssistant: hello')
    const { sourceLabel, content } = buildQuizSourceContent(fakeDb, 'conv-1', null, {})
    expect(sourceLabel).toBe('conversation')
    expect(content).toContain('User: hi')
    // Decoupled from debrief: the conversation path must not look one up.
    expect(findArtifactMock).not.toHaveBeenCalled()
  })

  it('uses an existing debrief when source is "debrief"', () => {
    findArtifactMock.mockReturnValue({ currentVersion: { id: 'v-debrief' } })
    readVersionFileMock.mockReturnValue(JSON.stringify({
      summary: 'Did a thing', commandsAndTools: ['git'], reproductionGuide: '1. run it', mentalModel: 'think first',
    }))
    const { sourceLabel, content } = buildQuizSourceContent(fakeDb, 'conv-1', null, { source: 'debrief' })
    expect(sourceLabel).toBe('debrief')
    expect(content).toContain('Did a thing')
    expect(transcriptMock).not.toHaveBeenCalled()
  })

  it('falls back to the transcript (never auto-generating) when source is "debrief" but none exists', () => {
    findArtifactMock.mockReturnValue(null)
    transcriptMock.mockReturnValue('User: q\n\nAssistant: a')
    const { sourceLabel, content } = buildQuizSourceContent(fakeDb, 'conv-1', null, { source: 'debrief' })
    expect(sourceLabel).toContain('no debrief found')
    expect(content).toContain('User: q')
  })

  it('throws a clear error when the conversation has no messages', () => {
    transcriptMock.mockReturnValue('')
    expect(() => buildQuizSourceContent(fakeDb, 'conv-empty', null, {})).toThrow(/no messages to quiz/)
  })
})
