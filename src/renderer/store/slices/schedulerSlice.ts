import type { StateCreator } from 'zustand'
import type { ScheduledTask } from '../../../shared/types'
import type { AppState } from '../app-store'

export interface SchedulerSlice {
  schedulerTasks: ScheduledTask[]
  setSchedulerTasks: (tasks: ScheduledTask[]) => void
  showSchedulerGenerator: boolean
  setShowSchedulerGenerator: (show: boolean) => void
  openCreateSchedulerTask: () => void
  schedulerTaskFormRequestId: number
}

export const createSchedulerSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  SchedulerSlice
> = (set) => ({
  schedulerTasks: [],
  showSchedulerGenerator: false,
  schedulerTaskFormRequestId: 0,

  setSchedulerTasks: (tasks) => {
    set((s) => { s.schedulerTasks = tasks })
  },

  setShowSchedulerGenerator: (show) => {
    set((s) => { s.showSchedulerGenerator = show })
  },

  openCreateSchedulerTask: () => {
    set((s) => { s.schedulerTaskFormRequestId += 1 })
  },
})
