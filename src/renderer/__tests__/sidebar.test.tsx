import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '../../renderer/components/Sidebar'
import { setupMockApi, type MockApi } from '../../test/mocks/api'

let mockApi: MockApi

beforeEach(() => {
  mockApi = setupMockApi()
  mockApi.searchConversations.mockResolvedValue([])
})

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

const defaultProps = {
  currentConversationId: null,
  conversations: [todayConv, yesterdayConv, olderConv],
  onSelectConversation: vi.fn(),
  onNewChat: vi.fn(),
  onDeleteConversation: vi.fn(),
  onRefresh: vi.fn(),
  authState: { authenticated: false, user: null },
  onLogin: vi.fn(),
  onLogout: vi.fn(),
  agents: testAgents,
  activeAgentId: null,
  onSelectAgent: vi.fn(),
  onEditAgent: vi.fn(),
  onCreateAgent: vi.fn(),
  onImportAgent: vi.fn()
}

describe('Sidebar — Conversation List', () => {
  it('side-r-1: conversations grouped by date (Today, Yesterday, Older)', () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Yesterday')).toBeInTheDocument()
    expect(screen.getByText('Older')).toBeInTheDocument()
  })

  it('side-r-2: clicking conversation calls onSelectConversation', async () => {
    const user = userEvent.setup()
    render(<Sidebar {...defaultProps} />)

    await user.click(screen.getByText('Today chat'))
    expect(defaultProps.onSelectConversation).toHaveBeenCalledWith('c1')
  })

  it('side-r-3: active conversation highlighted', () => {
    render(<Sidebar {...defaultProps} currentConversationId="c1" />)

    const todayItem = screen.getByText('Today chat').closest('div[class*="cursor-pointer"]')
    expect(todayItem?.className).toContain('bg-blue')
  })

  it('side-r-4: "New Chat" button calls onNewChat', async () => {
    const user = userEvent.setup()
    render(<Sidebar {...defaultProps} />)

    await user.click(screen.getByText('New Chat'))
    expect(defaultProps.onNewChat).toHaveBeenCalled()
  })

  it('side-r-5: delete button calls onDeleteConversation', async () => {
    const user = userEvent.setup()
    render(<Sidebar {...defaultProps} />)

    // Delete buttons are hidden by CSS (group-hover:block), but present in DOM
    const deleteButtons = screen.getAllByTitle('Delete conversation')
    await user.click(deleteButtons[0])
    expect(defaultProps.onDeleteConversation).toHaveBeenCalledWith('c1')
  })

  it('shows "No conversations yet" when list is empty', () => {
    render(<Sidebar {...defaultProps} conversations={[]} />)
    expect(screen.getByText('No conversations yet')).toBeInTheDocument()
  })
})

describe('Sidebar — Inline Rename', () => {
  it('side-r-6: double-click shows edit field, Enter saves', async () => {
    const user = userEvent.setup()
    render(<Sidebar {...defaultProps} />)

    const titleEl = screen.getByText('Today chat')
    await user.dblClick(titleEl)

    // Input should appear with current title
    const input = screen.getByDisplayValue('Today chat')
    expect(input).toBeInTheDocument()

    // Clear and type new name
    await user.clear(input)
    await user.type(input, 'Renamed Chat{Enter}')

    expect(mockApi.renameConversation).toHaveBeenCalledWith('c1', 'Renamed Chat')
    expect(defaultProps.onRefresh).toHaveBeenCalled()
  })

  it('side-r-7: Escape cancels rename', async () => {
    const user = userEvent.setup()
    render(<Sidebar {...defaultProps} />)

    await user.dblClick(screen.getByText('Today chat'))
    const input = screen.getByDisplayValue('Today chat')
    await user.type(input, ' extra{Escape}')

    // Input should be gone, rename should NOT be called
    expect(screen.queryByDisplayValue('Today chat extra')).not.toBeInTheDocument()
    expect(mockApi.renameConversation).not.toHaveBeenCalled()
  })
})

