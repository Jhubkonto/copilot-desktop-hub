import type { StateCreator } from 'zustand'
import type { AppState } from '../app-store'
import type { BackgroundActivity } from '../types'

type BackgroundActivityInput =
  Omit<BackgroundActivity, 'startedAt'> &
  Partial<Pick<BackgroundActivity, 'startedAt'>>

export interface BackgroundActivitySlice {
  backgroundActivities: BackgroundActivity[]
  upsertBackgroundActivity: (activity: BackgroundActivityInput) => void
  removeBackgroundActivity: (id: string) => void
  openBackgroundActivity: (activity: BackgroundActivity) => void
}

export const createBackgroundActivitySlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  BackgroundActivitySlice
> = (set, get) => ({
  backgroundActivities: [],

  upsertBackgroundActivity: (activity) => {
    set((s) => {
      const existing = s.backgroundActivities.find((item) => item.id === activity.id)
      const next: BackgroundActivity = {
        ...activity,
        startedAt: existing?.startedAt ?? activity.startedAt ?? Date.now(),
      }
      if (existing) {
        s.backgroundActivities = s.backgroundActivities.map((item) =>
          item.id === activity.id ? { ...item, ...next } : item
        )
      } else {
        s.backgroundActivities.push(next)
      }
    })
  },

  removeBackgroundActivity: (id) => {
    set((s) => {
      s.backgroundActivities = s.backgroundActivities.filter((item) => item.id !== id)
    })
  },

  openBackgroundActivity: (activity) => {
    if (activity.kind === 'project-generator') {
      get().setShowProjectGenerator(true)
      return
    }
    if (activity.kind === 'agent-generator') {
      get().setShowAgentGenerator(true)
      return
    }
    if (activity.kind === 'skill-generator') {
      get().setShowSkillGenerator(true)
      return
    }
    if (activity.kind === 'scheduler-generator') {
      get().setShowSchedulerGenerator(true)
      return
    }
    if (activity.kind === 'manual-workflow-generator') {
      set((s) => {
        s.activeSectionPane = 'projects'
      })
      if (activity.projectId) {
        get().openEditProject(activity.projectId, 'workflow')
      }
    }
  },
})
