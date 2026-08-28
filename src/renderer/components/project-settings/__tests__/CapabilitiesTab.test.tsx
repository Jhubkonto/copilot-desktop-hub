import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CapabilitiesTab } from '../CapabilitiesTab'
import { createMockAppStore, setupStoreMock } from '../../../../test/mocks/store'
import { setupMockApi } from '../../../../test/mocks/api'
import type { ConversationCapabilityProfile, McpServerWithStatus, SkillConfig } from '../../../../shared/types'

const { useAppStore } = vi.hoisted(() => ({ useAppStore: vi.fn() }))
vi.mock('../../../store/app-store', () => ({ useAppStore }))

let mockStore: ReturnType<typeof createMockAppStore>
let mockApi: ReturnType<typeof setupMockApi>

const SKILLS = [
  { id: 'audit', name: 'Audit ThingsBoard', description: 'Inspect an instance', icon: '🔍' },
  { id: 'release', name: 'Cut a release', description: 'Tag and publish', icon: '🚀' },
] as unknown as SkillConfig[]

const SERVERS = [
  { id: 'browser', name: 'Playwright', status: 'connected', toolCount: 12 },
  { id: 'thingsboard', name: 'ThingsBoard', status: 'disconnected', toolCount: 0 },
] as unknown as McpServerWithStatus[]

beforeEach(() => {
  vi.clearAllMocks()
  mockApi = setupMockApi()
  mockApi.listMcpServers.mockResolvedValue(SERVERS)
  mockStore = createMockAppStore({ skills: SKILLS })
  setupStoreMock(useAppStore, mockStore)
})

async function renderTab(profile: Pick<ConversationCapabilityProfile, 'skillIds' | 'mcp' | 'builtInTools'>) {
  mockApi.getProjectCapabilities.mockResolvedValue({ version: 1, ...profile })
  const view = render(<CapabilitiesTab projectId="proj-1" />)
  await waitFor(() => expect(screen.getByText('Skills')).toBeInTheDocument())
  return view
}

describe('CapabilitiesTab', () => {
  it('shows the project grants that chats in this project inherit', async () => {
    await renderTab({ skillIds: ['audit'], mcp: [{ serverId: 'browser', trust: 'always-ask' }] })

    expect(screen.getByRole('checkbox', { name: /Grant Playwright/ })).toBeChecked()
    expect(screen.getByRole('combobox', { name: /Approval level for Playwright/ })).toHaveValue('always-ask')
    expect(screen.getByText(/Audit ThingsBoard/).closest('label')?.querySelector('input')).toBeChecked()
  })

  it('revokes a skill and loosens MCP trust in a single replace-semantics save', async () => {
    const user = userEvent.setup()
    await renderTab({ skillIds: ['audit'], mcp: [{ serverId: 'browser', trust: 'always-ask' }] })

    await user.click(screen.getByText(/Audit ThingsBoard/))
    await user.selectOptions(screen.getByRole('combobox', { name: /Approval level for Playwright/ }), 'auto')
    await user.click(screen.getByRole('button', { name: /Save changes/ }))

    await waitFor(() => expect(mockApi.setProjectCapabilities).toHaveBeenCalledWith('proj-1', {
      version: 1,
      skillIds: [],
      mcp: [{ serverId: 'browser', trust: 'auto' }],
    }))
  })

  it('confirms before revoking an MCP grant, since every chat in the project loses it', async () => {
    const user = userEvent.setup()
    await renderTab({ skillIds: [], mcp: [{ serverId: 'browser', trust: 'auto' }] })

    await user.click(screen.getByRole('checkbox', { name: /Grant Playwright/ }))
    expect(screen.getByText(/Revoke for every chat in this project/)).toBeInTheDocument()
    expect(mockApi.setProjectCapabilities).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Revoke' }))
    await user.click(screen.getByRole('button', { name: /Save changes/ }))

    await waitFor(() => expect(mockApi.setProjectCapabilities).toHaveBeenCalledWith('proj-1', {
      version: 1, skillIds: [], mcp: [],
    }))
  })

  it('surfaces entries whose skill or server no longer exists instead of dropping them on save', async () => {
    const user = userEvent.setup()
    await renderTab({ skillIds: ['deleted-skill'], mcp: [] })

    expect(screen.getByText('Skill — deleted-skill')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save changes/ })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(screen.getByRole('button', { name: /Save changes/ }))

    await waitFor(() => expect(mockApi.setProjectCapabilities).toHaveBeenCalledWith('proj-1', {
      version: 1, skillIds: [], mcp: [],
    }))
  })

  it('keeps Save disabled until something actually changes', async () => {
    await renderTab({ skillIds: ['audit'], mcp: [] })
    expect(screen.getByRole('button', { name: /Save changes/ })).toBeDisabled()
  })

  it('saves a project-wide disable for a built-in tool', async () => {
    const user = userEvent.setup()
    await renderTab({ skillIds: [], mcp: [] })

    await user.click(screen.getByRole('checkbox', { name: /Disable Terminal for this project/ }))
    await user.click(screen.getByRole('button', { name: /Save changes/ }))

    await waitFor(() => expect(mockApi.setProjectCapabilities).toHaveBeenCalledWith('proj-1', {
      version: 1,
      skillIds: [],
      mcp: [],
      builtInTools: { terminal: { enabled: false, approval: 'disabled' } },
    }))
  })

  it('reports a rejected save instead of showing it as applied', async () => {
    const user = userEvent.setup()
    mockApi.setProjectCapabilities.mockRejectedValue(new Error('MCP server not found: browser'))
    await renderTab({ skillIds: [], mcp: [] })

    await user.click(screen.getByText(/Audit ThingsBoard/))
    await user.click(screen.getByRole('button', { name: /Save changes/ }))

    await waitFor(() => expect(mockStore.addToast).toHaveBeenCalledWith('MCP server not found: browser', 'error'))
    expect(screen.getByRole('button', { name: /Save changes/ })).toBeEnabled()
  })
})
