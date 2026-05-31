import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SaveToWikiModal } from '../../renderer/components/SaveToWikiModal'
import { setupMockApi, type MockApi } from '../../test/mocks/api'

let mockApi: MockApi

beforeEach(() => {
  mockApi = setupMockApi()
})

describe('SaveToWikiModal', () => {
  it('prefills fields and saves with source traceability', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const onClose = vi.fn()
    const initialContent = '# Architecture note\nDetails'
    mockApi.createWikiEntry.mockResolvedValue({
      id: 'wiki-123',
      project_id: 'proj-1',
      title: 'Architecture note',
      body: initialContent,
      tags: ['architecture', 'notes'],
      source_conversation_id: 'conv-1',
      source_message_id: 'msg-1',
      superseded_by: null,
      created_at: 1000,
      updated_at: 1000,
    })

    render(
      <SaveToWikiModal
        projectId="proj-1"
        conversationId="conv-1"
        messageId="msg-1"
        initialContent={initialContent}
        onSaved={onSaved}
        onClose={onClose}
      />,
    )

    const tagsInput = screen.getByLabelText('Wiki tags')
    await user.type(tagsInput, 'architecture,notes{enter}')
    await user.click(screen.getByRole('button', { name: 'Save to wiki' }))

    await waitFor(() => {
      expect(mockApi.createWikiEntry).toHaveBeenCalledWith(
        'proj-1',
        'Architecture note',
        initialContent,
        ['architecture', 'notes'],
        { conversationId: 'conv-1', messageId: 'msg-1' },
      )
    })
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'wiki-123' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows inline error when save fails', async () => {
    const user = userEvent.setup()
    mockApi.createWikiEntry.mockRejectedValue(new Error('save failed'))

    render(
      <SaveToWikiModal
        projectId="proj-1"
        conversationId="conv-1"
        messageId="msg-1"
        initialContent="Plain title"
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save to wiki' }))

    await waitFor(() => {
      expect(screen.getByText('Failed to save wiki entry')).toBeInTheDocument()
    })
  })
})
