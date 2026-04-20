import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setupMockApi, type MockApi } from '../../test/mocks/api'
import { useAppStore } from '../../renderer/store/app-store'

let mockApi: MockApi

// Reset store to initial state before each test
const initialState = useAppStore.getState()

beforeEach(() => {
  mockApi = setupMockApi()
  useAppStore.setState(initialState, true)
  // Mock crypto.randomUUID for toast ID generation
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Auth Actions ──

describe('Store — Auth Actions', () => {
  it('checkAuth updates authState from IPC', async () => {
    const authResult = { authenticated: true, user: { login: 'user1', avatar_url: 'url', name: 'User' } }
    mockApi.authStatus.mockResolvedValue(authResult)

    await useAppStore.getState().checkAuth()

    expect(useAppStore.getState().authState).toEqual(authResult)
  })

  it('checkCli updates cliState from IPC', async () => {
    const cliResult = { installed: true, path: '/usr/bin/copilot', version: '1.0.0' }
    mockApi.cliStatus.mockResolvedValue(cliResult)

    await useAppStore.getState().checkCli()

    expect(useAppStore.getState().cliState).toEqual(cliResult)
  })

  it('login success sets authState and shows toast', async () => {
    mockApi.authLogin.mockResolvedValue({
      success: true,
      user: { login: 'testuser', avatar_url: 'url', name: 'Test' }
    })

    await useAppStore.getState().login()

    const state = useAppStore.getState()
    expect(state.authState.authenticated).toBe(true)
    expect(state.authState.user?.login).toBe('testuser')
    expect(state.authLoading).toBe(false)
    expect(state.deviceCode).toBeNull()
    expect(state.toasts).toHaveLength(1)
    expect(state.toasts[0].type).toBe('success')
  })

  it('login sets authLoading to true during request', async () => {
    let resolveLogin: (value: unknown) => void
    mockApi.authLogin.mockReturnValue(new Promise((r) => { resolveLogin = r }))

    const loginPromise = useAppStore.getState().login()
    expect(useAppStore.getState().authLoading).toBe(true)

    resolveLogin!({ success: true, user: { login: 'u', avatar_url: '', name: '' } })
    await loginPromise

    expect(useAppStore.getState().authLoading).toBe(false)
  })

  it('login error shows error toast and does not authenticate', async () => {
    mockApi.authLogin.mockResolvedValue({ error: 'Something failed' })

    await useAppStore.getState().login()

    const state = useAppStore.getState()
    expect(state.authState.authenticated).toBe(false)
    expect(state.toasts).toHaveLength(1)
    expect(state.toasts[0].type).toBe('error')
    expect(state.toasts[0].message).toBe('Something failed')
  })

  it('login device-code-expired shows friendly message', async () => {
    mockApi.authLogin.mockResolvedValue({ error: 'Device code expired' })

    await useAppStore.getState().login()

    const state = useAppStore.getState()
    expect(state.toasts[0].message).toBe('Login timed out. Please try again.')
  })

  it('login exception shows generic error', async () => {
    mockApi.authLogin.mockRejectedValue(new Error('network error'))

    await useAppStore.getState().login()

    const state = useAppStore.getState()
    expect(state.authState.authenticated).toBe(false)
    expect(state.toasts[0].message).toBe('Login failed. Please try again.')
    expect(state.authLoading).toBe(false)
  })

  it('logout success clears auth state', async () => {
    useAppStore.setState({
      authState: { authenticated: true, user: { login: 'u', avatar_url: '', name: '' } }
    })
    mockApi.authLogout.mockResolvedValue(undefined)

    await useAppStore.getState().logout()

    expect(useAppStore.getState().authState.authenticated).toBe(false)
    expect(useAppStore.getState().authState.user).toBeNull()
  })

  it('logout error shows toast and keeps auth state', async () => {
    useAppStore.setState({
      authState: { authenticated: true, user: { login: 'u', avatar_url: '', name: '' } }
    })
    mockApi.authLogout.mockResolvedValue({ error: 'fail' })

    await useAppStore.getState().logout()

    expect(useAppStore.getState().authState.authenticated).toBe(true)
    expect(useAppStore.getState().toasts[0].type).toBe('error')
  })

  it('setDeviceCode updates deviceCode', () => {
    useAppStore.getState().setDeviceCode({ userCode: 'ABC', verificationUri: 'https://example.com' })
    expect(useAppStore.getState().deviceCode).toEqual({ userCode: 'ABC', verificationUri: 'https://example.com' })

    useAppStore.getState().setDeviceCode(null)
    expect(useAppStore.getState().deviceCode).toBeNull()
  })
})

// ── Conversation Actions ──

describe('Store — Conversation Actions', () => {
  const mockConversations = [
    { id: 'c1', agent_id: null, title: 'Chat 1', created_at: 1000, updated_at: 1000 },
    { id: 'c2', agent_id: null, title: 'Chat 2', created_at: 2000, updated_at: 2000 }
  ]

  it('loadConversations populates conversations from IPC', async () => {
    mockApi.listConversations.mockResolvedValue(mockConversations)

    await useAppStore.getState().loadConversations()

    expect(useAppStore.getState().conversations).toEqual(mockConversations)
    expect(useAppStore.getState().conversationsLoading).toBe(false)
  })

  it('loadConversations sets loading flag during request', async () => {
    let resolve: (v: unknown) => void
    mockApi.listConversations.mockReturnValue(new Promise((r) => { resolve = r }))

    const promise = useAppStore.getState().loadConversations()
    expect(useAppStore.getState().conversationsLoading).toBe(true)

    resolve!(mockConversations)
    await promise

    expect(useAppStore.getState().conversationsLoading).toBe(false)
  })

  it('loadConversations error shows toast', async () => {
    mockApi.listConversations.mockResolvedValue({ error: 'db error' })

    await useAppStore.getState().loadConversations()

    expect(useAppStore.getState().conversations).toEqual([])
    expect(useAppStore.getState().toasts[0].type).toBe('error')
  })

  it('selectConversation sets currentConversationId', () => {
    useAppStore.getState().selectConversation('c1')
    expect(useAppStore.getState().currentConversationId).toBe('c1')
  })

  it('deleteConversation removes conversation and reloads', async () => {
    useAppStore.setState({ currentConversationId: 'c1', conversations: mockConversations })
    mockApi.deleteConversation.mockResolvedValue(true)
    mockApi.listConversations.mockResolvedValue([mockConversations[1]])

    await useAppStore.getState().deleteConversation('c1')

    expect(useAppStore.getState().currentConversationId).toBeNull()
    expect(mockApi.listConversations).toHaveBeenCalled()
  })

  it('deleteConversation does not reset currentId if different conv deleted', async () => {
    useAppStore.setState({ currentConversationId: 'c1', conversations: mockConversations })
    mockApi.deleteConversation.mockResolvedValue(true)
    mockApi.listConversations.mockResolvedValue([mockConversations[0]])

    await useAppStore.getState().deleteConversation('c2')

    expect(useAppStore.getState().currentConversationId).toBe('c1')
  })

  it('deleteConversation error shows toast', async () => {
    mockApi.deleteConversation.mockResolvedValue({ error: 'fail' })

    await useAppStore.getState().deleteConversation('c1')

    expect(useAppStore.getState().toasts[0].type).toBe('error')
  })

  it('conversationCreated sets id and reloads conversations', async () => {
    mockApi.listConversations.mockResolvedValue(mockConversations)

    await useAppStore.getState().conversationCreated('c1')

    expect(useAppStore.getState().currentConversationId).toBe('c1')
    expect(mockApi.listConversations).toHaveBeenCalled()
  })

  it('newChat clears currentConversationId', () => {
    useAppStore.setState({ currentConversationId: 'c1' })
    useAppStore.getState().newChat()
    expect(useAppStore.getState().currentConversationId).toBeNull()
  })
})

// ── Agent Actions ──

describe('Store — Agent Actions', () => {
  const mockAgents = [
    { id: 'a1', name: 'Agent 1', icon: '🤖', systemPrompt: '', model: 'gpt-4', temperature: 0.7, maxTokens: 4096, contextDirectories: [], contextFiles: [], mcpServers: [], agenticMode: false, tools: { fileEdit: false, terminal: false, webFetch: false }, responseFormat: 'markdown' },
    { id: 'a2', name: 'Agent 2', icon: '📝', systemPrompt: '', model: 'gpt-4', temperature: 0.7, maxTokens: 4096, contextDirectories: [], contextFiles: [], mcpServers: [], agenticMode: false, tools: { fileEdit: false, terminal: false, webFetch: false }, responseFormat: 'markdown' }
  ]

  it('loadAgents populates agents from IPC', async () => {
    mockApi.listAgents.mockResolvedValue(mockAgents)

    await useAppStore.getState().loadAgents()

    expect(useAppStore.getState().agents).toEqual(mockAgents)
    expect(useAppStore.getState().agentsLoading).toBe(false)
  })

  it('loadAgents error shows toast', async () => {
    mockApi.listAgents.mockResolvedValue({ error: 'fail' })

    await useAppStore.getState().loadAgents()

    expect(useAppStore.getState().toasts[0].type).toBe('error')
  })

  it('selectAgent sets activeAgentId', () => {
    useAppStore.getState().selectAgent('a1')
    expect(useAppStore.getState().activeAgentId).toBe('a1')

    useAppStore.getState().selectAgent(null)
    expect(useAppStore.getState().activeAgentId).toBeNull()
  })

  it('openCreateAgent opens panel with no editing id', () => {
    useAppStore.getState().openCreateAgent()
    expect(useAppStore.getState().showAgentPanel).toBe(true)
    expect(useAppStore.getState().editingAgentId).toBeNull()
  })

  it('openEditAgent opens panel with editing id', () => {
    useAppStore.getState().openEditAgent('a1')
    expect(useAppStore.getState().showAgentPanel).toBe(true)
    expect(useAppStore.getState().editingAgentId).toBe('a1')
  })

  it('closeAgentPanel hides panel', () => {
    useAppStore.setState({ showAgentPanel: true })
    useAppStore.getState().closeAgentPanel()
    expect(useAppStore.getState().showAgentPanel).toBe(false)
  })

  it('saveAgent creates new agent when no editingAgentId', async () => {
    const newAgent = { ...mockAgents[0], id: '' }
    mockApi.createAgent.mockResolvedValue({ id: 'new-id' })
    mockApi.listAgents.mockResolvedValue(mockAgents)

    await useAppStore.getState().saveAgent(newAgent)

    expect(mockApi.createAgent).toHaveBeenCalledWith(newAgent)
    expect(useAppStore.getState().showAgentPanel).toBe(false)
    expect(useAppStore.getState().toasts.some((t) => t.type === 'success')).toBe(true)
  })

  it('saveAgent updates existing agent when editingAgentId is set', async () => {
    useAppStore.setState({ editingAgentId: 'a1' })
    mockApi.updateAgent.mockResolvedValue(true)
    mockApi.listAgents.mockResolvedValue(mockAgents)

    await useAppStore.getState().saveAgent(mockAgents[0])

    expect(mockApi.updateAgent).toHaveBeenCalledWith('a1', mockAgents[0])
    expect(useAppStore.getState().showAgentPanel).toBe(false)
  })

  it('saveAgent error shows toast and keeps panel open', async () => {
    useAppStore.setState({ editingAgentId: 'a1', showAgentPanel: true })
    mockApi.updateAgent.mockResolvedValue({ error: 'fail' })

    await useAppStore.getState().saveAgent(mockAgents[0])

    expect(useAppStore.getState().toasts[0].type).toBe('error')
    expect(useAppStore.getState().showAgentPanel).toBe(true)
  })

  it('deleteAgent removes agent and resets activeAgentId if active', async () => {
    useAppStore.setState({ activeAgentId: 'a1', agents: mockAgents })
    mockApi.deleteAgent.mockResolvedValue(true)
    mockApi.listAgents.mockResolvedValue([mockAgents[1]])

    await useAppStore.getState().deleteAgent('a1')

    expect(useAppStore.getState().activeAgentId).toBeNull()
    expect(useAppStore.getState().showAgentPanel).toBe(false)
    expect(useAppStore.getState().toasts.some((t) => t.type === 'success')).toBe(true)
  })

  it('deleteAgent does not reset activeAgentId if different agent deleted', async () => {
    useAppStore.setState({ activeAgentId: 'a1', agents: mockAgents })
    mockApi.deleteAgent.mockResolvedValue(true)
    mockApi.listAgents.mockResolvedValue([mockAgents[0]])

    await useAppStore.getState().deleteAgent('a2')

    expect(useAppStore.getState().activeAgentId).toBe('a1')
  })

  it('duplicateAgent calls IPC and reloads agents', async () => {
    mockApi.duplicateAgent.mockResolvedValue({ id: 'a3' })
    mockApi.listAgents.mockResolvedValue([...mockAgents, { ...mockAgents[0], id: 'a3' }])

    await useAppStore.getState().duplicateAgent('a1')

    expect(mockApi.duplicateAgent).toHaveBeenCalledWith('a1')
    expect(useAppStore.getState().toasts.some((t) => t.type === 'success')).toBe(true)
  })

  it('exportAgent calls IPC and shows toast', async () => {
    mockApi.exportAgent.mockResolvedValue(true)

    await useAppStore.getState().exportAgent('a1')

    expect(mockApi.exportAgent).toHaveBeenCalledWith('a1')
    expect(useAppStore.getState().toasts[0].type).toBe('success')
  })

  it('importAgent loads agents on success', async () => {
    mockApi.importAgent.mockResolvedValue({ id: 'imported' })
    mockApi.listAgents.mockResolvedValue(mockAgents)

    await useAppStore.getState().importAgent()

    expect(mockApi.listAgents).toHaveBeenCalled()
    expect(useAppStore.getState().toasts.some((t) => t.type === 'success')).toBe(true)
  })

  it('importAgent does nothing when user cancels (null result)', async () => {
    mockApi.importAgent.mockResolvedValue(null)

    await useAppStore.getState().importAgent()

    expect(mockApi.listAgents).not.toHaveBeenCalled()
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })
})

// ── UI Actions ──

describe('Store — UI Actions', () => {
  it('toggleTheme switches dark to light', () => {
    useAppStore.setState({ theme: 'dark' })
    useAppStore.getState().toggleTheme()
    expect(useAppStore.getState().theme).toBe('light')
    expect(mockApi.setTheme).toHaveBeenCalledWith('light')
  })

  it('toggleTheme switches light to dark', () => {
    useAppStore.setState({ theme: 'light' })
    useAppStore.getState().toggleTheme()
    expect(useAppStore.getState().theme).toBe('dark')
    expect(mockApi.setTheme).toHaveBeenCalledWith('dark')
  })

  it('toggleTerminal flips showTerminal', () => {
    expect(useAppStore.getState().showTerminal).toBe(false)
    useAppStore.getState().toggleTerminal()
    expect(useAppStore.getState().showTerminal).toBe(true)
    useAppStore.getState().toggleTerminal()
    expect(useAppStore.getState().showTerminal).toBe(false)
  })

  it('setShowMcpPanel sets showMcpPanel', () => {
    useAppStore.getState().setShowMcpPanel(true)
    expect(useAppStore.getState().showMcpPanel).toBe(true)
  })

  it('setShowSettings sets showSettings', () => {
    useAppStore.getState().setShowSettings(true)
    expect(useAppStore.getState().showSettings).toBe(true)
  })

  it('setShowOnboarding sets showOnboarding', () => {
    useAppStore.getState().setShowOnboarding(true)
    expect(useAppStore.getState().showOnboarding).toBe(true)
  })

  it('setUpdateAvailable sets updateAvailable', () => {
    useAppStore.getState().setUpdateAvailable({ version: '2.0.0' })
    expect(useAppStore.getState().updateAvailable).toEqual({ version: '2.0.0' })
  })

  it('setUpdateDownloaded sets updateDownloaded', () => {
    useAppStore.getState().setUpdateDownloaded(true)
    expect(useAppStore.getState().updateDownloaded).toBe(true)
  })
})

// ── Toast Actions ──

describe('Store — Toast Actions', () => {
  it('addToast pushes toast with generated id', () => {
    useAppStore.getState().addToast('Hello', 'info')

    const toasts = useAppStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toEqual({ id: 'test-uuid', message: 'Hello', type: 'info' })
  })

  it('addToast defaults to info type', () => {
    useAppStore.getState().addToast('Default type')

    expect(useAppStore.getState().toasts[0].type).toBe('info')
  })

  it('dismissToast removes toast by id', () => {
    useAppStore.setState({ toasts: [{ id: 't1', message: 'A', type: 'info' }, { id: 't2', message: 'B', type: 'error' }] })

    useAppStore.getState().dismissToast('t1')

    const toasts = useAppStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].id).toBe('t2')
  })
})

