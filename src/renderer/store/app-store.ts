import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

// ── Types ──────────────────────────────────────────────

export interface Conversation {
  id: string
  agent_id: string | null
  title: string
  created_at: number
  updated_at: number
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
  tools: { fileEdit: boolean; terminal: boolean; webFetch: boolean }
  responseFormat: string
  isDefault?: boolean
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

  // Agents
  agents: AgentConfig[]
  activeAgentId: string | null
  editingAgentId: string | null
  showAgentPanel: boolean
  agentsLoading: boolean

  // UI
  theme: 'light' | 'dark'
  showTerminal: boolean
  showMcpPanel: boolean
  showSettings: boolean
  showOnboarding: boolean
  updateAvailable: { version: string } | null
  updateDownloaded: boolean

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

  // ── Agent Actions ──
  loadAgents: () => Promise<void>
  selectAgent: (id: string | null) => void
  openCreateAgent: () => void
  openEditAgent: (id: string) => void
  closeAgentPanel: () => void
  saveAgent: (config: AgentConfig) => Promise<void>
  deleteAgent: (id: string) => Promise<void>
  duplicateAgent: (id: string) => Promise<void>
  exportAgent: (id: string) => Promise<void>
  importAgent: () => Promise<void>

  // ── UI Actions ──
  setTheme: (theme: 'light' | 'dark') => void
  toggleTheme: () => void
  toggleTerminal: () => void
  setShowMcpPanel: (show: boolean) => void
  setShowSettings: (show: boolean) => void
  setShowOnboarding: (show: boolean) => void
  setUpdateAvailable: (info: { version: string } | null) => void
  setUpdateDownloaded: (downloaded: boolean) => void

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

    agents: [],
    activeAgentId: null,
    editingAgentId: null,
    showAgentPanel: false,
    agentsLoading: false,

    theme: 'dark',
    showTerminal: false,
    showMcpPanel: false,
    showSettings: false,
    showOnboarding: false,
    updateAvailable: null,
    updateDownloaded: false,

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
        const result = await window.api.deleteAgent(id)
        if (result?.error || result === false) {
          get().addToast('Failed to delete agent', 'error')
          return
        }
        set((s) => {
          if (s.activeAgentId === id) s.activeAgentId = null
          s.showAgentPanel = false
        })
        await get().loadAgents()
        get().addToast('Agent deleted', 'success')
      } catch {
        get().addToast('Failed to delete agent', 'error')
      }
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

    toggleTerminal: () => {
      set((s) => { s.showTerminal = !s.showTerminal })
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
      ])
    },
  }))
)
