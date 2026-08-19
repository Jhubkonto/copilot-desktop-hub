import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '../../renderer/components/Sidebar'
import { setupMockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn()
}))

vi.mock('../../renderer/store/app-store', () => ({ useAppStore }))

let mockStore: ReturnType<typeof createMockAppStore>
let mockApi: ReturnType<typeof setupMockApi>
const user = userEvent.setup()

beforeEach(() => {
  mockApi = setupMockApi()
})

describe('Sidebar', () => {
  it('shows compact status dots for configured providers and available CLI tools', async () => {
    mockStore = createMockAppStore({ authState: { authenticated: true, mode: 'byok', user: null } })
    setupStoreMock(useAppStore, mockStore)
    mockApi.listProviders.mockResolvedValue([{ name: 'openai', label: 'API keys configured', configured: true }])

    render(<Sidebar />)
    const statusDot = await screen.findByLabelText('API keys configured API key is active')
    expect(statusDot).toBeInTheDocument()
    await user.hover(statusDot)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('API keys configured API key is active')
    expect(screen.queryByText('BYOK mode is active')).not.toBeInTheDocument()
  })

  it('starts a new chat from the primary action', async () => {
    mockStore = createMockAppStore()
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    await user.click(screen.getByText('New Chat'))

    expect(mockStore.newChat).toHaveBeenCalled()
  })

  it('opens the Automated Workflows section from the sidebar', async () => {
    mockStore = createMockAppStore()
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    await user.click(screen.getByText('Workflows'))

    expect(mockStore.openSectionPane).toHaveBeenCalledWith('workflows')
  })

  it('opens the Ratings section from the sidebar', async () => {
    mockStore = createMockAppStore()
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    await user.click(screen.getByText('Ratings'))

    expect(mockStore.openSectionPane).toHaveBeenCalledWith('ratings')
  })

  it('shows the unread chat count on Chats without auto-opening any chat', async () => {
    mockStore = createMockAppStore({
      unreadConversationIds: ['chat-1', 'chat-2'],
      conversations: [
        { id: 'chat-1', title: 'Older', pinned: 0, project_id: null, agent_id: null, updated_at: 100 },
        { id: 'chat-2', title: 'Newer', pinned: 0, project_id: null, agent_id: null, updated_at: 200 },
      ],
    })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    const entry = screen.getByLabelText('Open chat history (2 unread)')
    expect(entry).toHaveTextContent('2')
    await user.click(entry)

    // Opening the Chats list must not itself mark any conversation read — the badge
    // should only clear once the user opens that specific chat and reads it.
    expect(mockStore.openSectionPane).toHaveBeenCalledWith('chats')
    expect(mockStore.selectConversation).not.toHaveBeenCalled()
  })

  it('shows pinned chats as quick access and allows unpinning', async () => {
    mockStore = createMockAppStore({
      conversations: [{
        id: 'pinned-1',
        title: 'API migration',
        pinned: 1,
        project_id: null,
        agent_id: null,
      }],
    })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    await user.click(screen.getByLabelText('Open pinned chat API migration'))
    expect(mockStore.selectConversation).toHaveBeenCalledWith('pinned-1')

    await user.click(screen.getByLabelText('Unpin API migration'))
    expect(mockApi.setConversationPinned).toHaveBeenCalledWith('pinned-1', false)
    expect(mockStore.loadConversations).toHaveBeenCalled()
  })

  it('links an overflowing pinned shelf to the dedicated pinned chats pane', async () => {
    mockStore = createMockAppStore({
      conversations: Array.from({ length: 6 }, (_, index) => ({
        id: `pinned-${index}`,
        title: `Pinned ${index}`,
        pinned: 1,
        project_id: null,
        agent_id: null,
      })),
    })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    await user.click(screen.getByText('View all 6…'))

    expect(mockStore.openSectionPane).toHaveBeenCalledWith('pinned')
  })
})
