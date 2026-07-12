import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RatingsPane } from '../components/section-pane/RatingsPane'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'
import { setupMockApi } from '../../test/mocks/api'
import type { ConversationRatingListItem, ConversationRatingStats } from '../../shared/types'

const { useAppStore } = vi.hoisted(() => ({ useAppStore: vi.fn() }))
vi.mock('../store/app-store', () => ({ useAppStore }))

const RATING_1: ConversationRatingListItem = {
  id: 'rating-1',
  conversationId: 'conv-1',
  conversationTitle: 'Investigate flaky login',
  projectId: 'proj-1',
  projectName: 'Nexy',
  rating: 5,
  note: 'Nailed it',
  agentName: 'Research Agent',
  model: 'claude-sonnet-4-6',
  toolNames: ['search_project_wiki'],
  skillNames: ['Deep Research'],
  createdAt: 1000,
  updatedAt: 2000,
}

const RATING_2: ConversationRatingListItem = {
  id: 'rating-2',
  conversationId: 'conv-2',
  conversationTitle: 'Fix the build',
  projectId: 'proj-1',
  projectName: 'Nexy',
  rating: 2,
  note: null,
  agentName: 'Fixer Agent',
  model: 'gpt-5',
  toolNames: [],
  skillNames: [],
  createdAt: 500,
  updatedAt: 1500,
}

const STATS: ConversationRatingStats = {
  averageByAgent: [{ label: 'Research Agent', average: 5, count: 1 }, { label: 'Fixer Agent', average: 2, count: 1 }],
  averageByModel: [],
  averageBySkill: [],
  averageByServer: [],
  averageByProject: [{ label: 'Nexy', average: 3.5, count: 2 }],
  trend: [{ date: '2024-01-01', average: 3.5, count: 2 }],
}

const EMPTY_STATS: ConversationRatingStats = {
  averageByAgent: [], averageByModel: [], averageBySkill: [], averageByServer: [], averageByProject: [], trend: [],
}

let mockStore: ReturnType<typeof createMockAppStore>
let mockApi: ReturnType<typeof setupMockApi>

beforeEach(() => {
  vi.clearAllMocks()
  mockApi = setupMockApi()
  mockApi.listConversationRatings.mockResolvedValue([RATING_1, RATING_2])
  mockApi.getConversationRatingStats.mockResolvedValue(STATS)
  mockStore = createMockAppStore({ theme: 'dark' })
  setupStoreMock(useAppStore, mockStore)
})

describe('RatingsPane', () => {
  it('renders the rated-conversation count and rows after loading', async () => {
    render(<RatingsPane />)
    await waitFor(() => {
      expect(screen.getByText('2 rated conversations')).toBeInTheDocument()
    })
    expect(screen.getByText('Investigate flaky login')).toBeInTheDocument()
    expect(screen.getByText('Fix the build')).toBeInTheDocument()
  })

  it('calls listConversationRatings and getConversationRatingStats on mount', async () => {
    render(<RatingsPane />)
    await waitFor(() => {
      expect(mockApi.listConversationRatings).toHaveBeenCalledWith()
      expect(mockApi.getConversationRatingStats).toHaveBeenCalledWith()
    })
  })

  it('shows chart section headers when stats have data', async () => {
    render(<RatingsPane />)
    await waitFor(() => {
      expect(screen.getByText('Average by Agent')).toBeInTheDocument()
    })
    expect(screen.getByText('Average by Project')).toBeInTheDocument()
    expect(screen.getByText('Rating Trend')).toBeInTheDocument()
    expect(screen.queryByText('Average by Model')).not.toBeInTheDocument()
  })

  it('hides the chart section entirely when there are no stats', async () => {
    mockApi.getConversationRatingStats.mockResolvedValue(EMPTY_STATS)
    render(<RatingsPane />)
    await waitFor(() => {
      expect(screen.getByText('Investigate flaky login')).toBeInTheDocument()
    })
    expect(screen.queryByText('Average by Agent')).not.toBeInTheDocument()
  })

  it('shows empty state when nothing is rated yet', async () => {
    mockApi.listConversationRatings.mockResolvedValue([])
    render(<RatingsPane />)
    await waitFor(() => {
      expect(screen.getByText('No conversations rated yet')).toBeInTheDocument()
    })
  })

  it('filters rows by search query', async () => {
    render(<RatingsPane />)
    await waitFor(() => {
      expect(screen.getByText('Investigate flaky login')).toBeInTheDocument()
      expect(screen.getByText('Fix the build')).toBeInTheDocument()
    })

    await userEvent.type(screen.getByPlaceholderText(/search ratings/i), 'flaky')

    await waitFor(() => {
      expect(screen.getByText('Investigate flaky login')).toBeInTheDocument()
      expect(screen.queryByText('Fix the build')).not.toBeInTheDocument()
    })
  })

  it('selects the source conversation when a row is clicked', async () => {
    render(<RatingsPane />)
    await waitFor(() => {
      expect(screen.getByText('Investigate flaky login')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText('Investigate flaky login'))
    expect(mockStore.selectConversation).toHaveBeenCalledWith('conv-1')
  })

  it('refetches when a rating:updated push event fires', async () => {
    const ref: { cb: ((data: { conversationId: string; rating: null }) => void) | null } = { cb: null }
    mockApi.onConversationRated.mockImplementation((cb: (data: { conversationId: string; rating: null }) => void) => {
      ref.cb = cb
      return () => { ref.cb = null }
    })
    render(<RatingsPane />)
    await waitFor(() => {
      expect(mockApi.listConversationRatings).toHaveBeenCalledTimes(1)
    })

    mockApi.listConversationRatings.mockResolvedValue([RATING_1])
    ref.cb?.({ conversationId: 'conv-1', rating: null })

    await waitFor(() => {
      expect(mockApi.listConversationRatings).toHaveBeenCalledTimes(2)
    })
  })
})
