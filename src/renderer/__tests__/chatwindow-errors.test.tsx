import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatWindow } from '../../renderer/components/ChatWindow'
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

beforeEach(() => {
  mockApi = setupMockApi()
  mockApi.onStreamResponse = vi.fn().mockReturnValue(() => {})
  mockStore = createMockAppStore({
    currentConversationId: 'conv-1',
    authState: { authenticated: true, user: { login: 'test', name: 'Test', avatar_url: '' } }
  })
  setupStoreMock(useAppStore, mockStore)
})

describe('ChatWindow — Error Handling', () => {
  it('shows toast when getMessages fails', async () => {
    mockApi.getMessages = vi.fn().mockRejectedValue(new Error('DB error'))

    render(<ChatWindow />)

    await waitFor(() => {
      expect(mockStore.addToast).toHaveBeenCalledWith('Failed to load messages', 'error')
    })
  })

  it('shows toast and error message when sendMessage fails', async () => {
    mockApi.getMessages = vi.fn().mockResolvedValue([])
    mockApi.sendMessage = vi.fn().mockRejectedValue(new Error('Network error'))

    render(<ChatWindow />)

    const input = screen.getByLabelText('Message input')
    await user.type(input, 'Hello')
    await user.click(screen.getByLabelText('Send message'))

    await waitFor(() => {
      expect(mockStore.addToast).toHaveBeenCalledWith('Failed to send message. Please try again.', 'error')
    })
  })

  it('shows toast when stopGeneration fails', async () => {
    mockApi.getMessages = vi.fn().mockResolvedValue([])
    mockApi.sendMessage = vi.fn().mockResolvedValue(undefined)
    mockApi.stopGeneration = vi.fn().mockRejectedValue(new Error('fail'))

    render(<ChatWindow />)

    const input = screen.getByLabelText('Message input')
    await user.type(input, 'Hello')
    await user.click(screen.getByLabelText('Send message'))

    // Wait for generating state
    await waitFor(() => {
      expect(screen.getByLabelText('Stop generating')).toBeInTheDocument()
    })

    await user.click(screen.getByLabelText('Stop generating'))

    await waitFor(() => {
      expect(mockStore.addToast).toHaveBeenCalledWith('Failed to stop generation', 'error')
    })
  })
})
