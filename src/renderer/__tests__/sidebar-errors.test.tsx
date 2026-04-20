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
let mockStore: ReturnType<typeof createMockAppStore>
const user = userEvent.setup()

const CONV = {
  id: 'conv-1',
  title: 'Test Chat',
  agent_id: null,
  created_at: Date.now(),
  updated_at: Date.now()
}

beforeEach(() => {
  mockApi = setupMockApi()
  mockStore = createMockAppStore({
    conversations: [CONV],
    authState: { authenticated: true, user: { login: 'test', name: 'Test', avatar_url: '' } }
  })
  setupStoreMock(useAppStore, mockStore)
})

describe('Sidebar — Error Handling', () => {
  it('shows toast when rename fails', async () => {
    mockApi.renameConversation = vi.fn().mockRejectedValue(new Error('DB error'))

    render(<Sidebar />)

    const convTitle = screen.getByText('Test Chat')
    await user.dblClick(convTitle)

    const renameInput = screen.getByDisplayValue('Test Chat')
    await user.clear(renameInput)
    await user.type(renameInput, 'New Name{enter}')

    await waitFor(() => {
      expect(mockStore.addToast).toHaveBeenCalledWith('Failed to rename conversation', 'error')
    })
  })

  it('does not crash when search fails', async () => {
    mockApi.searchConversations = vi.fn().mockRejectedValue(new Error('Search error'))

    render(<Sidebar />)

    const searchInput = screen.getByPlaceholderText('Search conversations...')
    await user.type(searchInput, 'test query')

    // Should still render without crashing
    await waitFor(() => {
      expect(screen.getByText('Test Chat')).toBeInTheDocument()
    })
  })
})