describe('Sidebar — Search', () => {
  it('side-r-8: search filters conversations by title', async () => {
    const user = userEvent.setup()
    mockApi.searchConversations.mockResolvedValue([todayConv])
    render(<Sidebar {...defaultProps} />)

    const searchInput = screen.getByPlaceholderText('Search conversations...')
    await user.type(searchInput, 'Today')

    await waitFor(() => {
      expect(mockApi.searchConversations).toHaveBeenCalledWith('Today')
    })
  })

  it('side-r-10: empty search shows all conversations', async () => {
    const user = userEvent.setup()
    render(<Sidebar {...defaultProps} />)

    const searchInput = screen.getByPlaceholderText('Search conversations...')
    await user.type(searchInput, 'test')

    await waitFor(() => {
      expect(mockApi.searchConversations).toHaveBeenCalled()
    })

    // Clear search
    await user.clear(searchInput)

    // All conversations should be shown (from props, not search results)
    await waitFor(() => {
      expect(screen.getByText('Today chat')).toBeInTheDocument()
      expect(screen.getByText('Yesterday chat')).toBeInTheDocument()
      expect(screen.getByText('Old chat')).toBeInTheDocument()
    })
  })

  it('shows "No matching conversations" when search returns empty', async () => {
    const user = userEvent.setup()
    mockApi.searchConversations.mockResolvedValue([])
    render(<Sidebar {...defaultProps} conversations={[]} />)

    const searchInput = screen.getByPlaceholderText('Search conversations...')
    await user.type(searchInput, 'nonexistent')

    await waitFor(() => {
      expect(screen.getByText('No matching conversations')).toBeInTheDocument()
    })
  })
})

describe('Sidebar — Agent List', () => {
  it('side-r-11: agent list renders with icons and names', () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByText(/Code Helper/)).toBeInTheDocument()
    expect(screen.getByText(/Writer/)).toBeInTheDocument()
  })

  it('side-r-12: selecting agent calls onSelectAgent', async () => {
    const user = userEvent.setup()
    render(<Sidebar {...defaultProps} />)

    await user.click(screen.getByText(/Code Helper/))
    expect(defaultProps.onSelectAgent).toHaveBeenCalledWith('a1')
  })

  it('side-r-13: active agent highlighted', () => {
    render(<Sidebar {...defaultProps} activeAgentId="a1" />)

    const agentItem = screen.getByText(/Code Helper/).closest('div[class*="cursor-pointer"]')
    expect(agentItem?.className).toContain('bg-blue')
  })

  it('side-r-14: "No Agent" option deselects active agent', async () => {
    const user = userEvent.setup()
    render(<Sidebar {...defaultProps} activeAgentId="a1" />)

    await user.click(screen.getByText('💬 No Agent'))
    expect(defaultProps.onSelectAgent).toHaveBeenCalledWith(null)
  })

  it('shows "No agents configured" when agents list is empty', () => {
    render(<Sidebar {...defaultProps} agents={[]} />)
    expect(screen.getByText('No agents configured')).toBeInTheDocument()
  })
})

describe('Sidebar — Auth Section', () => {
  it('side-r-15: shows "Sign in" when unauthenticated', () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByText(/Sign in with GitHub/)).toBeInTheDocument()
  })

  it('side-r-16: shows avatar + username when authenticated', () => {
    render(
      <Sidebar
        {...defaultProps}
        authState={{
          authenticated: true,
          user: {
            login: 'testuser',
            avatar_url: 'https://example.com/avatar.png',
            name: 'Test User'
          }
        }}
      />
    )
    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(screen.getByAltText('testuser')).toBeInTheDocument()
  })

  it('side-r-16b: shows login when name is null', () => {
    render(
      <Sidebar
        {...defaultProps}
        authState={{
          authenticated: true,
          user: {
            login: 'testuser',
            avatar_url: 'https://example.com/avatar.png',
            name: null
          }
        }}
      />
    )
    expect(screen.getByText('testuser')).toBeInTheDocument()
  })

  it('side-r-17: sign in button calls onLogin', async () => {
    const user = userEvent.setup()
    render(<Sidebar {...defaultProps} />)

    await user.click(screen.getByText(/Sign in with GitHub/))
    expect(defaultProps.onLogin).toHaveBeenCalled()
  })

  it('side-r-18: sign out button calls onLogout', async () => {
    const user = userEvent.setup()
    render(
      <Sidebar
        {...defaultProps}
        authState={{
          authenticated: true,
          user: { login: 'testuser', avatar_url: 'https://example.com/avatar.png', name: 'Test' }
        }}
      />
    )

    await user.click(screen.getByText('Sign out'))
    expect(defaultProps.onLogout).toHaveBeenCalled()
  })
})
