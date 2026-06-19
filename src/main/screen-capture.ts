import { randomUUID } from 'crypto'
import { BrowserWindow, clipboard, desktopCapturer, ipcMain, screen, systemPreferences } from 'electron'
import { join } from 'path'

const pendingCaptures = new Map<string, Electron.NativeImage>()
let captureInProgress = false
let lastExternalWindowLabel: string | undefined = undefined
let suppressNextFocusEvent = false

export async function cacheExternalWindowLabel(ownWindowTitle: string): Promise<void> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
    })
    const external = sources.find(
      (source) => source.name.trim().length > 0 && !source.name.includes(ownWindowTitle),
    )
    lastExternalWindowLabel = external?.name ?? undefined
  } catch {
    lastExternalWindowLabel = undefined
  }
}

export function getLastExternalWindowLabel(): string | undefined {
  return lastExternalWindowLabel
}

export function consumeSuppressFocusEvent(): boolean {
  const val = suppressNextFocusEvent
  suppressNextFocusEvent = false
  return val
}

export function checkScreenPermission(): 'granted' | 'denied' | 'prompt' {
  if (process.platform !== 'darwin') return 'granted'
  return systemPreferences.getMediaAccessStatus('screen') as 'granted' | 'denied' | 'prompt'
}

export async function openRegionOverlay(
  display: Electron.Display,
  sessionId: string,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  if (process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland') {
    return null
  }

  return new Promise((resolve) => {
    let resolved = false

    const overlayWin = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,
      resizable: false,
      movable: false,
      webPreferences: {
        preload: join(__dirname, '../preload/overlay.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    if (process.platform === 'darwin') {
      overlayWin.setAlwaysOnTop(true, 'screen-saver')
    }
    overlayWin.setIgnoreMouseEvents(false)

    const getScreenshotHandler = (event: Electron.IpcMainInvokeEvent) => {
      if (event.sender !== overlayWin.webContents) return ''
      const nativeImg = pendingCaptures.get(sessionId)
      if (!nativeImg) return ''
      const preview = nativeImg.resize({
        width: display.bounds.width,
        quality: 'better',
      })
      return `data:image/jpeg;base64,${preview.toJPEG(80).toString('base64')}`
    }
    ipcMain.handle('overlay:get-screenshot', getScreenshotHandler)

    const cleanup = () => {
      ipcMain.off('overlay:ready', readyHandler)
      ipcMain.off('overlay:submit', submitHandler)
      ipcMain.off('overlay:cancel', cancelHandler)
      try {
        ipcMain.removeHandler('overlay:get-screenshot')
      } catch {
        // Ignore handler cleanup errors
      }
      pendingCaptures.delete(sessionId)
      if (!overlayWin.isDestroyed()) {
        overlayWin.close()
      }
    }

    const readyHandler = (event: Electron.IpcMainEvent) => {
      if (event.sender !== overlayWin.webContents) return
      overlayWin.webContents.send('overlay:screenshot-ready')
    }

    const submitHandler = (
      event: Electron.IpcMainEvent,
      rect: { x: number; y: number; width: number; height: number },
    ) => {
      if (event.sender !== overlayWin.webContents) return
      if (resolved) return
      resolved = true
      cleanup()
      resolve(rect)
    }

    const cancelHandler = (event: Electron.IpcMainEvent) => {
      if (event.sender !== overlayWin.webContents) return
      if (resolved) return
      resolved = true
      cleanup()
      resolve(null)
    }

    ipcMain.once('overlay:ready', readyHandler)
    ipcMain.once('overlay:submit', submitHandler)
    ipcMain.once('overlay:cancel', cancelHandler)

    overlayWin.once('closed', () => {
      if (!resolved) {
        resolved = true
        cleanup()
        resolve(null)
      }
    })

    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (rendererUrl) {
      overlayWin.loadURL(new URL('overlay.html', `${rendererUrl}/`).toString())
    } else {
      overlayWin.loadFile(join(__dirname, '../renderer/overlay.html'))
    }
    overlayWin.focus()
  })
}

export async function captureWithRegionSelection(
  mainWindow: BrowserWindow,
): Promise<{ dataUrl: string; windowLabel?: string } | { error: string }> {
  if (captureInProgress) return { error: 'Capture already in progress' }
  captureInProgress = true

  const sessionId = randomUUID()
  let mainWindowHidden = false

  try {
    if (process.platform === 'darwin') {
      const status = checkScreenPermission()
      if (status === 'denied') {
        return { error: 'Screen recording permission denied. Enable in System Settings → Privacy & Security → Screen Recording.' }
      }
    }

    const cursorPoint = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursorPoint)
    const { width, height } = display.size
    const scaleFactor = display.scaleFactor
    const nativeWidth = Math.round(width * scaleFactor)
    const nativeHeight = Math.round(height * scaleFactor)

    mainWindow.hide()
    mainWindowHidden = true
    await new Promise((resolve) => setTimeout(resolve, 400))

    let sources: Electron.DesktopCapturerSource[]
    try {
      sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: nativeWidth, height: nativeHeight },
      })
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Screen capture failed' }
    }

    if (sources.length === 0) {
      return { error: 'Screen recording permission denied. Enable in System Settings → Privacy & Security → Screen Recording.' }
    }

    const source = sources.find((candidate) => String(candidate.display_id) === String(display.id)) ?? sources[0]
    pendingCaptures.set(sessionId, source.thumbnail)

    const cssRect = await openRegionOverlay(display, sessionId)
    suppressNextFocusEvent = true
    mainWindow.show()
    mainWindowHidden = false

    if (cssRect === null) {
      return { error: 'Capture cancelled' }
    }

    const cropRect = {
      x: Math.round(cssRect.x * scaleFactor),
      y: Math.round(cssRect.y * scaleFactor),
      width: Math.round(cssRect.width * scaleFactor),
      height: Math.round(cssRect.height * scaleFactor),
    }

    let cropped = source.thumbnail.crop(cropRect)

    const MAX_EDGE = 1568
    const croppedSize = cropped.getSize()
    const longest = Math.max(croppedSize.width, croppedSize.height)
    if (longest > MAX_EDGE) {
      const scale = MAX_EDGE / longest
      cropped = cropped.resize({
        width: Math.round(croppedSize.width * scale),
        height: Math.round(croppedSize.height * scale),
        quality: 'better',
      })
    }

    return { dataUrl: cropped.toDataURL(), windowLabel: getLastExternalWindowLabel() }
  } finally {
    if (mainWindowHidden) {
      mainWindow.show()
    }
    pendingCaptures.delete(sessionId)
    captureInProgress = false
  }
}

