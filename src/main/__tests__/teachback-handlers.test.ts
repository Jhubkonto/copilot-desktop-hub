import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  getDatabaseMock,
  findArtifactMock,
  readVersionFileMock,
  transcriptMock,
  sendProviderMock,
} = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
  findArtifactMock: vi.fn(),
  readVersionFileMock: vi.fn(),
  transcriptMock: vi.fn(),
  sendProviderMock: vi.fn(),
}))

vi.mock('electron', () => ({ app: { isPackaged: false }, BrowserWindow: class {} }))
vi.mock('../database', () => ({ getDatabase: getDatabaseMock }))
vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))
vi.mock('../providers', () => ({
  DEFAULT_PROVIDER_MODEL: 'gpt-5-mini',
  NO_PROVIDER_CONFIGURED_MESSAGE: 'No provider configured.',
  getProviderForAgent: vi.fn((model: string) => ({ provider: 'openai', model })),
  getApiKey: vi.fn(() => 'test-key'),
  getProviderCredential: vi.fn(() => 'test-key'),
  sendProviderNonStreaming: sendProviderMock,
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

import { buildTeachbackSourceContent, gradeTeachbackForWs } from '../teachback-handlers'

afterEach(() => {
  vi.clearAllMocks()
})

describe('buildTeachbackSourceContent', () => {
  const db = {} as never

  it('prefers an existing debrief mental model', () => {
    findArtifactMock.mockReturnValue({ currentVersion: { id: 'debrief-v1' } })
    readVersionFileMock.mockReturnValue(JSON.stringify({
      summary: 'The IPC feature was completed.',
      commandsAndTools: [],
      reproductionGuide: '',
      mentalModel: 'Renderer calls preload, which invokes a validated main-process handler.',
    }))

    const source = buildTeachbackSourceContent(db, 'conv-1', {})

    expect(source.sourceLabel).toBe('debrief mental model')
    expect(source.sourceMaterial).toContain('Renderer calls preload')
    expect(transcriptMock).not.toHaveBeenCalled()
  })

  it('falls back to the raw conversation when no debrief exists', () => {
    findArtifactMock.mockReturnValue(null)
    transcriptMock.mockReturnValue('User: How does IPC work?\n\nAssistant: Through preload.')

    const source = buildTeachbackSourceContent(db, 'conv-1', { topic: 'IPC' })

    expect(source.sourceLabel).toBe('conversation')
    expect(source.sourceMaterial).toContain('Through preload')
  })
})

describe('gradeTeachbackForWs', () => {
  it('grades against the stored artifact version and normalizes rubric scores', async () => {
    const db = {
      prepare: vi.fn((sql: string) => ({
        get: vi.fn(() => sql.includes('artifact_versions')
          ? { artifact_id: 'teachback-1' }
          : sql.includes('FROM artifacts')
            ? { project_id: null }
            : undefined),
        run: vi.fn(() => ({ changes: 1 })),
      })),
    }
    getDatabaseMock.mockReturnValue(db)
    readVersionFileMock.mockReturnValue(JSON.stringify({
      prompt: 'Explain the IPC flow.',
      keyPoints: ['renderer', 'preload', 'main handler'],
      sourceLabel: 'debrief mental model',
      sourceMaterial: 'The renderer calls preload and preload invokes the main handler.',
      spec: { topic: 'IPC' },
      model: 'gpt-5-mini',
    }))
    sendProviderMock.mockResolvedValue({ content: JSON.stringify({
      rubric: {
        accuracy: { score: 6, feedback: 'Technically correct.' },
        completeness: { score: 3.4, feedback: 'Missed validation.' },
        clarity: { score: -1, feedback: 'Sequence was hard to follow.' },
      },
      strengths: ['Named preload.'],
      corrections: ['Mention channel validation.'],
      followUpQuestions: ['Where are IPC return types declared?'],
    }) })

    const result = await gradeTeachbackForWs('teachback-1', 'version-1', 'The renderer calls preload, then main handles it.')

    expect(readVersionFileMock).toHaveBeenCalledWith('version-1', 'teachback.json')
    expect(result.rubric.accuracy.score).toBe(5)
    expect(result.rubric.completeness.score).toBe(3)
    expect(result.rubric.clarity.score).toBe(0)
    expect(result.corrections).toEqual(['Mention channel validation.'])
    expect(result.attemptId).toBeTruthy()
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO teachback_attempts'))
  })
})
