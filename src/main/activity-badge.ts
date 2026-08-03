import { app, BrowserWindow, nativeImage } from 'electron'
import { getDatabase } from './database'
import type { BackgroundActivity } from '../shared/types'

const SETTINGS_KEY = 'unseenActivityDestinations'

let initialized = false
let unseenDestinations = new Set<string>()
let viewedConversationId: string | null = null

function destinationFor(activity: BackgroundActivity): string {
  if (activity.conversationId) return `chat:${activity.conversationId}`
  return `activity:${activity.id}`
}

function desktopIsFocused(): boolean {
  try {
    return BrowserWindow.getAllWindows().some(
      (win) => !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused(),
    )
  } catch {
    return true
  }
}

function persist(): void {
  try {
    getDatabase()
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(SETTINGS_KEY, JSON.stringify([...unseenDestinations]))
  } catch {
    // Badge persistence is best-effort during startup and isolated tests.
  }
}

function windowsOverlay(count: number) {
  if (count <= 0) return null
  const label = count > 9 ? '9+' : String(count)
  const fontSize = label.length > 1 ? 8 : 10
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">',
    '<circle cx="8" cy="8" r="7.25" fill="#dc2626" stroke="white" stroke-width="1.5"/>',
    `<text x="8" y="11.2" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${fontSize}" font-weight="700" fill="white">${label}</text>`,
    '</svg>',
  ].join('')
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
}

function applyNativeBadge(): void {
  const count = unseenDestinations.size
  try {
    if (process.platform === 'win32') {
      const overlay = windowsOverlay(count)
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.setOverlayIcon(overlay, count > 0 ? `${count} unseen Nexy activities` : '')
        }
      })
    } else {
      app.setBadgeCount(count)
    }
  } catch {
    // Badges are not supported by every Linux desktop environment or test stub.
  }
}

function broadcastUnseenConversations(): void {
  const conversationIds = getUnseenConversationIds()
  try {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('activity-badge:changed', conversationIds)
      }
    })
  } catch {
    // Best-effort renderer synchronization; native badge state remains authoritative.
  }
}

export function initializeActivityBadge(): void {
  if (!initialized) {
    initialized = true
    try {
      const row = getDatabase()
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get(SETTINGS_KEY) as { value: string } | undefined
      const parsed = row ? JSON.parse(row.value) : []
      if (Array.isArray(parsed)) {
        unseenDestinations = new Set(parsed.filter((value): value is string => typeof value === 'string'))
      }
    } catch {
      unseenDestinations = new Set()
    }
  }
  applyNativeBadge()
}

export function recordUnseenActivity(activity: BackgroundActivity): void {
  const destination = destinationFor(activity)
  const isViewedChat =
    activity.conversationId != null &&
    activity.conversationId === viewedConversationId &&
    desktopIsFocused()
  if (isViewedChat) return
  recordUnseenDestination(destination)
}

export function recordUnseenDestination(destination: string): void {
  initializeActivityBadge()
  if (!destination.startsWith('chat:') && desktopIsFocused()) return
  if (unseenDestinations.has(destination)) return
  unseenDestinations.add(destination)
  persist()
  applyNativeBadge()
  if (destination.startsWith('chat:')) broadcastUnseenConversations()
}

export function clearUnseenDestination(destination: string): number {
  initializeActivityBadge()
  if (unseenDestinations.delete(destination)) {
    persist()
    applyNativeBadge()
    if (destination.startsWith('chat:')) broadcastUnseenConversations()
  }
  return unseenDestinations.size
}

export function setViewedConversation(conversationId: string | null): number {
  initializeActivityBadge()
  viewedConversationId = conversationId
  return conversationId
    ? clearUnseenDestination(`chat:${conversationId}`)
    : unseenDestinations.size
}

export function markApplicationViewed(): number {
  initializeActivityBadge()
  const viewedChatDestination = viewedConversationId ? `chat:${viewedConversationId}` : null
  const remaining = [...unseenDestinations].filter(
    (destination) => destination.startsWith('chat:') && destination !== viewedChatDestination,
  )
  if (remaining.length !== unseenDestinations.size) {
    unseenDestinations = new Set(remaining)
    persist()
    applyNativeBadge()
    broadcastUnseenConversations()
  }
  return unseenDestinations.size
}

export function getUnseenActivityCount(): number {
  initializeActivityBadge()
  return unseenDestinations.size
}

export function getUnseenConversationIds(): string[] {
  initializeActivityBadge()
  return [...unseenDestinations]
    .filter((destination) => destination.startsWith('chat:'))
    .map((destination) => destination.slice('chat:'.length))
}

export function resetActivityBadgeForTests(): void {
  initialized = false
  unseenDestinations = new Set()
  viewedConversationId = null
}
