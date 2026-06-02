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
const user = userEvent.setup()

beforeEach(() => {
  setupMockApi()
})

describe('Sidebar', () => {
  it('shows provider-configured footer in BYOK mode', () => {
    mockStore = createMockAppStore({ authState: { authenticated: true, mode: 'byok', user: null } })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.getByText('API keys configured')).toBeInTheDocument()
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
})
