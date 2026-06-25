import type { StateCreator } from 'zustand'
import type { ScheduledTask } from '../../../shared/types'
import type { AppState } from '../app-store'

export interface SchedulerSlice {
  schedulerTasks: ScheduledTask[]
  setSchedulerTasks: (tasks: ScheduledTask[]) => void
  showSchedulerGenerator: boolean
  setShowSchedulerGenerator: (show: boolean) => void
}

export const createSchedulerSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  SchedulerSlice
> = (set) => ({
  schedulerTasks: [],
  showSchedulerGenerator: false,

  setSchedulerTasks: (tasks) => {
    set((s) => { s.schedulerTasks = tasks })
  },

  setShowSchedulerGenerator: (show) => {
    set((s) => { s.showSchedulerGenerator = show })
  },
})
