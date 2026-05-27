import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

// ── Types ──────────────────────────────────────────────

export interface Conversation {
  id: string
  agent_id: string | null
  model?: string | null
  pinned?: number
  project_id?: string | null
  title: string
  created_at: number
  updated_at: number
}

export interface Project {
  id: string
  name: string
  color: string
  default_model?: string | null
  created_at: number
  updated_at: number
}

export interface ToolConfig {
  enabled: boolean
  approval: 'auto' | 'always-ask' | 'disabled'
  instructions: string
}

export interface AgentConfig {
  id: string
  name: string
  icon: string
  systemPrompt: string
  model: string
  temperature: number
  maxTokens: number
  contextDirectories: string[]
  contextFiles: string[]
  mcpServers: string[]
  agenticMode: boolean
  tools: { fileEdit: ToolConfig; terminal: ToolConfig; webFetch: ToolConfig }
  responseFormat: string
  isDefault?: boolean
  // Feature B
  rootDirectory?: string
  contextRules?: {
    ignoredGlobs: string[]
    autoInjectWorkspace: boolean
    autoInjectGit: boolean
  }
  memory?: string
  customCommands?: { name: string; description: string; prompt: string }[]
}

export interface AuthState {
  authenticated: boolean
  user: { login: string; avatar_url: string; name: string | null } | null
}

export interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

export interface ToolApprovalRequest {
  requestId: string
  tool: string
  args: Record<string, unknown>
  description: string
}

export interface ProjectAgent {
  agentId: string
  agentName: string
  agentIcon: string
  isPrimary: boolean
  sortOrder: number
}

export interface DeleteAgentImpact {
  agentId: string
  agentName: string
  affectedProjects: { id: string; name: string; is_primary: number }[]
  affectedConvCount: number
}

export interface ProjectOrchestrationConfig {
  orchestrationEnabled: boolean
  maxDelegationDepth: number
  showTeamActivity: boolean
}

// K: Scope guardrails
export interface ScopeRule {
  id: string
  description: string
  pathGlob?: string
}

export interface Milestone {
  id: string
  title: string
  description?: string
  status: 'active' | 'upcoming' | 'completed'
  completedAt?: number
}

export interface ProjectConfig extends ProjectOrchestrationConfig {
  // J: Rich project instructions
  instructions: string
  rootDirectory: string
  variables: Array<{ key: string; value: string }>
  instructionMode: 'prepend' | 'append' | 'replace' | 'standalone'
  instructionsEnabled: boolean
  // K: Scope guardrails & milestones
  inScope: ScopeRule[]
  outOfScope: ScopeRule[]
  milestones: Milestone[]
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  instructions: '',
  rootDirectory: '',
  variables: [],
  instructionMode: 'prepend',
  instructionsEnabled: true,
  orchestrationEnabled: false,
  maxDelegationDepth: 5,
  showTeamActivity: true,
  inScope: [],
  outOfScope: [],
  milestones: [],
}

// ── Store State ────────────────────────────────────────

interface AppState {
  // Auth
  authState: AuthState
  deviceCode: { userCode: string; verificationUri: string } | null
  authLoading: boolean

  // Conversations
  conversations: Conversation[]
  currentConversationId: string | null
  conversationsLoading: boolean

  // Projects
  projects: Project[]
  activeProjectId: string | null
  pendingSettingsProjectId: string | null
  showNewProjectForm: boolean
  projectsLoading: boolean
  projectAgents: Record<string, ProjectAgent[]>
  projectConfigs: Record<string, ProjectConfig>

  // Agents
  agents: AgentConfig[]
  activeAgentId: string | null
  editingAgentId: string | null
  showAgentPanel: boolean
  agentsLoading: boolean
  pendingDeleteAgent: DeleteAgentImpact | null

  // UI
  theme: 'light' | 'dark'
  showSidebar: boolean
  showTerminal: boolean
  showMcpPanel: boolean
  showSettings: boolean
  showOnboarding: boolean
  updateAvailable: { version: string } | null
  updateDownloaded: boolean
  activeSectionPane: 'projects' | 'agents' | 'chats' | null

  // Toasts
  toasts: Toast[]

  // Tool Approval
  toolApprovalRequests: ToolApprovalRequest[]

