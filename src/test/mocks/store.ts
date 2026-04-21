import { vi } from 'vitest'

/**
 * Creates a mock app store state with all actions as vi.fn().
 * Pass overrides to customize state for specific tests.
 */
export function createMockAppStore(overrides: Record<string, unknown> = {}) {
  return {
    // Auth state
    authState: { authenticated: false, user: null },
    deviceCode: null,
    authLoading: false,

    // Conversations
    conversations: [],
    currentConversationId: null,
    conversationsLoading: false,

    // Agents
    agents: [],
    activeAgentId: null,
    editingAgentId: null,
    showAgentPanel: false,
    agentsLoading: false,

    // UI
    theme: 'dark' as const,
    showSidebar: true,
    showTerminal: false,
    showMcpPanel: false,
    showSettings: false,
    showOnboarding: false,
    updateAvailable: null,
    updateDownloaded: false,

    // Projects
    projects: [],
    activeProjectId: null,
    projectsLoading: false,

    // Toasts
    toasts: [],

    // Tool Approval
    toolApprovalRequests: [],

    // Actions
    checkAuth: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    setDeviceCode: vi.fn(),
    loadConversations: vi.fn(),
    selectConversation: vi.fn(),
    deleteConversation: vi.fn(),
    conversationCreated: vi.fn(),
    newChat: vi.fn(),
    loadAgents: vi.fn(),
    selectAgent: vi.fn(),
    openCreateAgent: vi.fn(),
    openEditAgent: vi.fn(),
    closeAgentPanel: vi.fn(),
    saveAgent: vi.fn(),
    deleteAgent: vi.fn(),
    duplicateAgent: vi.fn(),
    exportAgent: vi.fn(),
    importAgent: vi.fn(),
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleTerminal: vi.fn(),
    toggleAgentPanel: vi.fn(),
    setShowMcpPanel: vi.fn(),
    setShowSettings: vi.fn(),
    setShowOnboarding: vi.fn(),
    setUpdateAvailable: vi.fn(),
    setUpdateDownloaded: vi.fn(),
    addToast: vi.fn(),
    dismissToast: vi.fn(),
    addToolApprovalRequest: vi.fn(),
    respondToToolApproval: vi.fn(),
    hydrate: vi.fn(),
    loadProjects: vi.fn(),
    createProject: vi.fn(),
    renameProject: vi.fn(),
    deleteProject: vi.fn(),
    setActiveProject: vi.fn(),
    moveConversationToProject: vi.fn(),
    setProjectDefaultModel: vi.fn(),
    selectProject: vi.fn(),
    setConversationProject: vi.fn(),

    ...overrides
  }
}

/**
 * Sets up the useAppStore mock to return values from the given mock store.
 * Must be used after vi.mock('../../renderer/store/app-store', ...).
 *
 * Usage:
 *   const mockStore = createMockAppStore({ conversations: [...] })
 *   setupStoreMock(useAppStore, mockStore)
 */
export function setupStoreMock(
  useAppStoreMock: ReturnType<typeof vi.fn>,
  store: ReturnType<typeof createMockAppStore>
) {
  useAppStoreMock.mockImplementation((selector: (s: unknown) => unknown) => {
    if (typeof selector === 'function') {
      return selector(store)
    }
    return store
  })
}
