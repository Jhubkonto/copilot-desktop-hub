import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '../../renderer/components/Sidebar'
import { setupMockApi, type MockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn()
}))

vi.mock('../../renderer/store/app-store', () => ({
  useAppStore
}))

let mockApi: MockApi

const now = Date.now()
const todayConv = { id: 'c1', agent_id: null, title: 'Today chat', created_at: now, updated_at: now }
const yesterdayConv = {
  id: 'c2',
  agent_id: null,
  title: 'Yesterday chat',
  created_at: now - 86400000 - 1000,
  updated_at: now - 86400000 - 1000
}
const olderConv = {
  id: 'c3',
  agent_id: null,
  title: 'Old chat',
  created_at: now - 30 * 86400000,
  updated_at: now - 30 * 86400000
}

const testAgents = [
  { id: 'a1', name: 'Code Helper', icon: '🧑‍💻', isDefault: true },
  { id: 'a2', name: 'Writer', icon: '✍️', isDefault: false }
]

let mockStore: ReturnType<typeof createMockAppStore>

beforeEach(() => {
  mockApi = setupMockApi()
  mockApi.searchConversations.mockResolvedValue([])
  mockApi.renameConversation.mockResolvedValue(undefined)

  mockStore = createMockAppStore({
    conversations: [todayConv, yesterdayConv, olderConv],
    agents: testAgents
  })
  setupStoreMock(useAppStore, mockStore)
})

describe('Sidebar — Conversation List', () => {
  it('side-r-1: conversations grouped by date (Today, Yesterday, Older)', () => {
    render(<Sidebar />)
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Yesterday')).toBeInTheDocument()
    expect(screen.getByText('Older')).toBeInTheDocument()
  })

  it('side-r-2: clicking conversation calls selectConversation', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByText('Today chat'))
    expect(mockStore.selectConversation).toHaveBeenCalledWith('c1')
  })

  it('side-r-3: active conversation highlighted', () => {
    mockStore = createMockAppStore({
      conversations: [todayConv, yesterdayConv, olderConv],
      agents: testAgents,
      currentConversationId: 'c1'
    })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)

    const todayItem = screen.getByText('Today chat').closest('div[class*="cursor-pointer"]')
    expect(todayItem?.className).toContain('bg-blue')
  })

  it('side-r-4: "New Chat" button calls newChat', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByText('New Chat'))
    expect(mockStore.newChat).toHaveBeenCalled()
  })

  it('side-r-5: delete button calls deleteConversation', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    const deleteButtons = screen.getAllByTitle('Delete conversation')
    await user.click(deleteButtons[0])
    expect(mockStore.deleteConversation).toHaveBeenCalledWith('c1')
  })

  it('shows "No conversations yet" when list is empty', () => {
    mockStore = createMockAppStore({ agents: testAgents })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.getByText('No conversations yet')).toBeInTheDocument()
  })
})

describe('Sidebar — Inline Rename', () => {
  it('side-r-6: double-click shows edit field, Enter saves', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    const titleEl = screen.getByText('Today chat')
    await user.dblClick(titleEl)

    const input = screen.getByDisplayValue('Today chat')
    expect(input).toBeInTheDocument()

    await user.clear(input)
    await user.type(input, 'Renamed Chat{Enter}')

    expect(mockApi.renameConversation).toHaveBeenCalledWith('c1', 'Renamed Chat')
    expect(mockStore.loadConversations).toHaveBeenCalled()
  })

  it('side-r-7: Escape cancels rename', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.dblClick(screen.getByText('Today chat'))
    const input = screen.getByDisplayValue('Today chat')
    await user.type(input, ' extra{Escape}')

    expect(screen.queryByDisplayValue('Today chat extra')).not.toBeInTheDocument()
    expect(mockApi.renameConversation).not.toHaveBeenCalled()
  })
})

