import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatWindow } from '../../renderer/components/ChatWindow'
import { setupMockApi, type MockApi } from '../../test/mocks/api'

let mockApi: MockApi

beforeEach(() => {
  mockApi = setupMockApi()
  mockApi.getMessages = vi.fn().mockResolvedValue([])
  mockApi.onChatStream = vi.fn().mockReturnValue(() => {})
})

describe('ChatWindow — Auth Gating (auth-r-8, auth-r-9)', () => {
  const defaultProps = {
    conversationId: null,
    onConversationCreated: vi.fn(),
    onRefresh: vi.fn()
  }

  it('auth-r-8: disables input when unauthenticated', () => {
    render(<ChatWindow {...defaultProps} authenticated={false} />)
    const textarea = screen.getByPlaceholderText(/sign in/i)
    expect(textarea).toBeDisabled()
  })

  it('auth-r-9: enables input when authenticated', () => {
    render(<ChatWindow {...defaultProps} authenticated={true} />)
    const textarea = screen.getByPlaceholderText(/type a message/i)
    expect(textarea).not.toBeDisabled()
  })

  it('send button is disabled when unauthenticated even with input', () => {
    render(<ChatWindow {...defaultProps} authenticated={false} />)
    const sendButton = screen.getByRole('button', { name: /send/i })
    expect(sendButton).toBeDisabled()
  })
})

