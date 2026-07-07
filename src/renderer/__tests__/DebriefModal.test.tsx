import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { DebriefModal } from '../components/DebriefModal'
import { setupMockApi } from '../../test/mocks/api'

describe('DebriefModal', () => {
  let api: ReturnType<typeof setupMockApi>

  beforeEach(() => {
    api = setupMockApi()
  })

  it('shows the conversation title and explanation before generating', () => {
    render(
      <DebriefModal
        conversationId="conv-1"
        conversationTitle="My Chat"
        projectId={null}
        model="claude-sonnet-4-6"
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('My Chat')).toBeInTheDocument()
    expect(screen.getByText(/asks an AI model to read this conversation's transcript/i)).toBeInTheDocument()
    expect(screen.getByText(/separate from "Mark complete"/i)).toBeInTheDocument()
    expect(api.generateDebrief).not.toHaveBeenCalled()
  })

  it('does not generate until the user clicks Generate debrief', () => {
    api.generateDebrief.mockReturnValue(new Promise(() => {}))
    render(
      <DebriefModal
        conversationId="conv-1"
        conversationTitle="My Chat"
        projectId={null}
        model="claude-sonnet-4-6"
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Generate debrief'))
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(api.generateDebrief).toHaveBeenCalledWith('conv-1', null, 'claude-sonnet-4-6')
  })

  it('renders review step after generateDebrief resolves', async () => {
    render(
      <DebriefModal
        conversationId="conv-1"
        conversationTitle="My Chat"
        projectId={null}
        model="claude-sonnet-4-6"
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Generate debrief'))
    await waitFor(() => {
      expect(screen.getByText(/How to Reproduce/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Mental Model \/ Approach/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Summary/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Commands & Tools/i)).toBeInTheDocument()
  })

  it('skips the intro step and shows review directly when an existing debrief is passed', () => {
    render(
      <DebriefModal
        conversationId="conv-1"
        conversationTitle="My Chat"
        projectId={null}
        model="claude-sonnet-4-6"
        initialDebrief={{
          id: 'debrief-1',
          conversationId: 'conv-1',
          projectId: null,
          summary: 'Existing summary',
          commandsTools: ['git'],
          reproductionGuide: 'steps',
          mentalModel: 'approach',
          generatedAt: 0,
          createdAt: 0,
        }}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Existing summary')).toBeInTheDocument()
    expect(api.generateDebrief).not.toHaveBeenCalled()
  })

  it('each section is editable', async () => {
    render(
      <DebriefModal
        conversationId="conv-1"
        conversationTitle="My Chat"
        projectId={null}
        model="claude-sonnet-4-6"
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Generate debrief'))
    await waitFor(() => screen.getByText(/How to Reproduce/i))

    const textareas = screen.getAllByRole('textbox') as HTMLTextAreaElement[]
    fireEvent.change(textareas[0], { target: { value: 'New summary text' } })
    expect(textareas[0].value).toBe('New summary text')
  })

  it('triggers saveTextFile when Export Markdown is clicked', async () => {
    render(
      <DebriefModal
        conversationId="conv-1"
        conversationTitle="My Chat"
        projectId={null}
        model="claude-sonnet-4-6"
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Generate debrief'))
    await waitFor(() => screen.getByText(/Continue to Storage/i))
    fireEvent.click(screen.getByText(/Continue to Storage/i))

    await waitFor(() => screen.getByText(/Export Markdown/i))
    fireEvent.click(screen.getByText(/Export Markdown/i))

    await waitFor(() => expect(api.saveTextFile).toHaveBeenCalledWith(
      'debrief.md',
      expect.stringContaining('# Debrief: My Chat')
    ))
  })

  it('shows error state and Retry button when generation fails', async () => {
    api.generateDebrief.mockRejectedValueOnce(new Error('Network error'))
    render(
      <DebriefModal
        conversationId="conv-1"
        conversationTitle="My Chat"
        projectId={null}
        model="claude-sonnet-4-6"
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Generate debrief'))
    await waitFor(() => screen.getByText(/Network error/i))
    expect(screen.getByText(/Retry/i)).toBeInTheDocument()
  })

  it('shows the real error message instead of crashing when the IPC call resolves with an ApiError', async () => {
    api.generateDebrief.mockResolvedValueOnce({ error: 'Conversation has no messages to debrief' })
    render(
      <DebriefModal
        conversationId="conv-1"
        conversationTitle="My Chat"
        projectId={null}
        model="claude-sonnet-4-6"
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Generate debrief'))
    await waitFor(() => screen.getByText(/Conversation has no messages to debrief/i))
    expect(screen.getByText(/Retry/i)).toBeInTheDocument()
  })

  it('retry after failure calls generateDebrief again', async () => {
    api.generateDebrief.mockRejectedValueOnce(new Error('Network error'))
    render(
      <DebriefModal
        conversationId="conv-1"
        conversationTitle="My Chat"
        projectId={null}
        model="claude-sonnet-4-6"
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Generate debrief'))
    await waitFor(() => screen.getByText(/Network error/i))
    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(api.generateDebrief).toHaveBeenCalledTimes(2))
  })
})
