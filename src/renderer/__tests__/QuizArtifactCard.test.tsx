import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupMockApi } from '../../test/mocks/api'
import { QuizArtifactCard } from '../components/artifacts/QuizArtifactCard'

let api: ReturnType<typeof setupMockApi>

beforeEach(() => {
  vi.clearAllMocks()
  api = setupMockApi()
  const version = {
    id: 'quiz-version-1',
    artifactId: 'quiz-artifact-1',
    versionNumber: 1,
    title: 'Quiz: IPC flow',
    notes: null,
    specJson: null,
    manifestJson: '{}',
    sourceConversationId: 'conv-1',
    sourceMessageId: null,
    createdByAgentIds: null,
    createdAt: 1,
    files: [],
  }
  api.artifactGetVersion.mockResolvedValue(version)
  api.artifactGet.mockResolvedValue({
    id: 'quiz-artifact-1',
    projectId: 'project-1',
    conversationId: 'conv-1',
    title: 'Quiz: IPC flow',
    kind: 'quiz',
    description: null,
    storageRoot: 'C:\\artifacts',
    currentVersionId: version.id,
    status: 'ready',
    errorMessage: null,
    createdAt: 1,
    updatedAt: 1,
    currentVersion: version,
  })
  api.artifactGetFileContent.mockImplementation(async (_versionId: string, relativePath: string) => ({
    content: relativePath === 'quiz-spec.json'
      ? '{}'
      : JSON.stringify([
          { id: 'q1', question: 'Where does a renderer IPC call go first?', options: ['Preload', 'Database', 'Provider', 'WebSocket'], correctIndex: 0, explanation: 'Preload exposes the API.', category: 'sequence' },
          { id: 'q2', question: 'What validates the handler boundary?', options: ['CSS', 'safeHandle', 'React', 'Whisper'], correctIndex: 1, explanation: 'safeHandle wraps the IPC handler.', category: 'concept' },
        ]),
  }))
  api.getQuizAttempts.mockResolvedValue([])
  api.recordQuizAttempt.mockImplementation(async (input) => ({
    id: 'attempt-1',
    ...input,
    conversationId: input.conversationId ?? null,
    projectId: input.projectId ?? null,
    attemptedAt: 10,
  }))
})

describe('QuizArtifactCard learning history', () => {
  it('persists a completed attempt and renders historical category totals', async () => {
    render(<QuizArtifactCard artifactId="quiz-artifact-1" />)
    const user = userEvent.setup()

    await user.click(await screen.findByText('Preload'))
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    await user.click(screen.getByRole('button', { name: 'Next Question' }))
    await user.click(await screen.findByText('CSS'))
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    await user.click(screen.getByRole('button', { name: 'See Results' }))

    await waitFor(() => expect(api.recordQuizAttempt).toHaveBeenCalledWith({
      artifactId: 'quiz-artifact-1',
      versionId: 'quiz-version-1',
      conversationId: 'conv-1',
      projectId: 'project-1',
      score: 1,
      total: 2,
      categoryBreakdown: {
        sequence: { correct: 1, total: 1 },
        concept: { correct: 0, total: 1 },
      },
      missedQuestions: ['What validates the handler boundary?'],
    }))
    expect(await screen.findByText('History by Category')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()

    // "Regenerate" now opens a spec picker; confirming it kicks off generation.
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    expect(api.startQuizGeneration).toHaveBeenCalledWith(
      'conv-1',
      'project-1',
      undefined,
      { source: 'conversation', difficulty: 'medium', topic: undefined, questionCount: undefined },
      'quiz-artifact-1',
    )
  })
})
