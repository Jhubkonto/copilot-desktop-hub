import type { StateCreator } from 'zustand'
import type { AgentConfig } from '../../../shared/types'
import { isApiError } from '../../../shared/types'
import type { AppState } from '../app-store'
import type { DeleteAgentImpact } from '../types'

export interface AgentSlice {
  agents: AgentConfig[]
  activeAgentId: string | null
  historyAgentId: string | null
  editingAgentId: string | null
  showAgentPanel: boolean
  showAgentGenerator: boolean
  agentsLoading: boolean
  pendingDeleteAgent: DeleteAgentImpact | null
  loadAgents: () => Promise<void>
  selectAgent: (id: string | null) => void
  setHistoryAgentId: (id: string | null) => void
  setActiveAgentId: (id: string | null) => void
  openCreateAgent: () => void
  openEditAgent: (id: string) => void
  closeAgentPanel: () => void
  setShowAgentGenerator: (show: boolean) => void
  saveAgent: (config: AgentConfig) => Promise<void>
  deleteAgent: (id: string) => Promise<void>
  confirmDeleteAgent: () => Promise<void>
  cancelDeleteAgent: () => void
  duplicateAgent: (id: string) => Promise<void>
  exportAgent: (id: string) => Promise<void>
  importAgent: () => Promise<void>
}

export const createAgentSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  AgentSlice
> = (set, get) => ({
  agents: [],
  activeAgentId: null,
  historyAgentId: null,
  editingAgentId: null,
  showAgentPanel: false,
  showAgentGenerator: false,
  agentsLoading: false,
  pendingDeleteAgent: null,

  loadAgents: async () => {
    set((s) => {
      s.agentsLoading = true
    })
    try {
      const result = await window.api.listAgents()
      if (isApiError(result)) {
        get().addToast('Failed to load agents', 'error')
      } else {
        set((s) => {
          s.agents = result
        })
      }
    } catch {
      get().addToast('Failed to load agents', 'error')
    } finally {
      set((s) => {
        s.agentsLoading = false
      })
    }
  },

  selectAgent: (id) => {
    set((s) => {
      s.activeAgentId = id
      s.activeProjectId = null
      s.currentConversationId = null
    })
  },

  setHistoryAgentId: (id) => {
    set((s) => {
      s.historyAgentId = id
      if (id !== null) {
        s.activeSectionPane = 'agents'
        s.activeAgentId = id
        s.activeProjectId = null
        s.currentConversationId = null
      }
    })
  },

  setActiveAgentId: (id) => {
    set((s) => {
      s.activeAgentId = id
    })
  },

  openCreateAgent: () => {
    set((s) => {
      s.editingAgentId = null
      s.showAgentPanel = true
    })
  },

  openEditAgent: (id) => {
    set((s) => {
      s.editingAgentId = id
      s.showAgentPanel = true
    })
  },

  closeAgentPanel: () => {
    set((s) => {
      s.showAgentPanel = false
    })
  },

  setShowAgentGenerator: (show) => {
    set((s) => {
      s.showAgentGenerator = show
    })
  },

  saveAgent: async (config) => {
    try {
      const { editingAgentId, activeAgentId } = get()
      if (config.id && editingAgentId) {
        const result = await window.api.updateAgent(config.id, config)
        if (isApiError(result)) {
          get().addToast('Failed to update agent', 'error')
          return
        }
        get().addToast(`Agent "${config.name}" updated`, 'success')
      } else {
        const result = await window.api.createAgent(config)
        if (isApiError(result)) {
          get().addToast('Failed to create agent', 'error')
          return
        }
        if (result && !activeAgentId) {
          set((s) => {
            s.activeAgentId = result.id
          })
        }
        get().addToast(`Agent "${config.name}" created`, 'success')
      }
      await get().loadAgents()
      set((s) => {
        s.showAgentPanel = false
      })
    } catch {
      get().addToast('Failed to save agent', 'error')
    }
  },

  deleteAgent: async (id) => {
    try {
      const agent = get().agents.find((a) => a.id === id)
      const preflight = await window.api.deleteAgentPreflight(id)
      if (isApiError(preflight)) {
        get().addToast('Failed to check agent impact', 'error')
        return
      }
      const { affectedProjects, affectedConvCount } = preflight
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
    set((s) => {
      s.pendingDeleteAgent = null
    })
    try {
      const result = await window.api.deleteAgent(pending.agentId)
      if (isApiError(result) || result?.success === false) {
        get().addToast((!isApiError(result) && result?.reason) || 'Failed to delete agent', 'error')
        return
      }
      set((s) => {
        if (s.activeAgentId === pending.agentId) s.activeAgentId = null
        if (s.historyAgentId === pending.agentId) s.historyAgentId = null
        s.showAgentPanel = false
      })
      await get().loadAgents()
      await get().loadProjects()
      await get().loadConversations()
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
    set((s) => {
      s.pendingDeleteAgent = null
    })
  },

  duplicateAgent: async (id) => {
    try {
      const result = await window.api.duplicateAgent(id)
      if (isApiError(result)) {
        get().addToast('Failed to duplicate agent', 'error')
        return
      }
      await get().loadAgents()
      set((s) => {
        s.showAgentPanel = false
      })
      get().addToast('Agent duplicated', 'success')
    } catch {
      get().addToast('Failed to duplicate agent', 'error')
    }
  },

  exportAgent: async (id) => {
    try {
      const result = await window.api.exportAgent(id)
      if (isApiError(result)) {
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
      if (isApiError(result)) {
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
  }
})
