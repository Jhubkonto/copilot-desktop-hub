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
    pendingDeleteAgent: null,

    // UI
    theme: 'dark' as const,
    showSidebar: true,
    showTerminal: false,
    showMcpPanel: false,
    showSettings: false,
    showOnboarding: false,
    updateAvailable: null,
    updateDownloaded: false,
    activeSectionPane: null as 'projects' | 'agents' | 'chats' | null,

    // Projects
    projects: [],
    activeProjectId: null,
    historyProjectId: null,
    pendingSettingsProjectId: null,
    showNewProjectForm: false,
    editingProjectId: null,
    projectsLoading: false,
    projectAgents: {} as Record<string, { agentId: string; agentName: string; agentIcon: string; isPrimary: boolean; sortOrder: number }[]>,
    projectConfigs: {} as Record<string, import('../../renderer/store/types').ProjectConfig>,

    // Toasts
    toasts: [],

    // Tool Approval
    toolApprovalRequests: [],
    unreadConversationIds: [],
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
    confirmDeleteAgent: vi.fn(),
    cancelDeleteAgent: vi.fn(),
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
    setSectionPane: vi.fn(),
    addToast: vi.fn(),
    dismissToast: vi.fn(),
    addToolApprovalRequest: vi.fn(),
    respondToToolApproval: vi.fn(),
    markConversationUnread: vi.fn(),
    markConversationRead: vi.fn(),
    hydrate: vi.fn(),
    loadProjects: vi.fn(),
    createProject: vi.fn(),
    renameProject: vi.fn(),
    deleteProject: vi.fn(),
    setActiveProject: vi.fn(),
    moveConversationToProject: vi.fn(),
    setProjectDefaultModel: vi.fn(),
    selectProject: vi.fn(),
    setHistoryProjectId: vi.fn(),
    setConversationProject: vi.fn(),
    loadProjectAgents: vi.fn(),
    addAgentToProject: vi.fn(),
    removeAgentFromProject: vi.fn(),
    setProjectPrimaryAgent: vi.fn(),
    reorderProjectAgents: vi.fn(),
    loadProjectConfig: vi.fn(),
    updateProjectOrchestration: vi.fn(),
    updateProjectConfig: vi.fn(),
    clearPendingSettingsProject: vi.fn(),
    setShowNewProjectForm: vi.fn(),
    openEditProject: vi.fn(),
    closeEditProject: vi.fn(),
    duplicateProject: vi.fn(),
    exportProject: vi.fn(),

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
