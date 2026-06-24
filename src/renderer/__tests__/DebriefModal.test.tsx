import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { DebriefModal } from '../components/DebriefModal'
import { setupMockApi } from '../../test/mocks/api'

describe('DebriefModal', () => {
  let api: ReturnType<typeof setupMockApi>

  beforeEach(() => {
    api = setupMockApi()
  })

  it('shows spinner while generating', () => {
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
    expect(screen.getByRole('status')).toBeInTheDocument()
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
    await waitFor(() => {
      expect(screen.getByText(/How to Reproduce/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Mental Model \/ Approach/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Summary/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Commands & Tools/i)).toBeInTheDocument()
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
    await waitFor(() => screen.getByText(/Network error/i))
    expect(screen.getByText(/Retry/i)).toBeInTheDocument()
  })
})
