import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sidebar } from '../../renderer/components/Sidebar'
import { setupMockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn()
}))

vi.mock('../../renderer/store/app-store', () => ({
  useAppStore
}))

let mockStore: ReturnType<typeof createMockAppStore>

beforeEach(() => {
  setupMockApi()
})

describe('Sidebar — Loading States', () => {
  it('shows conversation skeletons when loading and no conversations', () => {
    mockStore = createMockAppStore({
      conversationsLoading: true,
      conversations: [],
      authState: { authenticated: true, user: { login: 'test', name: 'Test', avatar_url: '' } }
    })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.getByLabelText('Loading conversations')).toBeInTheDocument()
  })

  it('shows conversations list when loaded', () => {
    mockStore = createMockAppStore({
      conversationsLoading: false,
      conversations: [{
        id: 'c1',
        title: 'My Chat',
        agent_id: null,
        created_at: Date.now(),
        updated_at: Date.now()
      }],
      authState: { authenticated: true, user: { login: 'test', name: 'Test', avatar_url: '' } }
    })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.queryByLabelText('Loading conversations')).not.toBeInTheDocument()
    expect(screen.getByText('My Chat')).toBeInTheDocument()
  })

  it('shows empty state when loaded with no conversations', () => {
    mockStore = createMockAppStore({
      conversationsLoading: false,
      conversations: [],
      authState: { authenticated: true, user: { login: 'test', name: 'Test', avatar_url: '' } }
    })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.getByText('No conversations yet')).toBeInTheDocument()
  })

  it('shows agent skeletons when loading', () => {
    mockStore = createMockAppStore({
      agentsLoading: true,
      agents: [],
      authState: { authenticated: true, user: { login: 'test', name: 'Test', avatar_url: '' } }
    })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.getByLabelText('Loading agents')).toBeInTheDocument()
  })

  it('shows agents list when loaded', () => {
    mockStore = createMockAppStore({
      agentsLoading: false,
      agents: [{ id: 'a1', name: 'My Agent', icon: '🤖' }],
      authState: { authenticated: true, user: { login: 'test', name: 'Test', avatar_url: '' } }
    })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.queryByLabelText('Loading agents')).not.toBeInTheDocument()
    expect(screen.getByText('🤖 My Agent')).toBeInTheDocument()
  })

  it('shows auth loading state on sign-in button', () => {
    mockStore = createMockAppStore({
      authLoading: true,
      authState: { authenticated: false, user: null }
    })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.getByText('⏳ Signing in...')).toBeInTheDocument()
  })

  it('shows sign-in button when not loading', () => {
    mockStore = createMockAppStore({
      authLoading: false,
      authState: { authenticated: false, user: null }
    })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.getByText('🔑 Sign in with GitHub')).toBeInTheDocument()
  })
})
