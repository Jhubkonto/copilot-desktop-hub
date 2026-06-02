import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sidebar } from '../../renderer/components/Sidebar'
import { setupMockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn()
}))

vi.mock('../../renderer/store/app-store', () => ({ useAppStore }))

let mockStore: ReturnType<typeof createMockAppStore>

beforeEach(() => {
  setupMockApi()
})

describe('Sidebar loading states', () => {
  it('shows conversation skeletons when loading', () => {
    mockStore = createMockAppStore({ conversationsLoading: true, conversations: [] })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.getByLabelText('Loading conversations')).toBeInTheDocument()
  })

  it('shows empty state when there are no conversations', () => {
    mockStore = createMockAppStore({ conversationsLoading: false, conversations: [] })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.getByText('No conversations yet')).toBeInTheDocument()
  })

  it('shows BYOK footer when no provider is configured', () => {
    mockStore = createMockAppStore({ authState: { authenticated: false, mode: 'none', user: null } })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.getByText('No provider configured')).toBeInTheDocument()
    expect(screen.getByText('Add an API key in Settings')).toBeInTheDocument()
  })
})
