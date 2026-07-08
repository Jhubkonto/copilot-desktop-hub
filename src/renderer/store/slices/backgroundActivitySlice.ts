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
  applyActivitySnapshot: (snapshot: BackgroundActivity[]) => void
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

  // The server snapshot is authoritative for anything it knows about (so truly-ended activity
  // is removed even if this device never saw the end event locally), but preserves any locally
  // tracked entries not yet echoed back by the server (e.g. a generator turn started a moment
  // ago, or manual-workflow-generator which only has local-optimistic tracking).
  applyActivitySnapshot: (snapshot) => {
    set((s) => {
      const knownIds = new Set(snapshot.map((item) => item.id))
      const localOnly = s.backgroundActivities.filter((item) => !knownIds.has(item.id))
      s.backgroundActivities = [...snapshot, ...localOnly]
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
      return
    }
    if (activity.kind === 'chat' || activity.kind === 'debrief-generation' || activity.kind === 'quiz-generation' || activity.kind === 'orchestration') {
      if (activity.conversationId) {
        get().selectConversation(activity.conversationId)
      }
      return
    }
    if (activity.kind === 'build') {
      get().setSettingsInitialTab('developer')
      get().setShowSettings(true)
      return
    }
    if (activity.kind === 'remote-edit') {
      if (activity.projectId) {
        set((s) => {
          s.activeSectionPane = 'projects'
        })
        get().openEditProject(activity.projectId, 'changes')
      }
    }
  },
})
