import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TitleBar } from '../../renderer/components/TitleBar'
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

beforeEach(() => {
  mockApi = setupMockApi()
  mockStore = createMockAppStore()
  setupStoreMock(useAppStore, mockStore)
})

describe('TitleBar — Smoke', () => {
  it('tb-1: renders without crashing', () => {
    render(<TitleBar />)
    expect(screen.getByRole('button', { name: /open menu/i })).toBeInTheDocument()
  })

  it('tb-2: minimize button calls minimizeWindow', async () => {
    const user = userEvent.setup()
    render(<TitleBar />)

    await user.click(screen.getByRole('button', { name: /minimize/i }))
    expect(mockApi.minimizeWindow).toHaveBeenCalled()
  })

  it('tb-3: maximize button calls maximizeWindow', async () => {
    const user = userEvent.setup()
    render(<TitleBar />)

    await user.click(screen.getByRole('button', { name: /maximize/i }))
    expect(mockApi.maximizeWindow).toHaveBeenCalled()
  })

  it('tb-4: close button calls closeWindow', async () => {
    const user = userEvent.setup()
    render(<TitleBar />)

    await user.click(screen.getByRole('button', { name: /close/i }))
    expect(mockApi.closeWindow).toHaveBeenCalled()
  })

  it('tb-5: maximize button shows "Restore" label when window is maximized', async () => {
    mockApi.isWindowMaximized.mockResolvedValue(true)
    render(<TitleBar />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument()
    })
  })
})