export async function captureWindowContent(
  win: BrowserWindow,
): Promise<{ dataUrl: string } | { error: string }> {
  try {
    const image = await win.webContents.capturePage()
    let resized = image
    const MAX_EDGE = 1568
    const size = image.getSize()
    const longest = Math.max(size.width, size.height)
    if (longest > MAX_EDGE) {
      const scale = MAX_EDGE / longest
      resized = image.resize({
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
        quality: 'better',
      })
    }
    return { dataUrl: resized.toDataURL() }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Window capture failed' }
  }
}

export async function listOpenWindows(): Promise<{ title: string; id: string }[]> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
    })
    return sources
      .filter((s) => s.name.trim().length > 0)
      .map((s) => ({ title: s.name, id: s.id }))
  } catch {
    return []
  }
}

export async function captureWindowByTitle(
  title: string,
): Promise<{ dataUrl: string } | { error: string }> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1920, height: 1080 },
    })
    const match = sources.find((s) => s.name.toLowerCase().includes(title.toLowerCase()))
    if (!match) return { error: `No window matching "${title}" found` }

    let img = match.thumbnail
    const MAX_EDGE = 1568
    const size = img.getSize()
    const longest = Math.max(size.width, size.height)
    if (longest > MAX_EDGE) {
      const scale = MAX_EDGE / longest
      img = img.resize({
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
        quality: 'better',
      })
    }
    return { dataUrl: `data:image/jpeg;base64,${img.toJPEG(85).toString('base64')}` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Window capture failed' }
  }
}

export function readClipboardImage(): { dataUrl: string } | null {
  const img = clipboard.readImage()
  if (img.isEmpty()) return null
  const size = img.getSize()
  let resizedImg = img
  const MAX_EDGE = 1568
  const longest = Math.max(size.width, size.height)
  if (longest > MAX_EDGE) {
    const scale = MAX_EDGE / longest
    resizedImg = img.resize({
      width: Math.round(size.width * scale),
      height: Math.round(size.height * scale),
      quality: 'better',
    })
  }
  return { dataUrl: resizedImg.toDataURL() }
}

export function readClipboardContent():
  | { type: 'image'; dataUrl: string }
  | { type: 'text'; text: string }
  | null {
  const img = clipboard.readImage()
  if (!img.isEmpty()) {
    const size = img.getSize()
    let resizedImg = img
    const MAX_EDGE = 1568
    const longest = Math.max(size.width, size.height)
    if (longest > MAX_EDGE) {
      const scale = MAX_EDGE / longest
      resizedImg = img.resize({
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
        quality: 'better',
      })
    }
    return { type: 'image', dataUrl: resizedImg.toDataURL() }
  }

  const text = clipboard.readText()
  if (text.trim()) {
    return { type: 'text', text }
  }

  return null
}
