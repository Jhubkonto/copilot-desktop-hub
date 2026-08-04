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
  it('shows provider-configured footer in BYOK mode', async () => {
    mockStore = createMockAppStore({ authState: { authenticated: true, mode: 'byok', user: null } })
    setupStoreMock(useAppStore, mockStore)
    mockApi.listProviders.mockResolvedValue([{ name: 'openai', label: 'API keys configured', configured: true }])

    render(<Sidebar />)
    await screen.findByText('API keys configured')
    expect(screen.getByText('BYOK mode is active')).toBeInTheDocument()
  })

  it('opens settings from footer button', async () => {
    mockStore = createMockAppStore({ authState: { authenticated: false, mode: 'none', user: null } })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    await user.click(screen.getByText('Settings'))

    expect(mockStore.setShowSettings).toHaveBeenCalledWith(true)
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

  it('shows the unread chat count and opens New content', async () => {
    mockStore = createMockAppStore({ syncedUnreadConversationIds: ['chat-1', 'chat-2'] })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    const entry = screen.getByLabelText('Open new content')
    expect(entry).toHaveTextContent('2')
    await user.click(entry)

    expect(mockStore.openSectionPane).toHaveBeenCalledWith('new-content')
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

  it('links an overflowing pinned shelf to the full chat history', async () => {
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

    expect(mockStore.openSectionPane).toHaveBeenCalledWith('chats')
  })
})
