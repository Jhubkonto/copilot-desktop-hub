import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { McpServerPanel } from '../../renderer/components/McpServerPanel'
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

const SAMPLE_SERVERS = [
  {
    id: 'srv-1',
    name: 'GitHub MCP',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: 'test' },
    cwd: undefined,
    enabled: true,
    status: 'connected' as const,
    toolCount: 5
  },
  {
    id: 'srv-2',
    name: 'Broken Server',
    command: 'node',
    args: ['server.js'],
    env: {},
    cwd: '/tmp',
    enabled: false,
    status: 'error' as const,
    error: 'Connection refused',
    toolCount: 0
  }
]

beforeEach(() => {
  mockApi = setupMockApi()
  mockApi.listMcpServers = vi.fn().mockResolvedValue(SAMPLE_SERVERS)
  mockStore = createMockAppStore({ showMcpPanel: true })
  setupStoreMock(useAppStore, mockStore)
})

describe('McpServerPanel — Rendering', () => {
  it('does not render when not visible', () => {
    mockStore = createMockAppStore({ showMcpPanel: false })
    setupStoreMock(useAppStore, mockStore)

    const { container } = render(<McpServerPanel />)
    expect(container.innerHTML).toBe('')
  })

  it('renders server list with status indicators', async () => {
    render(<McpServerPanel />)

    await waitFor(() => {
      expect(screen.getByText('GitHub MCP')).toBeInTheDocument()
      expect(screen.getByText('Broken Server')).toBeInTheDocument()
    })
  })

  it('shows tool count for connected servers', async () => {
    render(<McpServerPanel />)

    await waitFor(() => {
      expect(screen.getByText('5 tools')).toBeInTheDocument()
    })
  })

  it('shows error message for errored servers', async () => {
    render(<McpServerPanel />)

    await waitFor(() => {
      expect(screen.getByText('Connection refused')).toBeInTheDocument()
    })
  })

  it('shows empty state when no servers', async () => {
    mockApi.listMcpServers = vi.fn().mockResolvedValue([])
    render(<McpServerPanel />)

    await waitFor(() => {
      expect(screen.getByText(/No MCP servers configured/)).toBeInTheDocument()
    })
  })
})

describe('McpServerPanel — CRUD Operations', () => {
  it('add server button opens form', async () => {
    mockApi.listMcpServers = vi.fn().mockResolvedValue([])
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('Add MCP Server')).toBeInTheDocument())
    await user.click(screen.getByText('Add MCP Server'))

    expect(screen.getByPlaceholderText('My MCP Server')).toBeInTheDocument()
    expect(screen.getByText('Add Server')).toBeInTheDocument()
  })

  it('save new server calls addMcpServer', async () => {
    mockApi.listMcpServers = vi.fn().mockResolvedValue([])
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('Add MCP Server')).toBeInTheDocument())
    await user.click(screen.getByText('Add MCP Server'))

    await user.type(screen.getByPlaceholderText('My MCP Server'), 'Test Server')
    await user.type(screen.getByPlaceholderText('npx'), 'node')
    await user.click(screen.getByText('Add Server'))

    expect(mockApi.addMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Test Server', command: 'node' })
    )
  })

  it('delete server calls removeMcpServer', async () => {
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())

    const removeButtons = screen.getAllByTitle('Remove')
    await user.click(removeButtons[0])

    expect(mockApi.removeMcpServer).toHaveBeenCalledWith('srv-1')
  })

  it('toggle server calls updateMcpServer with enabled flag', async () => {
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())

    const onButton = screen.getByText('ON')
    await user.click(onButton)

    expect(mockApi.updateMcpServer).toHaveBeenCalledWith('srv-1', { enabled: false })
  })

  it('restart server calls restartMcpServer', async () => {
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())

    const restartButtons = screen.getAllByTitle('Restart')
    await user.click(restartButtons[0])

    expect(mockApi.restartMcpServer).toHaveBeenCalledWith('srv-1')
  })
})

describe('McpServerPanel — Error Handling', () => {
  it('shows toast on save failure', async () => {
    mockApi.addMcpServer = vi.fn().mockRejectedValue(new Error('fail'))
    mockApi.listMcpServers = vi.fn().mockResolvedValue([])
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('Add MCP Server')).toBeInTheDocument())
    await user.click(screen.getByText('Add MCP Server'))

    await user.type(screen.getByPlaceholderText('My MCP Server'), 'Test')
    await user.type(screen.getByPlaceholderText('npx'), 'node')
    await user.click(screen.getByText('Add Server'))

    expect(mockStore.addToast).toHaveBeenCalledWith('Failed to add server', 'error')
  })

  it('shows toast on delete failure', async () => {
    mockApi.removeMcpServer = vi.fn().mockRejectedValue(new Error('fail'))
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())
    await user.click(screen.getAllByTitle('Remove')[0])

    expect(mockStore.addToast).toHaveBeenCalledWith('Failed to remove server', 'error')
  })

  it('shows toast on restart failure', async () => {
    mockApi.restartMcpServer = vi.fn().mockRejectedValue(new Error('fail'))
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())
    await user.click(screen.getAllByTitle('Restart')[0])

    expect(mockStore.addToast).toHaveBeenCalledWith('Failed to restart server', 'error')
  })

  it('shows toast on toggle failure', async () => {
    mockApi.updateMcpServer = vi.fn().mockRejectedValue(new Error('fail'))
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())
    await user.click(screen.getByText('ON'))

    expect(mockStore.addToast).toHaveBeenCalledWith('Failed to toggle server', 'error')
  })
})

describe('McpServerPanel — JSON Import', () => {
  it('switches to JSON import mode', async () => {
    render(<McpServerPanel />)

    await user.click(screen.getByText('Import JSON'))
    expect(screen.getByText(/Paste a Claude Desktop/)).toBeInTheDocument()
  })

  it('shows error for invalid JSON', async () => {
    render(<McpServerPanel />)

    await user.click(screen.getByText('Import JSON'))
    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'not json')
    await user.click(screen.getByText('Import Servers'))

    expect(screen.getByText('Invalid JSON')).toBeInTheDocument()
  })

  it('shows error for missing mcpServers key', async () => {
    render(<McpServerPanel />)

    await user.click(screen.getByText('Import JSON'))
    const textarea = screen.getByRole('textbox')
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(textarea, { target: { value: '{"other": {}}' } })
    await user.click(screen.getByText('Import Servers'))

    expect(screen.getByText(/Expected.*mcpServers/)).toBeInTheDocument()
  })

  it('close button calls setShowMcpPanel(false)', async () => {
    render(<McpServerPanel />)

    await user.click(screen.getByLabelText('Close MCP panel'))
    expect(mockStore.setShowMcpPanel).toHaveBeenCalledWith(false)
  })
})
