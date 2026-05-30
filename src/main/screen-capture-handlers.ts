import { BrowserWindow } from 'electron'
import { safeHandle } from './safe-handle'
import { captureWithRegionSelection, checkScreenPermission, readClipboardContent, readClipboardImage } from './screen-capture'

export function registerScreenCaptureHandlers(): void {
  safeHandle('screen:capture', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { error: 'No window found' }
    return captureWithRegionSelection(win)
  })
  safeHandle('screen:check-permission', () => checkScreenPermission())
  safeHandle('clipboard:read-content', () => readClipboardContent())
  safeHandle('clipboard:read-image', () => readClipboardImage())
}
