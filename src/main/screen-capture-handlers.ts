import { BrowserWindow } from 'electron'
import { safeHandle } from './safe-handle'
import { captureWindowContent, captureWithRegionSelection, checkScreenPermission, readClipboardContent, readClipboardImage } from './screen-capture'
import { recognizeText } from './ocr'

export function registerScreenCaptureHandlers(): void {
  safeHandle('screen:capture', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { error: 'No window found' }
    return captureWithRegionSelection(win)
  })
  safeHandle('screen:capture-window', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { error: 'No window found' }
    return captureWindowContent(win)
  })
  safeHandle('screen:check-permission', () => checkScreenPermission())
  safeHandle('clipboard:read-content', () => readClipboardContent())
  safeHandle('clipboard:read-image', () => readClipboardImage())
  safeHandle('screen:ocr-image', async (_event, dataUrl: string) => {
    try {
      const text = await recognizeText(dataUrl)
      return { text }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
}
