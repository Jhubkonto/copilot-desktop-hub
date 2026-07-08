import { BrowserWindow } from 'electron'
import { safeHandle } from './safe-handle'
import { broadcastToMobile } from './ws-server'
import type { BackgroundActivity } from '../shared/types'

/**
 * Cross-device "ongoing activity" registry — the main-process source of truth so activity
 * started on either desktop or Android (generation, chat streaming, builds, remote-edit,
 * orchestration, and the project/agent/skill/scheduler/manual-workflow generators) is visible
 * on both. Mirrors the round-trip pattern used for conversation complete/incomplete: every
 * mutation pushes the full snapshot to all desktop windows and to connected mobile clients.
 */
const activities = new Map<string, BackgroundActivity>()

function broadcast(): void {
  const snapshot = getActivitySnapshot()
  try {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.webContents.send('activity:changed', snapshot)
    })
  } catch {
    // Best-effort desktop push — some test environments stub BrowserWindow without
    // getAllWindows since their code under test previously never called it directly.
  }
  broadcastToMobile({ event: 'activity:changed', data: { activities: snapshot } })
}

export function startActivity(activity: Omit<BackgroundActivity, 'startedAt'> & { startedAt?: number }): void {
  const existing = activities.get(activity.id)
  activities.set(activity.id, {
    ...activity,
    startedAt: existing?.startedAt ?? activity.startedAt ?? Date.now(),
  })
  broadcast()
}

export function updateActivity(id: string, patch: Partial<Omit<BackgroundActivity, 'id' | 'startedAt'>>): void {
  const existing = activities.get(id)
  if (!existing) return
  activities.set(id, { ...existing, ...patch })
  broadcast()
}

export function endActivity(id: string): void {
  if (!activities.has(id)) return
  activities.delete(id)
  broadcast()
}

export function getActivitySnapshot(): BackgroundActivity[] {
  return Array.from(activities.values())
}

export function registerActivityHandlers(): void {
  safeHandle('activity:list', (): BackgroundActivity[] => getActivitySnapshot())
}
