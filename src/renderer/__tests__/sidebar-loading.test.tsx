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
  it('renders nav buttons for Projects, Agents, and Chats', () => {
    mockStore = createMockAppStore({})
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.getByLabelText('Open projects')).toBeInTheDocument()
    expect(screen.getByLabelText('Open agents')).toBeInTheDocument()
    expect(screen.getByLabelText('Open chat history')).toBeInTheDocument()
  })

  it('highlights the active section pane button', () => {
    mockStore = createMockAppStore({ activeSectionPane: 'agents' })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    const agentsBtn = screen.getByLabelText('Open agents')
    expect(agentsBtn.className).toContain('bg-gray-100')
  })

  it('hides the status strip when no CLI or API provider is configured', () => {
    mockStore = createMockAppStore({ authState: { authenticated: false, mode: 'none', user: null } })
    setupStoreMock(useAppStore, mockStore)

    render(<Sidebar />)
    expect(screen.queryByLabelText('Available CLI tools and configured API providers')).not.toBeInTheDocument()
  })
})
