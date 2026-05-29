import type { StateCreator } from 'zustand'
import type { AppState } from '../app-store'
import {
  DEFAULT_PROJECT_CONFIG,
  type Project,
  type ProjectAgent,
  type ProjectConfig,
  type ProjectOrchestrationConfig
} from '../types'

export interface ProjectSlice {
  projects: Project[]
  activeProjectId: string | null
  historyProjectId: string | null
  pendingSettingsProjectId: string | null
  showNewProjectForm: boolean
  editingProjectId: string | null
  projectsLoading: boolean
  projectAgents: Record<string, ProjectAgent[]>
  projectConfigs: Record<string, ProjectConfig>
  loadProjects: () => Promise<void>
  selectProject: (id: string | null) => void
  setHistoryProjectId: (id: string | null) => void
  createProject: (name: string, color: string) => Promise<void>
  renameProject: (id: string, name: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  setConversationProject: (
    conversationId: string,
    projectId: string | null
  ) => Promise<void>
  setProjectDefaultModel: (id: string, model: string | null) => Promise<void>
  clearPendingSettingsProject: () => void
  setShowNewProjectForm: (show: boolean) => void
  openEditProject: (id: string) => void
  closeEditProject: () => void
  duplicateProject: (id: string) => Promise<void>
  exportProject: (id: string) => Promise<void>
  loadProjectAgents: (projectId: string) => Promise<void>
  addAgentToProject: (projectId: string, agentId: string) => Promise<void>
  removeAgentFromProject: (projectId: string, agentId: string) => Promise<void>
  setProjectPrimaryAgent: (projectId: string, agentId: string) => Promise<void>
  reorderProjectAgents: (projectId: string, orderedAgentIds: string[]) => Promise<void>
  updateProjectOrchestration: (
    projectId: string,
    config: Partial<ProjectOrchestrationConfig>
  ) => Promise<void>
  updateProjectConfig: (
    projectId: string,
    config: Partial<ProjectConfig>
  ) => Promise<void>
  loadProjectConfig: (projectId: string) => Promise<void>
}

export const createProjectSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  ProjectSlice
> = (set, get) => ({
  projects: [],
  activeProjectId: null,
  historyProjectId: null,
  pendingSettingsProjectId: null,
  showNewProjectForm: false,
  editingProjectId: null,
  projectsLoading: false,
  projectAgents: {},
  projectConfigs: {},

  loadProjects: async () => {
    set((s) => {
      s.projectsLoading = true
    })
    try {
      const result = await window.api.listProjects()
      if (result?.error) {
        get().addToast('Failed to load projects', 'error')
      } else {
        set((s) => {
          s.projects = result
        })
      }
    } catch {
      get().addToast('Failed to load projects', 'error')
    } finally {
      set((s) => {
        s.projectsLoading = false
      })
    }
  },

  selectProject: (id) => {
    set((s) => {
      s.activeProjectId = id
      s.currentConversationId = null
      s.historyProjectId = id
      if (id !== null) s.activeSectionPane = 'projects'
    })
    if (id && id !== '__none__') {
      const existing = get().projectAgents[id]
      const applyPrimary = (agents: typeof existing) => {
        const primary = agents?.find((a) => a.isPrimary)
        if (primary)
          set((s) => {
            s.activeAgentId = primary.agentId
          })
      }
      if (existing) {
        applyPrimary(existing)
      } else {
        window.api
          .listProjectAgents(id)
          .then((result) => {
            if (!result?.error) {
              set((s) => {
                s.projectAgents[id] = result
              })
              applyPrimary(result)
            }
          })
          .catch(() => {
            /* ignore */
          })
      }
    } else {
      set((s) => {
        s.activeAgentId = null
      })
    }
  },

  setHistoryProjectId: (id) => {
    set((s) => {
      s.historyProjectId = id
    })
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
        s.editingProjectId = result.id
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
        if (s.historyProjectId === id) s.historyProjectId = null
      })
      await Promise.all([get().loadProjects(), get().loadConversations()])
      get().addToast('Project deleted', 'success')
    } catch {
      get().addToast('Failed to delete project', 'error')
    }
  },

  setConversationProject: async (conversationId, projectId) => {
    try {
      const result = await window.api.setConversationProject(
        conversationId,
        projectId
      )
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

  clearPendingSettingsProject: () => {
    set((s) => {
      s.pendingSettingsProjectId = null
    })
  },

  setShowNewProjectForm: (show) => {
    set((s) => {
      s.showNewProjectForm = show
    })
  },

  openEditProject: (id) => {
    set((s) => {
      s.editingProjectId = id
    })
  },

  closeEditProject: () => {
    set((s) => {
      s.editingProjectId = null
    })
  },

  duplicateProject: async (id) => {
    try {
      const result = await window.api.duplicateProject(id)
      if (!result || result?.error) {
        get().addToast('Failed to duplicate project', 'error')
        return
      }
      await get().loadProjects()
      get().addToast('Project duplicated', 'success')
    } catch {
      get().addToast('Failed to duplicate project', 'error')
    }
  },

  exportProject: async (id) => {
    try {
      const result = await window.api.exportProject(id)
      if (result?.error) {
        get().addToast('Failed to export project', 'error')
        return
      }
      if (result) get().addToast('Project exported', 'success')
    } catch {
      get().addToast('Failed to export project', 'error')
    }
  },

  loadProjectAgents: async (projectId) => {
    try {
      const result = await window.api.listProjectAgents(projectId)
      if (result?.error) {
        get().addToast('Failed to load project agents', 'error')
        return
      }
      set((s) => {
        s.projectAgents[projectId] = result
      })
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
    } catch {
      /* ignore */
    }
  },

  updateProjectConfig: async (projectId, config) => {
    const prev = get().projectConfigs[projectId] ?? DEFAULT_PROJECT_CONFIG
    set((s) => {
      s.projectConfigs[projectId] = { ...prev, ...config }
    })
    try {
      await window.api.updateProjectConfig(
        projectId,
        config as Record<string, unknown>
      )
    } catch {
      set((s) => {
        s.projectConfigs[projectId] = prev
      })
      get().addToast('Failed to update project settings', 'error')
    }
  },

  updateProjectOrchestration: async (projectId, config) => {
    set((s) => {
      const current = s.projectConfigs[projectId] ?? DEFAULT_PROJECT_CONFIG
      s.projectConfigs[projectId] = { ...current, ...config }
    })
    try {
      await window.api.updateProjectConfig(
        projectId,
        config as Record<string, unknown>
      )
    } catch {
      get().addToast('Failed to update orchestration settings', 'error')
    }
  }
})