// ── Tool Approval Actions ──

describe('Store — Tool Approval Actions', () => {
  const mockRequest = {
    requestId: 'req-1',
    tool: 'file_edit',
    args: { path: '/test.ts' },
    description: 'Edit test.ts'
  }

  it('addToolApprovalRequest pushes request', () => {
    useAppStore.getState().addToolApprovalRequest(mockRequest)

    expect(useAppStore.getState().toolApprovalRequests).toHaveLength(1)
    expect(useAppStore.getState().toolApprovalRequests[0].requestId).toBe('req-1')
  })

  it('respondToToolApproval removes request from list', async () => {
    useAppStore.setState({ toolApprovalRequests: [mockRequest] })
    mockApi.respondToToolApproval.mockResolvedValue(undefined)

    await useAppStore.getState().respondToToolApproval('req-1', true, false)

    expect(useAppStore.getState().toolApprovalRequests).toHaveLength(0)
    expect(mockApi.respondToToolApproval).toHaveBeenCalledWith('req-1', true, false)
  })

  it('respondToToolApproval error shows toast', async () => {
    useAppStore.setState({ toolApprovalRequests: [mockRequest] })
    mockApi.respondToToolApproval.mockRejectedValue(new Error('fail'))

    await useAppStore.getState().respondToToolApproval('req-1', true, false)

    expect(useAppStore.getState().toasts[0].type).toBe('error')
  })
})

