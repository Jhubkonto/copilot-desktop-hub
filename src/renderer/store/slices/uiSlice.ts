import type { StateCreator } from 'zustand'
import type { AppState } from '../app-store'
import type {
  ActiveSectionPane,
  Theme,
  Toast,
  ToolApprovalRequest
} from '../types'
import type { CatalogModel } from '../../../shared/types'

export interface UiSlice {
  theme: Theme
  showSidebar: boolean
  showMcpPanel: boolean
  showSettings: boolean
  showOnboarding: boolean
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
  settingsInitialTab: string | null
  setSettingsInitialTab: (tab: string | null) => void
  setShowOnboarding: (show: boolean) => void
  setUpdateAvailable: (info: { version: string } | null) => void
  setUpdateDownloaded: (downloaded: boolean) => void
  setSectionPane: (section: ActiveSectionPane) => void
  openSectionPane: (section: Exclude<ActiveSectionPane, null>) => void
  addToast: (message: string, type?: Toast['type']) => void
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

  addToast: (message, type = 'info') => {
    const id = crypto.randomUUID()
    set((s) => {
      s.toasts.push({ id, message, type })
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
