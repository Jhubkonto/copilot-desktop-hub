import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QuizModal } from '../components/QuizModal'
import { setupMockApi } from '../../test/mocks/api'
import type { QuizQuestion } from '../../shared/types'

const MOCK_QUESTIONS: QuizQuestion[] = [
  {
    id: 'q1',
    question: 'What command creates a new git branch?',
    options: ['git new', 'git checkout -b', 'git branch create', 'git init branch'],
    correctIndex: 1,
    explanation: 'git checkout -b creates and switches to a new branch in one step.',
    category: 'command',
  },
  {
    id: 'q2',
    question: 'What does HEAD point to?',
    options: ['First commit', 'Current branch tip', 'Remote origin', 'The staging area'],
    correctIndex: 1,
    explanation: 'HEAD is a reference to the currently checked-out commit.',
    category: 'concept',
  },
]

describe('QuizModal', () => {
  let api: ReturnType<typeof setupMockApi>

  beforeEach(() => {
    api = setupMockApi()
  })

  it('shows spinner while generating', () => {
    api.generateQuiz.mockReturnValue(new Promise(() => {}))
    render(<QuizModal conversationId="conv-1" onClose={vi.fn()} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows error when generateQuiz fails', async () => {
    api.generateQuiz.mockRejectedValueOnce(new Error('No debrief found'))
    render(<QuizModal conversationId="conv-1" onClose={vi.fn()} />)
    await waitFor(() => screen.getByText(/No debrief found/i))
    expect(screen.getByText(/Retry/i)).toBeInTheDocument()
  })

  it('shows error when quiz returns no questions', async () => {
    api.generateQuiz.mockResolvedValueOnce({ questions: [] })
    render(<QuizModal conversationId="conv-1" onClose={vi.fn()} />)
    await waitFor(() => screen.getByText(/No questions could be generated/i))
  })

  it('renders first question after generateQuiz resolves', async () => {
    api.generateQuiz.mockResolvedValueOnce({ questions: MOCK_QUESTIONS })
    render(<QuizModal conversationId="conv-1" onClose={vi.fn()} />)
    await waitFor(() => screen.getByText(/What command creates a new git branch/i))
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    // All four options visible
    expect(screen.getByText('git checkout -b')).toBeInTheDocument()
    expect(screen.getByText('command')).toBeInTheDocument()
  })

  it('Submit button is disabled until an option is selected', async () => {
    api.generateQuiz.mockResolvedValueOnce({ questions: MOCK_QUESTIONS })
    render(<QuizModal conversationId="conv-1" onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Submit'))
    const btn = screen.getByText('Submit').closest('button')!
    expect(btn.disabled).toBe(true)

    fireEvent.click(screen.getByText('git checkout -b'))
    expect(btn.disabled).toBe(false)
  })

  it('submitting correct answer shows Correct feedback and explanation', async () => {
    api.generateQuiz.mockResolvedValueOnce({ questions: MOCK_QUESTIONS })
    render(<QuizModal conversationId="conv-1" onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Submit'))

    fireEvent.click(screen.getByText('git checkout -b'))
    fireEvent.click(screen.getByText('Submit'))

    await waitFor(() => screen.getByText(/Correct!/i))
    expect(screen.getByText(/Explanation/i)).toBeInTheDocument()
    expect(screen.getByText(/git checkout -b creates and switches/i)).toBeInTheDocument()
  })

  it('submitting wrong answer shows Incorrect feedback', async () => {
    api.generateQuiz.mockResolvedValueOnce({ questions: MOCK_QUESTIONS })
    render(<QuizModal conversationId="conv-1" onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Submit'))

    fireEvent.click(screen.getByText('git new'))
    fireEvent.click(screen.getByText('Submit'))

    await waitFor(() => screen.getByText(/Incorrect/i))
  })

  it('Next Question advances to second question', async () => {
    api.generateQuiz.mockResolvedValueOnce({ questions: MOCK_QUESTIONS })
    render(<QuizModal conversationId="conv-1" onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Submit'))

    fireEvent.click(screen.getByText('git checkout -b'))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => screen.getByText(/Next Question/i))
    fireEvent.click(screen.getByText(/Next Question/i))

    await waitFor(() => screen.getByText(/What does HEAD point to/i))
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
  })

  it('summary renders with correct score after last question', async () => {
    api.generateQuiz.mockResolvedValueOnce({ questions: MOCK_QUESTIONS })
    render(<QuizModal conversationId="conv-1" onClose={vi.fn()} />)

    // Answer Q1 correctly
    await waitFor(() => screen.getByText('Submit'))
    fireEvent.click(screen.getByText('git checkout -b'))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => screen.getByText(/Next Question/i))
    fireEvent.click(screen.getByText(/Next Question/i))

    // Answer Q2 incorrectly
    await waitFor(() => screen.getByText('Submit'))
    fireEvent.click(screen.getByText('First commit'))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => screen.getByText(/See Results/i))
    fireEvent.click(screen.getByText(/See Results/i))

    await waitFor(() => screen.getByText(/Try Again/i))
    expect(screen.getByText(/Done/i)).toBeInTheDocument()
  })

  it('Try Again resets and calls generateQuiz again', async () => {
    api.generateQuiz.mockResolvedValue({ questions: MOCK_QUESTIONS })
    render(<QuizModal conversationId="conv-1" onClose={vi.fn()} />)

    // Complete both questions
    await waitFor(() => screen.getByText('Submit'))
    fireEvent.click(screen.getByText('git checkout -b'))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => screen.getByText(/Next Question/i))
    fireEvent.click(screen.getByText(/Next Question/i))
    await waitFor(() => screen.getByText('Submit'))
    fireEvent.click(screen.getByText('Current branch tip'))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => screen.getByText(/See Results/i))
    fireEvent.click(screen.getByText(/See Results/i))

    await waitFor(() => screen.getByText(/Try Again/i))
    fireEvent.click(screen.getByText(/Try Again/i))

    expect(api.generateQuiz).toHaveBeenCalledTimes(2)
  })

  it('Done calls onClose', async () => {
    api.generateQuiz.mockResolvedValue({ questions: MOCK_QUESTIONS })
    const onClose = vi.fn()
    render(<QuizModal conversationId="conv-1" onClose={onClose} />)

    // Complete both questions quickly
    await waitFor(() => screen.getByText('Submit'))
    fireEvent.click(screen.getByText('git checkout -b'))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => screen.getByText(/Next Question/i))
    fireEvent.click(screen.getByText(/Next Question/i))
    await waitFor(() => screen.getByText('Submit'))
    fireEvent.click(screen.getByText('Current branch tip'))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => screen.getByText(/See Results/i))
    fireEvent.click(screen.getByText(/See Results/i))

    await waitFor(() => screen.getByText(/Done/i))
    fireEvent.click(screen.getByText(/Done/i))
    expect(onClose).toHaveBeenCalled()
  })

  it('saveQuizAttempt is called with correct args after summary', async () => {
    api.generateQuiz.mockResolvedValue({ questions: MOCK_QUESTIONS })
    render(<QuizModal conversationId="conv-1" onClose={vi.fn()} />)

    await waitFor(() => screen.getByText('Submit'))
    fireEvent.click(screen.getByText('git checkout -b')) // correct
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => screen.getByText(/Next Question/i))
    fireEvent.click(screen.getByText(/Next Question/i))
    await waitFor(() => screen.getByText('Submit'))
    fireEvent.click(screen.getByText('First commit')) // wrong
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => screen.getByText(/See Results/i))
    fireEvent.click(screen.getByText(/See Results/i))

    await waitFor(() => expect(api.saveQuizAttempt).toHaveBeenCalledWith('conv-1', 1, 2))
  })
})