// ── Hydration ──

describe('Store — Hydration', () => {
  it('hydrate loads theme, auth, CLI, conversations, and agents', async () => {
    mockApi.getTheme.mockResolvedValue('light')
    mockApi.authStatus.mockResolvedValue({ authenticated: true, user: { login: 'u', avatar_url: '', name: '' } })
    mockApi.cliStatus.mockResolvedValue({ installed: true, path: '/bin', version: '1.0' })
    mockApi.getSetting.mockResolvedValue('true')
    mockApi.listConversations.mockResolvedValue([{ id: 'c1', agent_id: null, title: 'Chat', created_at: 1, updated_at: 1 }])
    mockApi.listAgents.mockResolvedValue([{ id: 'a1', name: 'Agent', icon: '🤖' }])

    await useAppStore.getState().hydrate()

    const state = useAppStore.getState()
    expect(state.theme).toBe('light')
    expect(state.authState.authenticated).toBe(true)
    expect(state.cliState?.installed).toBe(true)
    expect(state.conversations).toHaveLength(1)
    expect(state.agents).toHaveLength(1)
    expect(state.showOnboarding).toBe(false)
  })

  it('hydrate shows onboarding when not complete', async () => {
    mockApi.getSetting.mockResolvedValue(null)
    mockApi.listConversations.mockResolvedValue([])
    mockApi.listAgents.mockResolvedValue([])

    await useAppStore.getState().hydrate()

    expect(useAppStore.getState().showOnboarding).toBe(true)
  })

  it('hydrate defaults to dark theme on error', async () => {
    mockApi.getTheme.mockRejectedValue(new Error('fail'))
    mockApi.listConversations.mockResolvedValue([])
    mockApi.listAgents.mockResolvedValue([])

    await useAppStore.getState().hydrate()

    expect(useAppStore.getState().theme).toBe('dark')
  })
})
