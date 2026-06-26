import { vi } from 'vitest'

/**
 * Creates a mock app store state with all actions as vi.fn().
 * Pass overrides to customize state for specific tests.
 */
export function createMockAppStore(overrides: Record<string, unknown> = {}) {
  return {
    // Auth state
    authState: { authenticated: false, mode: 'none', user: null, cliInstalled: false, clis: { claude: false, codex: false } },
    authLoading: false,

    // Conversations
    conversations: [],
    currentConversationId: null,
    conversationsLoading: false,

    // Agents
    agents: [],
    activeAgentId: null,
    historyAgentId: null,
    editingAgentId: null,
    showAgentPanel: false,
    agentsLoading: false,
    pendingDeleteAgent: null,

    // UI
    theme: 'dark' as const,
    showSidebar: true,
    catalogModels: [],
    availableModelGroups: [],
    globalDefaultModel: 'default',
    showTerminal: false,
    showMcpPanel: false,
    showSettings: false,
    showRemoteEditPanel: false,
    pendingRemoteEditReportId: null,
    showOnboarding: false,
    updateAvailable: null,
    updateDownloaded: false,
    activeSectionPane: null as 'projects' | 'agents' | 'chats' | 'skills' | 'scheduled' | 'artifacts' | null,
    viewingArtifactId: null as string | null,
    pendingArtifactGeneration: null as { title: string; kind: string; startedAt: number } | null,
    pendingArtifactAttach: null as { artifactId: string; versionId?: string } | null,

    // Skills
    skills: [],
    skillsLoading: false,
    editingSkillId: null,
    showSkillPanel: false,
    showSkillGenerator: false,

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
    generatingConversationIds: [],
    generatingStartTimes: {} as Record<string, number>,
    pendingConversationIds: [],
    completedConversationIds: [],
    checkAuth: vi.fn(),
    loginByok: vi.fn(),
    logout: vi.fn(),
    loadConversations: vi.fn(),
    selectConversation: vi.fn(),
    deleteConversation: vi.fn(),
    conversationCreated: vi.fn(),
    newChat: vi.fn(),
    loadAgents: vi.fn(),
    selectAgent: vi.fn(),
    setHistoryAgentId: vi.fn(),
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
    loadSkills: vi.fn().mockResolvedValue(undefined),
    openCreateSkill: vi.fn(),
    openEditSkill: vi.fn(),
    closeSkillPanel: vi.fn(),
    setShowSkillGenerator: vi.fn(),
    saveSkill: vi.fn(),
    deleteSkill: vi.fn(),
    duplicateSkill: vi.fn(),
    exportSkill: vi.fn(),
    importSkill: vi.fn(),
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleTerminal: vi.fn(),
    toggleAgentPanel: vi.fn(),
    setShowMcpPanel: vi.fn(),
    setShowSettings: vi.fn(),
    setShowRemoteEditPanel: vi.fn(),
    openArtifactPanel: vi.fn(),
    closeArtifactPanel: vi.fn(),
    setPendingArtifactGeneration: vi.fn(),
    requestArtifactAttach: vi.fn(),
    clearPendingArtifactAttach: vi.fn(),
    openBugReport: vi.fn(),
    setPendingRemoteEditReportId: vi.fn(),
    setShowOnboarding: vi.fn(),
    setUpdateAvailable: vi.fn(),
    setUpdateDownloaded: vi.fn(),
    setSectionPane: vi.fn(),
    openSectionPane: vi.fn(),
    addToast: vi.fn(),
    dismissToast: vi.fn(),
    setCatalogModels: vi.fn(),
    refreshAvailableModels: vi.fn().mockResolvedValue(undefined),
    setGlobalDefaultModel: vi.fn(),
    addToolApprovalRequest: vi.fn(),
    respondToToolApproval: vi.fn(),
    markConversationUnread: vi.fn(),
    markConversationRead: vi.fn(),
    markConversationGenerating: vi.fn(),
    markConversationDoneGenerating: vi.fn(),
    markConversationPending: vi.fn(),
    clearConversationPending: vi.fn(),
    markConversationComplete: vi.fn().mockResolvedValue(undefined),
    pendingDebriefConversationId: null,
    setPendingDebriefConversationId: vi.fn(),
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
    updateProjectConfig: vi.fn().mockResolvedValue(undefined),
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
