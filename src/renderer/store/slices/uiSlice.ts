import type { StateCreator } from 'zustand'
import type { AppState } from '../app-store'
import type {
  ActiveSectionPane,
  Theme,
  Toast,
  ToolApprovalRequest
} from '../types'
import type { CatalogModel } from '../../../shared/types'

export interface BugReportDraft {
  title?: string
  description?: string
}

export interface UiSlice {
  theme: Theme
  showSidebar: boolean
  showMcpPanel: boolean
  showSettings: boolean
  showOnboarding: boolean
  showSelfHealPanel: boolean
  pendingSelfHealReportId: string | null
  showFeatureGeneratorPanel: boolean
  showArtifactsPanel: boolean
  pendingArtifactAttach: { artifactId: string; versionId?: string } | null
  bugReportDraft: BugReportDraft | null
  pendingErrorCount: number
  updateAvailable: { version: string } | null
  updateDownloaded: boolean
  activeSectionPane: ActiveSectionPane
  toasts: Toast[]
  toolApprovalRequests: ToolApprovalRequest[]
  unreadConversationIds: string[]
  catalogModels: CatalogModel[]
  globalDefaultModel: string
  debugLogging: boolean
  setTheme: (theme: Theme) => void
  setDebugLogging: (enabled: boolean) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  toggleAgentPanel: () => void
  setShowMcpPanel: (show: boolean) => void
  setShowSettings: (show: boolean) => void
  setShowSelfHealPanel: (show: boolean) => void
  setPendingSelfHealReportId: (reportId: string | null) => void
  setShowFeatureGeneratorPanel: (show: boolean) => void
  setShowArtifactsPanel: (show: boolean) => void
  requestArtifactAttach: (artifactId: string, versionId?: string) => void
  clearPendingArtifactAttach: () => void
  openBugReport: (draft?: BugReportDraft) => void
  closeBugReport: () => void
  incrementPendingErrorCount: () => void
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
  setGlobalDefaultModel: (model: string) => void
  addToolApprovalRequest: (request: ToolApprovalRequest) => void
  respondToToolApproval: (
    requestId: string,
    approved: boolean,
    remember: boolean
  ) => Promise<void>
  markConversationUnread: (id: string) => void
  markConversationRead: (id: string) => void
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
  showSelfHealPanel: false,
  pendingSelfHealReportId: null,
  showFeatureGeneratorPanel: false,
  showArtifactsPanel: false,
  pendingArtifactAttach: null,
  bugReportDraft: null,
  pendingErrorCount: 0,
  updateAvailable: null,
  updateDownloaded: false,
  activeSectionPane: null,
  toasts: [],
  toolApprovalRequests: [],
  unreadConversationIds: [],
  catalogModels: [],
  globalDefaultModel: 'default',
  debugLogging: false,

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

  setShowSelfHealPanel: (show) => {
    set((s) => {
      s.showSelfHealPanel = show
    })
  },

  setPendingSelfHealReportId: (reportId) => {
    set((s) => {
      s.pendingSelfHealReportId = reportId
    })
  },

  setShowFeatureGeneratorPanel: (show) => {
    set((s) => {
      s.showFeatureGeneratorPanel = show
    })
  },

  setShowArtifactsPanel: (show) => {
    set((s) => {
      s.showArtifactsPanel = show
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

  openBugReport: (draft) => {
    set((s) => {
      const pendingErrorCount = s.pendingErrorCount
      s.pendingErrorCount = 0
      s.bugReportDraft = draft ?? {
        title: 'Bug report',
        description: pendingErrorCount > 0 ? `${pendingErrorCount} recent app error(s) were detected.` : '',
      }
    })
  },

  closeBugReport: () => {
    set((s) => {
      s.bugReportDraft = null
    })
  },

  incrementPendingErrorCount: () => {
    set((s) => {
      s.pendingErrorCount = Math.min(s.pendingErrorCount + 1, 99)
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
})