  // ── Auth Actions ──
  checkAuth: () => Promise<void>
  login: () => Promise<void>
  logout: () => Promise<void>
  setDeviceCode: (code: { userCode: string; verificationUri: string } | null) => void

  // ── Conversation Actions ──
  loadConversations: () => Promise<void>
  selectConversation: (id: string | null) => void
  deleteConversation: (id: string) => Promise<void>
  conversationCreated: (id: string) => Promise<void>
  newChat: () => void

  // ── Project Actions ──
  loadProjects: () => Promise<void>
  selectProject: (id: string | null) => void
  createProject: (name: string, color: string) => Promise<void>
  renameProject: (id: string, name: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  setConversationProject: (conversationId: string, projectId: string | null) => Promise<void>
  setProjectDefaultModel: (id: string, model: string | null) => Promise<void>
  clearPendingSettingsProject: () => void
  setShowNewProjectForm: (show: boolean) => void

  // ── Project Agent Actions ──
  loadProjectAgents: (projectId: string) => Promise<void>
  addAgentToProject: (projectId: string, agentId: string) => Promise<void>
  removeAgentFromProject: (projectId: string, agentId: string) => Promise<void>
  setProjectPrimaryAgent: (projectId: string, agentId: string) => Promise<void>
  reorderProjectAgents: (projectId: string, orderedAgentIds: string[]) => Promise<void>
  updateProjectOrchestration: (projectId: string, config: Partial<ProjectOrchestrationConfig>) => Promise<void>
  updateProjectConfig: (projectId: string, config: Partial<ProjectConfig>) => Promise<void>
  loadProjectConfig: (projectId: string) => Promise<void>

  // ── Agent Actions ──
  loadAgents: () => Promise<void>
  selectAgent: (id: string | null) => void
  openCreateAgent: () => void
  openEditAgent: (id: string) => void
  closeAgentPanel: () => void
  saveAgent: (config: AgentConfig) => Promise<void>
  deleteAgent: (id: string) => Promise<void>
  confirmDeleteAgent: () => Promise<void>
  cancelDeleteAgent: () => void
  duplicateAgent: (id: string) => Promise<void>
  exportAgent: (id: string) => Promise<void>
  importAgent: () => Promise<void>

  // ── UI Actions ──
  setTheme: (theme: 'light' | 'dark') => void
  toggleTheme: () => void
  toggleSidebar: () => void
  toggleTerminal: () => void
  toggleAgentPanel: () => void
  setShowMcpPanel: (show: boolean) => void
  setShowSettings: (show: boolean) => void
  setShowOnboarding: (show: boolean) => void
  setUpdateAvailable: (info: { version: string } | null) => void
  setUpdateDownloaded: (downloaded: boolean) => void
  setSectionPane: (section: 'projects' | 'agents' | 'chats' | null) => void

  // ── Toast Actions ──
  addToast: (message: string, type?: Toast['type']) => void
  dismissToast: (id: string) => void

  // ── Tool Approval Actions ──
  addToolApprovalRequest: (request: ToolApprovalRequest) => void
  respondToToolApproval: (requestId: string, approved: boolean, remember: boolean) => Promise<void>

  // ── Hydration ──
  hydrate: () => Promise<void>
}

// ── Store ──────────────────────────────────────────────

export const useAppStore = create<AppState>()(
  immer((set, get) => ({
    // ── Initial State ──
    authState: { authenticated: false, user: null },
    deviceCode: null,
    authLoading: false,

    conversations: [],
    currentConversationId: null,
    conversationsLoading: false,

    projects: [],
    activeProjectId: null,
    pendingSettingsProjectId: null,
    showNewProjectForm: false,
    projectsLoading: false,
    projectAgents: {},
    projectConfigs: {},

    agents: [],
    activeAgentId: null,
    editingAgentId: null,
    showAgentPanel: false,
    agentsLoading: false,
    pendingDeleteAgent: null,

    theme: 'dark',
    showSidebar: true,
    showTerminal: false,
    showMcpPanel: false,
    showSettings: false,
    showOnboarding: false,
    updateAvailable: null,
    updateDownloaded: false,
    activeSectionPane: null,

    toasts: [],

    toolApprovalRequests: [],

    // ── Auth Actions ──

    checkAuth: async () => {
      const result = await window.api.authStatus()
      set((s) => { s.authState = result })
    },

    login: async () => {
      set((s) => { s.authLoading = true })
      try {
        const result = await window.api.authLogin()
        set((s) => { s.deviceCode = null; s.authLoading = false })
        if (result?.error) {
          const msg = result.error === 'Device code expired'
            ? 'Login timed out. Please try again.'
            : result.error
          get().addToast(msg, 'error')
          return
        }
        if (result.success) {
          set((s) => {
            s.authState = { authenticated: true, user: result.user ?? null }
          })
          get().addToast(`Signed in as ${result.user?.login ?? 'user'}`, 'success')
        }
      } catch {
        set((s) => { s.deviceCode = null; s.authLoading = false })
        get().addToast('Login failed. Please try again.', 'error')
      }
    },

    logout: async () => {
      try {
        const result = await window.api.authLogout()
        if (result?.error) {
          get().addToast('Logout failed: ' + result.error, 'error')
          return
        }
        set((s) => { s.authState = { authenticated: false, user: null } })
      } catch {
        get().addToast('Logout failed. Please try again.', 'error')
      }
    },

    setDeviceCode: (code) => {
      set((s) => { s.deviceCode = code })
    },

    // ── Conversation Actions ──

    loadConversations: async () => {
      set((s) => { s.conversationsLoading = true })
      try {
        const result = await window.api.listConversations()
        if (result?.error) {
          get().addToast('Failed to load conversations', 'error')
        } else {
          set((s) => { s.conversations = result })
        }
      } catch {
        get().addToast('Failed to load conversations', 'error')
      } finally {
        set((s) => { s.conversationsLoading = false })
      }
    },

    selectConversation: (id) => {
      set((s) => { s.currentConversationId = id })
    },

    deleteConversation: async (id) => {
      try {
        const result = await window.api.deleteConversation(id)
        if (result?.error) {
          get().addToast('Failed to delete conversation', 'error')
          return
        }
        set((s) => {
          if (s.currentConversationId === id) s.currentConversationId = null
        })
        await get().loadConversations()
      } catch {
        get().addToast('Failed to delete conversation', 'error')
      }
    },

    conversationCreated: async (id) => {
      set((s) => { s.currentConversationId = id })
      await get().loadConversations()
    },

    newChat: () => {
      set((s) => { s.currentConversationId = null })
    },

    // ── Project Actions ──

    loadProjects: async () => {
      set((s) => { s.projectsLoading = true })
      try {
        const result = await window.api.listProjects()
        if (result?.error) {
          get().addToast('Failed to load projects', 'error')
        } else {
          set((s) => { s.projects = result })
        }
      } catch {
        get().addToast('Failed to load projects', 'error')
      } finally {
        set((s) => { s.projectsLoading = false })
      }
    },

    selectProject: (id) => {
      set((s) => {
        s.activeProjectId = id
        s.currentConversationId = null
      })
      // Auto-select primary agent when switching to a project
      if (id) {
        const existing = get().projectAgents[id]
        const applyPrimary = (agents: typeof existing) => {
          const primary = agents?.find((a) => a.isPrimary)
          if (primary) set((s) => { s.activeAgentId = primary.agentId })
        }
        if (existing) {
          applyPrimary(existing)
        } else {
          window.api.listProjectAgents(id).then((result) => {
            if (!result?.error) {
              set((s) => { s.projectAgents[id] = result })
              applyPrimary(result)
            }
          }).catch(() => { /* ignore */ })
        }
      } else {
        // Switching away from a project — clear agent selection
        set((s) => { s.activeAgentId = null })
      }
    },

    createProject: async (name, color) => {
      try {
        const result = await window.api.createProject(name, color)
        if (result?.error) {
          get().addToast('Failed to create project', 'error')
          return
        }
        await get().loadProjects()
        set((s) => {
          s.activeProjectId = result.id
          s.pendingSettingsProjectId = result.id
        })
        get().addToast(`Project "${name}" created`, 'success')
      } catch {
        get().addToast('Failed to create project', 'error')
      }
    },

    renameProject: async (id, name) => {
      try {
        const result = await window.api.renameProject(id, name)
        if (result?.error) {
          get().addToast('Failed to rename project', 'error')
          return
        }
        await get().loadProjects()
      } catch {
        get().addToast('Failed to rename project', 'error')
      }
    },

    deleteProject: async (id) => {
      try {
        const result = await window.api.deleteProject(id)
        if (result?.error) {
          get().addToast('Failed to delete project', 'error')
          return
        }
        set((s) => {
          if (s.activeProjectId === id) s.activeProjectId = null
        })
        await Promise.all([get().loadProjects(), get().loadConversations()])
        get().addToast('Project deleted', 'success')
      } catch {
        get().addToast('Failed to delete project', 'error')
      }
    },

    setConversationProject: async (conversationId, projectId) => {
      try {
        const result = await window.api.setConversationProject(conversationId, projectId)
        if (result?.error) {
          get().addToast('Failed to move conversation', 'error')
          return
        }
        await get().loadConversations()
      } catch {
        get().addToast('Failed to move conversation', 'error')
      }
    },

    setProjectDefaultModel: async (id, model) => {
      try {
        const result = await window.api.setProjectDefaultModel(id, model)
        if (result?.error) {
          get().addToast('Failed to set project default model', 'error')
          return
        }
        await get().loadProjects()
      } catch {
        get().addToast('Failed to set project default model', 'error')
      }
    },

    // ── Project Agent Actions ──

    clearPendingSettingsProject: () => {
      set((s) => { s.pendingSettingsProjectId = null })
    },

    setShowNewProjectForm: (show) => {
      set((s) => { s.showNewProjectForm = show })
    },

    loadProjectAgents: async (projectId) => {
      try {
        const result = await window.api.listProjectAgents(projectId)
        if (result?.error) {
          get().addToast('Failed to load project agents', 'error')
          return
        }
        set((s) => { s.projectAgents[projectId] = result })
      } catch {
        get().addToast('Failed to load project agents', 'error')
      }
    },

    addAgentToProject: async (projectId, agentId) => {
      try {
        const result = await window.api.addAgentToProject(projectId, agentId)
        if (result?.error) {
          get().addToast('Failed to add agent to project', 'error')
          return
        }
        const current = get().projectAgents[projectId] ?? []
        if (current.length === 0) {
          // First agent — auto-promote to primary
          await window.api.setProjectPrimaryAgent(projectId, agentId)
        }
        await get().loadProjectAgents(projectId)
      } catch {
        get().addToast('Failed to add agent to project', 'error')
      }
    },

    removeAgentFromProject: async (projectId, agentId) => {
      try {
        const result = await window.api.removeAgentFromProject(projectId, agentId)
        if (result?.error) {
          get().addToast('Failed to remove agent from project', 'error')
          return
        }
        await get().loadProjectAgents(projectId)
      } catch {
        get().addToast('Failed to remove agent from project', 'error')
      }
    },

    setProjectPrimaryAgent: async (projectId, agentId) => {
      try {
        const result = await window.api.setProjectPrimaryAgent(projectId, agentId)
        if (result?.error) {
          get().addToast('Failed to set primary agent', 'error')
          return
        }
        await get().loadProjectAgents(projectId)
      } catch {
        get().addToast('Failed to set primary agent', 'error')
      }
    },

    reorderProjectAgents: async (projectId, orderedAgentIds) => {
      // Optimistic update
      set((s) => {
        const agents = s.projectAgents[projectId]
        if (!agents) return
        const map = new Map(agents.map((a) => [a.agentId, a]))
        s.projectAgents[projectId] = orderedAgentIds
          .map((id, index) => {
            const agent = map.get(id)
            return agent ? { ...agent, sortOrder: index } : null
          })
          .filter(Boolean) as typeof agents
      })
      try {
        await window.api.reorderProjectAgents(projectId, orderedAgentIds)
      } catch {
        // Rollback on error
        await get().loadProjectAgents(projectId)
        get().addToast('Failed to reorder agents', 'error')
      }
    },

    loadProjectConfig: async (projectId) => {
      try {
        const result = await window.api.getProjectConfig(projectId)
        if (!result?.error) {
          set((s) => {
            s.projectConfigs[projectId] = {
              ...DEFAULT_PROJECT_CONFIG,
              ...result
            }
          })
        }
      } catch { /* ignore */ }
    },

    updateProjectConfig: async (projectId, config) => {
      const prev = get().projectConfigs[projectId] ?? DEFAULT_PROJECT_CONFIG
      set((s) => {
        s.projectConfigs[projectId] = { ...prev, ...config }
      })
      try {
        await window.api.updateProjectConfig(projectId, config as Record<string, unknown>)
      } catch {
        set((s) => { s.projectConfigs[projectId] = prev })
        get().addToast('Failed to update project settings', 'error')
      }
    },

    updateProjectOrchestration: async (projectId, config) => {
      set((s) => {
        const current = s.projectConfigs[projectId] ?? DEFAULT_PROJECT_CONFIG
        s.projectConfigs[projectId] = { ...current, ...config }
      })
      try {
        await window.api.updateProjectConfig(projectId, config as Record<string, unknown>)
      } catch {
        get().addToast('Failed to update orchestration settings', 'error')
      }
    },

    // ── Agent Actions ──

    loadAgents: async () => {
      set((s) => { s.agentsLoading = true })
      try {
        const result = await window.api.listAgents()
        if (result?.error) {
          get().addToast('Failed to load agents', 'error')
        } else {
          set((s) => { s.agents = result })
        }
      } catch {
        get().addToast('Failed to load agents', 'error')
      } finally {
        set((s) => { s.agentsLoading = false })
      }
    },

    selectAgent: (id) => {
      set((s) => { s.activeAgentId = id })
    },

    openCreateAgent: () => {
      set((s) => { s.editingAgentId = null; s.showAgentPanel = true })
    },

    openEditAgent: (id) => {
      set((s) => { s.editingAgentId = id; s.showAgentPanel = true })
    },

    closeAgentPanel: () => {
      set((s) => { s.showAgentPanel = false })
    },

    saveAgent: async (config) => {
      try {
        const { editingAgentId, activeAgentId } = get()
        if (config.id && editingAgentId) {
          const result = await window.api.updateAgent(config.id, config)
          if (result?.error) {
            get().addToast('Failed to update agent', 'error')
            return
          }
          get().addToast(`Agent "${config.name}" updated`, 'success')
        } else {
          const result = await window.api.createAgent(config)
          if (result?.error) {
            get().addToast('Failed to create agent', 'error')
            return
          }
          if (result && !activeAgentId) {
            set((s) => { s.activeAgentId = result.id })
          }
          get().addToast(`Agent "${config.name}" created`, 'success')
        }
        await get().loadAgents()
        set((s) => { s.showAgentPanel = false })
      } catch {
        get().addToast('Failed to save agent', 'error')
      }
    },

    deleteAgent: async (id) => {
      try {
        const agent = get().agents.find((a) => a.id === id)
        const preflight = await window.api.deleteAgentPreflight(id)
        if (preflight?.error) {
          get().addToast('Failed to check agent impact', 'error')
          return
        }
        const { affectedProjects, affectedConvCount } = preflight
        // Always show confirmation dialog
        set((s) => {
          s.pendingDeleteAgent = {
            agentId: id,
            agentName: agent?.name ?? id,
            affectedProjects,
            affectedConvCount
          }
        })
      } catch {
        get().addToast('Failed to delete agent', 'error')
      }
    },

    confirmDeleteAgent: async () => {
      const pending = get().pendingDeleteAgent
      if (!pending) return
      set((s) => { s.pendingDeleteAgent = null })
      try {
        const result = await window.api.deleteAgent(pending.agentId)
        if (result?.success === false) {
          get().addToast(result.reason ?? 'Failed to delete agent', 'error')
          return
        }
        set((s) => {
          if (s.activeAgentId === pending.agentId) s.activeAgentId = null
          s.showAgentPanel = false
        })
        await get().loadAgents()
        // Reload all projects whose membership may have changed
        await get().loadProjects()
        for (const p of pending.affectedProjects) {
          await get().loadProjectAgents(p.id)
        }
        const count = pending.affectedProjects.length
        get().addToast(
          `Agent deleted${count > 0 ? ` · ${count} project${count !== 1 ? 's' : ''} updated` : ''}`,
          'success'
        )
      } catch {
        get().addToast('Failed to delete agent', 'error')
      }
    },

    cancelDeleteAgent: () => {
      set((s) => { s.pendingDeleteAgent = null })
    },

    duplicateAgent: async (id) => {
      try {
        const result = await window.api.duplicateAgent(id)
        if (result?.error) {
          get().addToast('Failed to duplicate agent', 'error')
          return
        }
        await get().loadAgents()
        set((s) => { s.showAgentPanel = false })
        get().addToast('Agent duplicated', 'success')
      } catch {
        get().addToast('Failed to duplicate agent', 'error')
      }
    },

    exportAgent: async (id) => {
      try {
        const result = await window.api.exportAgent(id)
        if (result?.error) {
          get().addToast('Failed to export agent', 'error')
          return
        }
        get().addToast('Agent exported', 'success')
      } catch {
        get().addToast('Failed to export agent', 'error')
      }
    },

    importAgent: async () => {
      try {
        const result = await window.api.importAgent()
        if (result?.error) {
          get().addToast('Failed to import agent', 'error')
          return
        }
        if (result) {
          await get().loadAgents()
          get().addToast('Agent imported', 'success')
        }
      } catch {
        get().addToast('Failed to import agent', 'error')
      }
    },

    // ── UI Actions ──

    setTheme: (theme) => {
      set((s) => { s.theme = theme })
      document.documentElement.classList.toggle('dark', theme === 'dark')
    },

    toggleTheme: () => {
      const next = get().theme === 'dark' ? 'light' : 'dark'
      get().setTheme(next)
      window.api.setTheme(next)
    },

    toggleSidebar: () => {
      set((s) => { s.showSidebar = !s.showSidebar })
    },

    toggleTerminal: () => {
      set((s) => { s.showTerminal = !s.showTerminal })
    },

    toggleAgentPanel: () => {
      set((s) => { s.showAgentPanel = !s.showAgentPanel })
    },

    setShowMcpPanel: (show) => {
      set((s) => { s.showMcpPanel = show })
    },

    setShowSettings: (show) => {
      set((s) => { s.showSettings = show })
    },

    setShowOnboarding: (show) => {
      set((s) => { s.showOnboarding = show })
    },

    setUpdateAvailable: (info) => {
      set((s) => { s.updateAvailable = info })
    },

    setUpdateDownloaded: (downloaded) => {
      set((s) => { s.updateDownloaded = downloaded })
    },

    setSectionPane: (section) => {
      set((s) => { s.activeSectionPane = s.activeSectionPane === section ? null : section })
    },

    // ── Toast Actions ──

    addToast: (message, type = 'info') => {
      const id = crypto.randomUUID()
      set((s) => { s.toasts.push({ id, message, type }) })
    },

    dismissToast: (id) => {
      set((s) => { s.toasts = s.toasts.filter((t) => t.id !== id) })
    },

    // ── Tool Approval Actions ──

    addToolApprovalRequest: (request) => {
      set((s) => { s.toolApprovalRequests.push(request) })
    },

    respondToToolApproval: async (requestId, approved, remember) => {
      try {
        await window.api.respondToToolApproval(requestId, approved, remember)
        set((s) => {
          s.toolApprovalRequests = s.toolApprovalRequests.filter(
            (r) => r.requestId !== requestId
          )
        })
      } catch {
        get().addToast('Failed to respond to tool approval', 'error')
      }
    },

    // ── Hydration ──

    hydrate: async () => {
      // Load theme
      try {
        const savedTheme = await window.api.getTheme()
        const t = savedTheme === 'light' ? 'light' : 'dark'
        get().setTheme(t)
      } catch { /* use default */ }

      // Check auth and onboarding
      await Promise.all([
        get().checkAuth(),
        window.api.getSetting('onboarding_complete').then((val: string | null) => {
          if (val !== 'true') set((s) => { s.showOnboarding = true })
        }).catch(() => {}),
      ])

      // Load data
      await Promise.all([
        get().loadConversations(),
        get().loadAgents(),
        get().loadProjects(),
      ])
    },
  }))
)
