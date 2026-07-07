import type { StateCreator } from 'zustand'
import type { AppState } from '../app-store'
import type {
  ActiveSectionPane,
  Theme,
  Toast,
  ToolApprovalRequest
} from '../types'
import type { AvailableModelGroup, CatalogModel, CodeChangeRequestType } from '../../../shared/types'

export interface PendingNewRequestDraft {
  title: string
  description: string
  requestType: CodeChangeRequestType
  customTypeLabel: string
  chatProjectId: string | null
  conversationTitle: string | null
}

export interface UiSlice {
  theme: Theme
  showSidebar: boolean
  showMcpPanel: boolean
  showSettings: boolean
  showOnboarding: boolean
  pendingRemoteEditReportId: string | null
  pendingNewRequestDraft: PendingNewRequestDraft | null
  pendingCodeChangesProjectId: string | null
  pendingArtifactGeneration: { title: string; kind: string; startedAt: number } | null
  pendingArtifactAttach: { artifactId: string; versionId?: string } | null
  updateAvailable: { version: string } | null
  updateDownloaded: boolean
  activeSectionPane: ActiveSectionPane
  toasts: Toast[]
  toolApprovalRequests: ToolApprovalRequest[]
  unreadConversationIds: string[]
  generatingConversationIds: string[]
  generatingStartTimes: Record<string, number>
  pendingConversationIds: string[]
  catalogModels: CatalogModel[]
  availableModelGroups: AvailableModelGroup[]
  globalDefaultModel: string
  debugLogging: boolean
  androidDebugLog: boolean
  setTheme: (theme: Theme) => void
  setDebugLogging: (enabled: boolean) => void
  setAndroidDebugLog: (enabled: boolean) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  toggleAgentPanel: () => void
  setShowMcpPanel: (show: boolean) => void
  setShowSettings: (show: boolean) => void
  setPendingRemoteEditReportId: (reportId: string | null) => void
  setPendingNewRequestDraft: (draft: PendingNewRequestDraft | null) => void
  setPendingCodeChangesProjectId: (projectId: string | null) => void
  setPendingArtifactGeneration: (v: { title: string; kind: string; startedAt: number } | null) => void
  requestArtifactAttach: (artifactId: string, versionId?: string) => void
  clearPendingArtifactAttach: () => void
  settingsInitialTab: string | null
  setSettingsInitialTab: (tab: string | null) => void
  setShowOnboarding: (show: boolean) => void
  setUpdateAvailable: (info: { version: string } | null) => void
  setUpdateDownloaded: (downloaded: boolean) => void
  setSectionPane: (section: ActiveSectionPane) => void
  openSectionPane: (section: Exclude<ActiveSectionPane, null>) => void
  addToast: (message: string, type?: Toast['type'], action?: Toast['action']) => void
  dismissToast: (id: string) => void
  setCatalogModels: (models: CatalogModel[]) => void
  refreshAvailableModels: () => Promise<void>
  setGlobalDefaultModel: (model: string) => void
  addToolApprovalRequest: (request: ToolApprovalRequest) => void
  removeToolApprovalRequest: (requestId: string) => void
  respondToToolApproval: (
    requestId: string,
    approved: boolean,
    remember: boolean
  ) => Promise<void>
  markConversationUnread: (id: string) => void
  markConversationRead: (id: string) => void
  markConversationGenerating: (id: string) => void
  markConversationDoneGenerating: (id: string) => void
  markConversationPending: (id: string) => void
  clearConversationPending: (id: string) => void
  viewingArtifactId: string | null
  openArtifactPanel: (id: string) => void
  closeArtifactPanel: () => void
  pendingDebriefConversationId: string | null
  setPendingDebriefConversationId: (id: string | null) => void
  pendingKeyHandoffProvider: string | null
  setPendingKeyHandoffProvider: (provider: string | null) => void
}

