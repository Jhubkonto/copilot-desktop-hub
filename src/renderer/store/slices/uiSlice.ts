import type { StateCreator } from 'zustand'
import type { AppState } from '../app-store'
import type {
  ActiveSectionPane,
  Theme,
  Toast,
  ToolApprovalRequest
} from '../types'

export interface UiSlice {
  theme: Theme
  showSidebar: boolean
  showTerminal: boolean
  showMcpPanel: boolean
  showSettings: boolean
  showOnboarding: boolean
  updateAvailable: { version: string } | null
  updateDownloaded: boolean
  activeSectionPane: ActiveSectionPane
  toasts: Toast[]
  toolApprovalRequests: ToolApprovalRequest[]
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  toggleTerminal: () => void
  toggleAgentPanel: () => void
  setShowMcpPanel: (show: boolean) => void
  setShowSettings: (show: boolean) => void
  setShowOnboarding: (show: boolean) => void
  setUpdateAvailable: (info: { version: string } | null) => void
  setUpdateDownloaded: (downloaded: boolean) => void
  setSectionPane: (section: ActiveSectionPane) => void
  addToast: (message: string, type?: Toast['type']) => void
  dismissToast: (id: string) => void
  addToolApprovalRequest: (request: ToolApprovalRequest) => void
  respondToToolApproval: (
    requestId: string,
    approved: boolean,
    remember: boolean
  ) => Promise<void>
}

export const createUiSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  UiSlice
> = (set, get) => ({
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

  setTheme: (theme) => {
    set((s) => {
      s.theme = theme
    })
    document.documentElement.classList.toggle('dark', theme === 'dark')
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

  toggleTerminal: () => {
    set((s) => {
      s.showTerminal = !s.showTerminal
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
  }
})