describe('TitleBar — Hamburger menu', () => {
  it('tb-6: hamburger opens the menu dropdown', async () => {
    const user = userEvent.setup()
    render(<TitleBar />)

    await user.click(screen.getByRole('button', { name: /open menu/i }))
    expect(screen.getByText('File')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('View')).toBeInTheDocument()
    expect(screen.getByText('Window')).toBeInTheDocument()
    expect(screen.getByText('Help')).toBeInTheDocument()
  })

  it('tb-7: hovering File section reveals its items', async () => {
    const user = userEvent.setup()
    render(<TitleBar />)

    await user.click(screen.getByRole('button', { name: /open menu/i }))
    fireEvent.mouseEnter(screen.getByText('File'))

    expect(screen.getByText('New Chat')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Quit')).toBeInTheDocument()
  })

  it('tb-8: clicking "New Chat" calls newChat and closes menu', async () => {
    const user = userEvent.setup()
    render(<TitleBar />)

    await user.click(screen.getByRole('button', { name: /open menu/i }))
    fireEvent.mouseEnter(screen.getByText('File'))
    await user.click(screen.getByText('New Chat'))

    expect(mockStore.newChat).toHaveBeenCalled()
    expect(screen.queryByText('Settings')).not.toBeInTheDocument()
  })

  it('tb-9: clicking "Settings" opens settings panel', async () => {
    const user = userEvent.setup()
    render(<TitleBar />)

    await user.click(screen.getByRole('button', { name: /open menu/i }))
    fireEvent.mouseEnter(screen.getByText('File'))
    await user.click(screen.getByText('Settings'))

    expect(mockStore.setShowSettings).toHaveBeenCalledWith(true)
  })

  it('tb-10: hovering Edit section reveals edit actions', async () => {
    const user = userEvent.setup()
    render(<TitleBar />)

    await user.click(screen.getByRole('button', { name: /open menu/i }))
    fireEvent.mouseEnter(screen.getByText('Edit'))

    expect(screen.getByText('Undo')).toBeInTheDocument()
    expect(screen.getByText('Copy')).toBeInTheDocument()
    expect(screen.getByText('Paste')).toBeInTheDocument()
  })

  it('tb-11: clicking "Copy" calls editAction with "copy"', async () => {
    const user = userEvent.setup()
    render(<TitleBar />)

    await user.click(screen.getByRole('button', { name: /open menu/i }))
    fireEvent.mouseEnter(screen.getByText('Edit'))
    await user.click(screen.getByText('Copy'))

    expect(mockApi.editAction).toHaveBeenCalledWith('copy')
  })

  it('tb-12: hovering View section reveals zoom controls', async () => {
    const user = userEvent.setup()
    render(<TitleBar />)

    await user.click(screen.getByRole('button', { name: /open menu/i }))
    fireEvent.mouseEnter(screen.getByText('View'))

    expect(screen.getByText('Zoom In')).toBeInTheDocument()
    expect(screen.getByText('Zoom Out')).toBeInTheDocument()
    expect(screen.getByText('Reset Zoom')).toBeInTheDocument()
  })

  it('tb-13: clicking "Zoom In" calls zoomIn', async () => {
    const user = userEvent.setup()
    render(<TitleBar />)

    await user.click(screen.getByRole('button', { name: /open menu/i }))
    fireEvent.mouseEnter(screen.getByText('View'))
    await user.click(screen.getByText('Zoom In'))

    expect(mockApi.zoomIn).toHaveBeenCalled()
  })

  it('tb-14: hovering Help section shows About and Check for Updates', async () => {
    const user = userEvent.setup()
    render(<TitleBar />)

    await user.click(screen.getByRole('button', { name: /open menu/i }))
    fireEvent.mouseEnter(screen.getByText('Help'))

    expect(screen.getByText('About')).toBeInTheDocument()
    expect(screen.getByText('Check for Updates')).toBeInTheDocument()
  })

  it('tb-15: clicking "About" shows version toast', async () => {
    const user = userEvent.setup()
    render(<TitleBar />)

    await user.click(screen.getByRole('button', { name: /open menu/i }))
    fireEvent.mouseEnter(screen.getByText('Help'))
    await user.click(screen.getByText('About'))

    await waitFor(() => {
      expect(mockApi.getVersion).toHaveBeenCalled()
      expect(mockStore.addToast).toHaveBeenCalledWith(
        expect.stringContaining('0.1.0'),
        'info'
      )
    })
  })

  it('tb-16: active agent badge is shown when an agent is active', () => {
    mockStore = createMockAppStore({
      agents: [{ id: 'a1', name: 'Code Helper', icon: '🧑‍💻' }],
      activeAgentId: 'a1'
    })
    setupStoreMock(useAppStore, mockStore)

    render(<TitleBar />)
    expect(screen.getByText(/Code Helper/)).toBeInTheDocument()
  })

  it('tb-17: no agent badge when no agent is active', () => {
    render(<TitleBar />)
    expect(screen.queryByText(/Code Helper/)).not.toBeInTheDocument()
  })
})

describe('TitleBar — Directory breadcrumb', () => {
  it('tb-18: breadcrumb not shown when rootDirectory is empty', () => {
    mockStore = createMockAppStore({
      agents: [{ id: 'a1', name: 'Code Helper', icon: '🧑‍💻', rootDirectory: '' }],
      activeAgentId: 'a1'
    })
    setupStoreMock(useAppStore, mockStore)

    render(<TitleBar />)
    expect(screen.queryByRole('button', { name: /change directory/i })).not.toBeInTheDocument()
  })

  it('tb-19: breadcrumb shows last two path segments when rootDirectory is set', () => {
    mockStore = createMockAppStore({
      agents: [{ id: 'a1', name: 'Code Helper', icon: '🧑‍💻', rootDirectory: 'C:\\Users\\julian\\project\\src' }],
      activeAgentId: 'a1'
    })
    setupStoreMock(useAppStore, mockStore)

    render(<TitleBar />)
    expect(screen.getByRole('button', { name: /change directory/i })).toHaveTextContent('…/project/src')
  })

  it('tb-20: clicking breadcrumb opens DirectoryPicker', async () => {
    const user = userEvent.setup()
    mockStore = createMockAppStore({
      agents: [{ id: 'a1', name: 'Code Helper', icon: '🧑‍💻', rootDirectory: 'C:\\Users\\julian\\project\\src' }],
      activeAgentId: 'a1'
    })
    setupStoreMock(useAppStore, mockStore)

    render(<TitleBar />)
    await user.click(screen.getByRole('button', { name: /change directory/i }))

    expect(await screen.findByRole('dialog', { name: /directory picker/i })).toBeInTheDocument()
  })

  it('tb-21: pencil icon is shown when an agent is active and calls openEditAgent', async () => {
    const user = userEvent.setup()
    mockStore = createMockAppStore({
      agents: [{ id: 'a1', name: 'Code Helper', icon: '🧑‍💻', rootDirectory: 'C:\\Users\\julian\\project\\src' }],
      activeAgentId: 'a1'
    })
    setupStoreMock(useAppStore, mockStore)

    render(<TitleBar />)
    await user.click(screen.getByRole('button', { name: /edit agent/i }))

    expect(mockStore.openEditAgent).toHaveBeenCalledWith('a1')
  })
})