export const createUiSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  UiSlice
> = (set, get) => ({
  theme: 'dark',
  showSidebar: true,
  showMcpPanel: false,
  showSettings: false,
  settingsInitialTab: null,
  showOnboarding: false,
  pendingRemoteEditReportId: null,
  pendingNewRequestDraft: null,
  pendingCodeChangesProjectId: null,
  pendingArtifactGeneration: null,
  pendingArtifactAttach: null,
  updateAvailable: null,
  updateDownloaded: false,
  activeSectionPane: null,
  toasts: [],
  toolApprovalRequests: [],
  unreadConversationIds: [],
  generatingConversationIds: [],
  generatingStartTimes: {},
  pendingConversationIds: [],
  catalogModels: [],
  availableModelGroups: [],
  globalDefaultModel: 'default',
  debugLogging: false,
  androidDebugLog: false,
  viewingArtifactId: null,
  pendingDebriefConversationId: null,
  pendingKeyHandoffProvider: null,

  openArtifactPanel: (id) => {
    set((s) => {
      s.viewingArtifactId = id
    })
  },

  closeArtifactPanel: () => {
    set((s) => {
      s.viewingArtifactId = null
    })
  },

  setPendingDebriefConversationId: (id) => {
    set((s) => {
      s.pendingDebriefConversationId = id
    })
  },

  setPendingKeyHandoffProvider: (provider) => {
    set((s) => {
      s.pendingKeyHandoffProvider = provider
    })
  },

  setTheme: (theme) => {
    set((s) => {
      s.theme = theme
    })
    document.documentElement.classList.toggle('dark', theme === 'dark')
  },

  setDebugLogging: (enabled) => {
    set((s) => {
      s.debugLogging = enabled
    })
    void window.api.setSetting('debug_logging', String(enabled)).catch(() => {})
    void window.api.setDebugEnabled(enabled).catch(() => {})
  },

  setAndroidDebugLog: (enabled) => {
    set((s) => {
      s.androidDebugLog = enabled
    })
    void window.api.setSetting('android_debug_log', String(enabled)).catch(() => {})
  },

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    get().setTheme(next)
    window.api.setTheme(next)
  },

  toggleSidebar: () => {
    set((s) => {
      s.showSidebar = !s.showSidebar
    })
  },

  toggleAgentPanel: () => {
    set((s) => {
      s.showAgentPanel = !s.showAgentPanel
    })
  },

  setShowMcpPanel: (show) => {
    set((s) => {
      s.showMcpPanel = show
    })
  },

  setShowSettings: (show) => {
    set((s) => {
      s.showSettings = show
    })
  },

  setPendingRemoteEditReportId: (reportId) => {
    set((s) => {
      s.pendingRemoteEditReportId = reportId
    })
  },

  setPendingNewRequestDraft: (draft) => {
    set((s) => {
      s.pendingNewRequestDraft = draft
    })
  },

  setPendingCodeChangesProjectId: (projectId) => {
    set((s) => {
      s.pendingCodeChangesProjectId = projectId
    })
  },

  setPendingArtifactGeneration: (v) => {
    set((s) => {
      s.pendingArtifactGeneration = v
    })
  },

  requestArtifactAttach: (artifactId, versionId) => {
    set((s) => {
      s.pendingArtifactAttach = { artifactId, versionId }
    })
  },

  clearPendingArtifactAttach: () => {
    set((s) => {
      s.pendingArtifactAttach = null
    })
  },

  setSettingsInitialTab: (tab) => {
    set((s) => {
      s.settingsInitialTab = tab
    })
  },

  setShowOnboarding: (show) => {
    set((s) => {
      s.showOnboarding = show
    })
  },

  setUpdateAvailable: (info) => {
    set((s) => {
      s.updateAvailable = info
    })
  },

  setUpdateDownloaded: (downloaded) => {
    set((s) => {
      s.updateDownloaded = downloaded
    })
  },

  setSectionPane: (section) => {
    set((s) => {
      s.activeSectionPane = s.activeSectionPane === section ? null : section
    })
  },

  openSectionPane: (section) => {
    set((s) => {
      s.activeSectionPane = section
    })
  },

  addToast: (message, type = 'info', action) => {
    const id = crypto.randomUUID()
    set((s) => {
      s.toasts.push({ id, message, type, action })
    })
  },

  dismissToast: (id) => {
    set((s) => {
      s.toasts = s.toasts.filter((t) => t.id !== id)
    })
  },

  setCatalogModels: (models) => {
    set((s) => {
      s.catalogModels = models
    })
  },

  refreshAvailableModels: async () => {
    try {
      const groups = await window.api.listAvailableModels()
      set((s) => { s.availableModelGroups = groups })
    } catch { /* leave existing value */ }
  },

  setGlobalDefaultModel: (model) => {
    set((s) => {
      s.globalDefaultModel = model
    })
  },

  addToolApprovalRequest: (request) => {
    set((s) => {
      s.toolApprovalRequests.push(request)
    })
  },

  removeToolApprovalRequest: (requestId) => {
    set((s) => {
      s.toolApprovalRequests = s.toolApprovalRequests.filter((r) => r.requestId !== requestId)
    })
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

  markConversationUnread: (id) => {
    set((s) => {
      if (!s.unreadConversationIds.includes(id)) {
        s.unreadConversationIds.push(id)
      }
    })
  },

  markConversationRead: (id) => {
    set((s) => {
      s.unreadConversationIds = s.unreadConversationIds.filter((cid) => cid !== id)
    })
  },

  markConversationGenerating: (id) => {
    set((s) => {
      if (!s.generatingConversationIds.includes(id)) {
        s.generatingConversationIds.push(id)
        s.generatingStartTimes[id] = Date.now()
      }
    })
  },

  markConversationDoneGenerating: (id) => {
    set((s) => {
      s.generatingConversationIds = s.generatingConversationIds.filter((cid) => cid !== id)
      delete s.generatingStartTimes[id]
    })
  },

  markConversationPending: (id) => {
    set((s) => {
      if (!s.pendingConversationIds.includes(id)) {
        s.pendingConversationIds.push(id)
      }
    })
  },

  clearConversationPending: (id) => {
    set((s) => {
      s.pendingConversationIds = s.pendingConversationIds.filter((cid) => cid !== id)
    })
  },
})
