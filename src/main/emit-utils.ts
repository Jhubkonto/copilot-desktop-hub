import { BrowserWindow } from 'electron'
import { broadcastToMobile } from './ws-server'

/**
 * Fan a push event out to the desktop renderer(s) AND the Android companion in one call.
 * Replaces the hand-duplicated `webContents.send(...)` + `broadcastToMobile(...)` pairs.
 *
 * Pass `win` when the caller already holds the target window (e.g. handlers registered
 * with a mainWindow reference); otherwise every open window receives the event.
 */
export function emitToAll(event: string, data?: unknown, win?: BrowserWindow | null): void {
  const targets = win && !win.isDestroyed() ? [win] : BrowserWindow.getAllWindows()
  for (const w of targets) {
    if (!w.isDestroyed()) w.webContents.send(event, data)
  }
  broadcastToMobile({ event, data })
}
