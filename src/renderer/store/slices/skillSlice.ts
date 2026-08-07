import type { StateCreator } from 'zustand'
import type { DiscoveredSkill, SkillConfig } from '../../../shared/types'
import { isApiError } from '../../../shared/types'
import type { AppState } from '../app-store'

export interface SkillSlice {
  skills: SkillConfig[]
  skillsLoading: boolean
  editingSkillId: string | null
  showSkillPanel: boolean
  showSkillGenerator: boolean
  discoveredSkills: DiscoveredSkill[]
  discoveringSkills: boolean
  loadSkills: () => Promise<void>
  discoverSkills: (projectId?: string) => Promise<void>
  importDiscoveredSkill: (discovery: DiscoveredSkill) => Promise<void>
  openCreateSkill: () => void
  openEditSkill: (id: string) => void
  closeSkillPanel: () => void
  setShowSkillGenerator: (show: boolean) => void
  saveSkill: (config: SkillConfig) => Promise<void>
  deleteSkill: (id: string) => Promise<void>
  duplicateSkill: (id: string) => Promise<void>
  exportSkill: (id: string) => Promise<void>
  exportSkillMarkdown: (id: string) => Promise<void>
  importSkill: () => Promise<void>
}

export const createSkillSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  SkillSlice
> = (set, get) => ({
  skills: [],
  skillsLoading: false,
  editingSkillId: null,
  showSkillPanel: false,
  showSkillGenerator: false,
  discoveredSkills: [],
  discoveringSkills: false,

  loadSkills: async () => {
    set((s) => { s.skillsLoading = true })
    try {
      const result = await window.api.listSkills()
      if (isApiError(result)) {
        get().addToast('Failed to load skills', 'error')
      } else {
        set((s) => { s.skills = result })
      }
    } catch {
      get().addToast('Failed to load skills', 'error')
    } finally {
      set((s) => { s.skillsLoading = false })
    }
  },

  openCreateSkill: () => {
    set((s) => {
      s.editingSkillId = null
      s.showSkillPanel = true
    })
  },

  openEditSkill: (id) => {
    set((s) => {
      s.editingSkillId = id
      s.showSkillPanel = true
    })
  },

  closeSkillPanel: () => {
    set((s) => { s.showSkillPanel = false })
  },

  setShowSkillGenerator: (show) => {
    set((s) => { s.showSkillGenerator = show })
  },

  saveSkill: async (config) => {
    try {
      if (config.id && get().editingSkillId) {
        const result = await window.api.updateSkill(config.id, config)
        if (isApiError(result)) {
          get().addToast('Failed to update skill', 'error')
          return
        }
        get().addToast(`Skill "${config.name}" updated`, 'success')
      } else {
        const result = await window.api.createSkill(config)
        if (isApiError(result)) {
          get().addToast('Failed to create skill', 'error')
          return
        }
        get().addToast(`Skill "${config.name}" created`, 'success')
      }
      await get().loadSkills()
      set((s) => { s.showSkillPanel = false })
    } catch {
      get().addToast('Failed to save skill', 'error')
    }
  },

  deleteSkill: async (id) => {
    try {
      const result = await window.api.deleteSkill(id)
      if (isApiError(result)) {
        get().addToast('Failed to delete skill', 'error')
        return
      }
      await get().loadSkills()
      set((s) => {
        if (s.editingSkillId === id) s.showSkillPanel = false
      })
      get().addToast('Skill deleted', 'success')
    } catch {
      get().addToast('Failed to delete skill', 'error')
    }
  },

  duplicateSkill: async (id) => {
    try {
      const result = await window.api.duplicateSkill(id)
      if (isApiError(result)) {
        get().addToast('Failed to duplicate skill', 'error')
        return
      }
      await get().loadSkills()
      get().addToast('Skill duplicated', 'success')
    } catch {
      get().addToast('Failed to duplicate skill', 'error')
    }
  },

  exportSkill: async (id) => {
    try {
      const result = await window.api.exportSkill(id)
      if (isApiError(result)) {
        get().addToast('Failed to export skill', 'error')
        return
      }
      if (result) get().addToast('Skill exported', 'success')
    } catch {
      get().addToast('Failed to export skill', 'error')
    }
  },

  exportSkillMarkdown: async (id) => {
    try {
      const result = await window.api.exportSkillMarkdown(id)
      if (isApiError(result)) {
        get().addToast('Failed to export skill', 'error')
        return
      }
      if (result) get().addToast('Skill exported as SKILL.md', 'success')
    } catch {
      get().addToast('Failed to export skill', 'error')
    }
  },

  importSkill: async () => {
    try {
      const result = await window.api.importSkill()
      if (isApiError(result)) {
        get().addToast('Failed to import skill', 'error')
        return
      }
      if (result) {
        await get().loadSkills()
        get().addToast('Skill imported', 'success')
      }
    } catch {
      get().addToast('Failed to import skill', 'error')
    }
  },

  discoverSkills: async (projectId) => {
    set((s) => { s.discoveringSkills = true })
    try {
      const result = await window.api.discoverSkills(projectId)
      if (isApiError(result)) {
        get().addToast('Failed to scan for skills', 'error')
        return
      }
      set((s) => { s.discoveredSkills = result })
    } catch {
      get().addToast('Failed to scan for skills', 'error')
    } finally {
      set((s) => { s.discoveringSkills = false })
    }
  },

  importDiscoveredSkill: async (discovery) => {
    try {
      const result = await window.api.importDiscoveredSkill(discovery)
      if (isApiError(result)) {
        get().addToast('Failed to import skill', 'error')
        return
      }
      if (result) {
        await get().loadSkills()
        // Reflect the new imported state without a full rescan.
        set((s) => {
          const match = s.discoveredSkills.find((d) => d.packagePath === discovery.packagePath)
          if (match) match.alreadyImported = true
        })
        get().addToast(`Skill "${result.name}" imported`, 'success')
      }
    } catch {
      get().addToast('Failed to import skill', 'error')
    }
  },
})
