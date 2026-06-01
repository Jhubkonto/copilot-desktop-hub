import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WikiExtractionModal } from '../../renderer/components/WikiExtractionModal'
import { setupMockApi, type MockApi } from '../../test/mocks/api'
import type { WikiCandidate } from '../../shared/types'

let mockApi: MockApi

const baseCandidates: WikiCandidate[] = [
  {
    title: 'SQLite wiki cache',
    body: 'Persist wiki entries in SQLite.',
    tags: ['storage', 'wiki'],
    matchingEntryId: null,
    matchingEntryTitle: null,
    supersededEntryId: null,
    supersededEntryTitle: null,
  },
  {
    title: 'Context injection order',
    body: 'Project context is prepended before message content.',
    tags: ['context'],
    matchingEntryId: null,
    matchingEntryTitle: null,
    supersededEntryId: null,
    supersededEntryTitle: null,
  },
]

beforeEach(() => {
  mockApi = setupMockApi()
})

describe('WikiExtractionModal', () => {
  it('renders all candidates', () => {
    render(
      <WikiExtractionModal
        projectId="proj-1"
        conversationId="conv-1"
        candidates={baseCandidates}
        onClose={vi.fn()}
        onAllDone={vi.fn()}
      />,
    )

    expect(screen.getByText('2 candidates')).toBeInTheDocument()
    expect(screen.getByText('SQLite wiki cache')).toBeInTheDocument()
    expect(screen.getByText('Context injection order')).toBeInTheDocument()
  })

  it('accept saves via createWikiEntry', async () => {
    const user = userEvent.setup()

    render(
      <WikiExtractionModal
        projectId="proj-1"
        conversationId="conv-1"
        candidates={[baseCandidates[0]]}
        onClose={vi.fn()}
        onAllDone={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() => {
      expect(mockApi.createWikiEntry).toHaveBeenCalledWith(
        'proj-1',
        'SQLite wiki cache',
        'Persist wiki entries in SQLite.',
        ['storage', 'wiki'],
        { conversationId: 'conv-1' },
      )
    })
  })

  it('discard does not call the API', async () => {
    const user = userEvent.setup()

    render(
      <WikiExtractionModal
        projectId="proj-1"
        conversationId="conv-1"
        candidates={[baseCandidates[0]]}
        onClose={vi.fn()}
        onAllDone={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Discard' }))

    expect(mockApi.createWikiEntry).not.toHaveBeenCalled()
    expect(mockApi.updateWikiEntry).not.toHaveBeenCalled()
  })

  it('updates an existing entry when a fuzzy match exists', async () => {
    const user = userEvent.setup()
    const candidate: WikiCandidate = {
      ...baseCandidates[0],
      matchingEntryId: 'wiki-existing',
      matchingEntryTitle: 'SQLite wiki cache',
    }

    render(
      <WikiExtractionModal
        projectId="proj-1"
        conversationId="conv-1"
        candidates={[candidate]}
        onClose={vi.fn()}
        onAllDone={vi.fn()}
      />,
    )

    expect(screen.getByText(/Similar entry exists:/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Update existing' }))

    await waitFor(() => {
      expect(mockApi.updateWikiEntry).toHaveBeenCalledWith('wiki-existing', {
        title: 'SQLite wiki cache',
        body: 'Persist wiki entries in SQLite.',
        tags: ['storage', 'wiki'],
      })
    })
    expect(mockApi.createWikiEntry).not.toHaveBeenCalled()
  })

  it('accept all saves every pending candidate', async () => {
    const user = userEvent.setup()
    const onAllDone = vi.fn()

    render(
      <WikiExtractionModal
        projectId="proj-1"
        conversationId="conv-1"
        candidates={baseCandidates}
        onClose={vi.fn()}
        onAllDone={onAllDone}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Accept All' }))

    await waitFor(() => {
      expect(mockApi.createWikiEntry).toHaveBeenCalledTimes(2)
    })
    expect(onAllDone).toHaveBeenCalledWith(2)
  })
})
