import { BrowserWindow, Notification } from 'electron'
import { safeHandle } from './safe-handle'
import { broadcastToMobile } from './ws-server'
import type { BackgroundActivity, BackgroundActivityKind } from '../shared/types'

/**
 * Cross-device "ongoing activity" registry — the main-process source of truth so activity
 * started on either desktop or Android (generation, chat streaming, builds, remote-edit,
 * orchestration, and the project/agent/skill/scheduler/automated-workflow generators) is visible
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
  const finished = activities.get(id)
  if (!finished) return
  activities.delete(id)
  notifyActivityFinished(finished)
  broadcast()
}

// ─────────────────────────────────────────────────────────────
// Desktop "activity finished" native notifications
// ─────────────────────────────────────────────────────────────

// Activities shorter than this are treated as trivial flicker (e.g. a generator that
// resolves near-instantly from cache) and don't warrant an OS notification.
const MIN_NOTIFY_DURATION_MS = 2_000

/**
 * The desktop is "in the foreground" only when a live window is actually on screen and
 * focused. When every window is minimized, hidden to the tray, or simply behind another
 * app, the user can't see the in-app activity sidebar clear itself — so that's exactly
 * when a native OS notification is worthwhile.
 */
function isDesktopInForeground(): boolean {
  try {
    return BrowserWindow.getAllWindows().some(
      (w) => !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused(),
    )
  } catch {
    // Test/headless environments stub BrowserWindow without these methods — assume
    // foreground so we don't attempt to fire notifications there.
    return true
  }
}

const ACTIVITY_DONE_TITLES: Record<BackgroundActivityKind, string> = {
  'project-generator': 'Project ready',
  'agent-generator': 'Agent ready',
  'skill-generator': 'Skill ready',
  'scheduler-generator': 'Schedule ready',
  'automated-workflow-generator': 'Workflow ready',
  'automated-workflow-run': 'Workflow finished',
  'debrief-generation': 'Debrief ready',
  'quiz-generation': 'Quiz ready',
  'teachback-generation': 'Teach-back ready',
  chat: 'Response ready',
  build: 'Build finished',
  'remote-edit': 'Code changes ready',
  orchestration: 'Orchestration finished',
}

function notifyActivityFinished(activity: BackgroundActivity): void {
  if (isDesktopInForeground()) return
  if (Date.now() - activity.startedAt < MIN_NOTIFY_DURATION_MS) return
  try {
    if (!Notification.isSupported()) return
    const notification = new Notification({
      title: ACTIVITY_DONE_TITLES[activity.kind] ?? 'Activity finished',
      body: activity.detail ? `${activity.label} — ${activity.detail}` : activity.label,
      silent: true,
    })
    notification.on('click', () => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
      win?.show()
      win?.focus()
      if (activity.conversationId && win && !win.webContents.isDestroyed()) {
        win.webContents.send('deeplink:open-chat', activity.conversationId)
      }
    })
    notification.show()
  } catch {
    // Notifications are best-effort — not available in every environment.
  }
}

export function getActivitySnapshot(): BackgroundActivity[] {
  return Array.from(activities.values())
}

export function registerActivityHandlers(): void {
  safeHandle('activity:list', (): BackgroundActivity[] => getActivitySnapshot())
  safeHandle('activity:dismiss', (_event, id: string): boolean => {
    endActivity(id)
    return true
  })
}