describe('Sidebar — Search', () => {
  it('side-r-8: search filters conversations by title', async () => {
    const user = userEvent.setup()
    mockApi.searchConversations.mockResolvedValue([todayConv])
    render(<Sidebar />)

    const searchInput = screen.getByPlaceholderText('Search conversations...')
    await user.type(searchInput, 'Today')

    await waitFor(() => {
      expect(mockApi.searchConversations).toHaveBeenCalledWith('Today')
    })
  })

  it('side-r-10: empty search shows all conversations', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    const searchInput = screen.getByPlaceholderText('Search conversations...')
    await user.type(searchInput, 'test')

    await waitFor(() => {
      expect(mockApi.searchConversations).toHaveBeenCalled()
    })

    await user.clear(searchInput)

    await waitFor(() => {
      expect(screen.getByText('Today chat')).toBeInTheDocument()
      expect(screen.getByText('Yesterday chat')).toBeInTheDocument()
      expect(screen.getByText('Old chat')).toBeInTheDocument()
    })
  })

  it('shows "No matching conversations" when search returns empty', async () => {
    const user = userEvent.setup()
    mockApi.searchConversations.mockResolvedValue([])
    mockStore = createMockAppStore({ agents: testAgents })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)

    const searchInput = screen.getByPlaceholderText('Search conversations...')
    await user.type(searchInput, 'nonexistent')

    await waitFor(() => {
      expect(screen.getByText('No matching conversations')).toBeInTheDocument()
    })
  })
})

describe('Sidebar — Agent List', () => {
  it('side-r-11: agent list renders with icons and names', () => {
    render(<Sidebar />)
    expect(screen.getByText(/Code Helper/)).toBeInTheDocument()
    expect(screen.getByText(/Writer/)).toBeInTheDocument()
  })

  it('side-r-12: selecting agent calls selectAgent', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByText(/Code Helper/))
    expect(mockStore.selectAgent).toHaveBeenCalledWith('a1')
  })

  it('side-r-13: active agent highlighted', () => {
    mockStore = createMockAppStore({
      conversations: [todayConv, yesterdayConv, olderConv],
      agents: testAgents,
      activeAgentId: 'a1'
    })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)

    const agentItem = screen.getByText(/Code Helper/).closest('div[class*="cursor-pointer"]')
    expect(agentItem?.className).toContain('bg-blue')
  })

  it('side-r-14: "No Agent" option deselects active agent', async () => {
    const user = userEvent.setup()
    mockStore = createMockAppStore({
      conversations: [todayConv, yesterdayConv, olderConv],
      agents: testAgents,
      activeAgentId: 'a1'
    })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)

    await user.click(screen.getByText('💬 No Agent'))
    expect(mockStore.selectAgent).toHaveBeenCalledWith(null)
  })

  it('shows "No agents configured" when agents list is empty', () => {
    mockStore = createMockAppStore()
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.getByText('No agents configured')).toBeInTheDocument()
  })
})

describe('Sidebar — Auth Section', () => {
  it('side-r-15: shows "Sign in" when unauthenticated', () => {
    render(<Sidebar />)
    expect(screen.getByText(/Sign in with GitHub/)).toBeInTheDocument()
  })

  it('side-r-16: shows avatar + username when authenticated', () => {
    mockStore = createMockAppStore({
      conversations: [todayConv, yesterdayConv, olderConv],
      agents: testAgents,
      authState: {
        authenticated: true,
        user: {
          login: 'testuser',
          avatar_url: 'https://example.com/avatar.png',
          name: 'Test User'
        }
      }
    })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(screen.getByAltText('testuser')).toBeInTheDocument()
  })

  it('side-r-16b: shows login when name is null', () => {
    mockStore = createMockAppStore({
      conversations: [todayConv, yesterdayConv, olderConv],
      agents: testAgents,
      authState: {
        authenticated: true,
        user: {
          login: 'testuser',
          avatar_url: 'https://example.com/avatar.png',
          name: null
        }
      }
    })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.getByText('testuser')).toBeInTheDocument()
  })

  it('side-r-17: sign in button calls login', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByText(/Sign in with GitHub/))
    expect(mockStore.login).toHaveBeenCalled()
  })

  it('side-r-18: sign out button calls logout', async () => {
    const user = userEvent.setup()
    mockStore = createMockAppStore({
      conversations: [todayConv, yesterdayConv, olderConv],
      agents: testAgents,
      authState: {
        authenticated: true,
        user: { login: 'testuser', avatar_url: 'https://example.com/avatar.png', name: 'Test' }
      }
    })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)

    await user.click(screen.getByText('Sign out'))
    expect(mockStore.logout).toHaveBeenCalled()
  })
})
