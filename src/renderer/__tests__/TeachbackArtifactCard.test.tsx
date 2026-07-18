import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupMockApi } from '../../test/mocks/api'
import { TeachbackArtifactCard } from '../components/artifacts/TeachbackArtifactCard'

const voice = vi.hoisted(() => ({
  onText: (_text: string) => {},
  toggle: vi.fn(),
  cancel: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../hooks/useVoiceInput', () => ({
  useVoiceInput: (onText: (text: string) => void) => {
    voice.onText = onText
    return { voiceState: 'idle', toggleVoice: voice.toggle, cancelVoice: voice.cancel }
  },
}))

let api: ReturnType<typeof setupMockApi>

beforeEach(() => {
  vi.clearAllMocks()
  api = setupMockApi()
  const version = {
    id: 'teachback-version-1',
    artifactId: 'teachback-artifact-1',
    versionNumber: 1,
    title: 'Teach-back: IPC flow',
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
    id: 'teachback-artifact-1',
    projectId: 'project-1',
    conversationId: 'conv-1',
    title: 'Teach-back: IPC flow',
    kind: 'teachback',
    description: null,
    storageRoot: 'C:\\artifacts',
    currentVersionId: version.id,
    status: 'ready',
    errorMessage: null,
    createdAt: 1,
    updatedAt: 1,
    currentVersion: version,
  })
  api.artifactGetFileContent.mockResolvedValue({ content: JSON.stringify({
    prompt: 'Explain how a renderer request reaches the main process.',
    keyPoints: ['renderer', 'preload', 'main handler'],
    sourceLabel: 'debrief mental model',
    sourceMaterial: 'Reference material',
    spec: { topic: 'IPC flow' },
    model: 'gpt-5-mini',
  }) })
  api.gradeTeachback.mockResolvedValue({
    rubric: {
      accuracy: { score: 4, feedback: 'Correct sequence.' },
      completeness: { score: 3, feedback: 'Mention validation.' },
      clarity: { score: 5, feedback: 'Easy to follow.' },
    },
    strengths: ['Clear preload explanation.'],
    corrections: ['Add the typed channel boundary.'],
    followUpQuestions: ['What does safeHandle add?'],
    attemptId: 'teachback-attempt-1',
    prompt: 'Explain how a renderer request reaches the main process.',
    turnNumber: 0,
    attemptedAt: 10,
  })
})

describe('TeachbackArtifactCard', () => {
  it('submits a transcribed explanation for the loaded artifact version and renders feedback', async () => {
    render(<TeachbackArtifactCard artifactId="teachback-artifact-1" />)
    expect(await screen.findByText('Explain how a renderer request reaches the main process.')).toBeInTheDocument()

    act(() => voice.onText('The renderer calls preload, which invokes the main handler.'))
    await userEvent.click(await screen.findByRole('button', { name: 'Grade explanation' }))

    expect(api.gradeTeachback).toHaveBeenCalledWith(
      'teachback-artifact-1',
      'teachback-version-1',
      'The renderer calls preload, which invokes the main handler.',
      'Explain how a renderer request reaches the main process.',
      undefined,
      0,
    )
    await waitFor(() => expect(screen.getByText('Correct sequence.')).toBeInTheDocument())
    expect(screen.getByText('Add the typed channel boundary.')).toBeInTheDocument()
    expect(screen.getByText('What does safeHandle add?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Answer next question' }))
    expect(await screen.findByText('What does safeHandle add?')).toBeInTheDocument()
    expect(screen.getByText('Viva follow-up 1 of 2')).toBeInTheDocument()
  })

  it('restores persisted feedback after the card reloads', async () => {
    api.getTeachbackAttempts.mockResolvedValue([{
      id: 'saved-attempt', artifactId: 'teachback-artifact-1', versionId: 'teachback-version-1',
      conversationId: 'conv-1', projectId: 'project-1', parentAttemptId: null, turnNumber: 0,
      prompt: 'Explain how a renderer request reaches the main process.', transcript: 'Renderer to preload to main.',
      feedback: {
        rubric: {
          accuracy: { score: 5, feedback: 'Persisted accuracy.' },
          completeness: { score: 4, feedback: 'Persisted completeness.' },
          clarity: { score: 5, feedback: 'Persisted clarity.' },
        },
        strengths: ['Persisted strength.'], corrections: [], followUpQuestions: [],
      },
      attemptedAt: 20,
    }])

    render(<TeachbackArtifactCard artifactId="teachback-artifact-1" />)

    expect(await screen.findByText('Persisted accuracy.')).toBeInTheDocument()
    expect(screen.getByText(/1 saved turn/)).toBeInTheDocument()
  })
})
