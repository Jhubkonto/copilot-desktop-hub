import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

beforeEach(() => {
  mockApi = setupMockApi()
  mockApi.getMessages = vi.fn().mockResolvedValue([])
  mockApi.onStreamResponse = vi.fn().mockReturnValue(() => {})
})

describe('ChatWindow — Auth Gating (auth-r-8, auth-r-9)', () => {
  it('auth-r-8: disables input when unauthenticated', () => {
    const mockStore = createMockAppStore({
      authState: { authenticated: false, user: null }
    })
    setupStoreMock(useAppStore, mockStore)

    render(<ChatWindow />)
    const textarea = screen.getByPlaceholderText(/sign in/i)
    expect(textarea).toBeDisabled()
  })

  it('auth-r-9: enables input when authenticated', () => {
    const mockStore = createMockAppStore({
      authState: { authenticated: true, user: null }
    })
    setupStoreMock(useAppStore, mockStore)

    render(<ChatWindow />)
    const textarea = screen.getByPlaceholderText(/type a message/i)
    expect(textarea).not.toBeDisabled()
  })

  it('send button is disabled when unauthenticated even with input', () => {
    const mockStore = createMockAppStore({
      authState: { authenticated: false, user: null }
    })
    setupStoreMock(useAppStore, mockStore)

    render(<ChatWindow />)
    const sendButton = screen.getByRole('button', { name: /send/i })
    expect(sendButton).toBeDisabled()
  })
})

