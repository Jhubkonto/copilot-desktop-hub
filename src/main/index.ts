import { app, BrowserWindow, shell, globalShortcut, Tray, Menu, nativeImage, ipcMain, powerMonitor } from 'electron'
import { join } from 'path'
import { getDatabase, closeDatabase } from './database'
import { registerIpcHandlers } from './ipc-handlers'
import { registerAuthHandlers } from './auth'
import { initMcpServers, shutdownMcpServers } from './mcp'
import { initAutoUpdater, registerUpdaterHandlers, checkForUpdatesOnStartup } from './updater'
import { loadModelCatalog } from './model-catalog'
import { ClaudeAdapter } from './cli-adapters/claude'
import { probeClaudeCliModels, cacheClaudeCliPtyModels } from './cli-adapters/claude-model-probe'
import { initLogger } from './logger'
import { validateSender } from './safe-handle'
import { initDebugMode, debugLog } from './debug-mode'
import { initErrorLogCapture } from './error-log-handlers'
import { autoStartWsServerIfEnabled, startWsServerIfNeeded, getCurrentPairingUrl, setIpChangeCallback, setClientCountChangeCallback } from './ws-server'
import { sendDesktopOnlinePush, sendIpChangedPush } from './fcm-sender'
import { schedulerEngine } from './scheduler-engine'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

const isDev = !app.isPackaged
const PROTOCOL = 'nexy'

// Register deep link protocol
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      join(__dirname, '..')
    ])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: 'Nexy',
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Content Security Policy — relaxed in dev for Vite HMR
  const devCsp = isDev ? " http://localhost:* ws://localhost:*" : ""
  const scriptSrc = isDev ? "'self' 'unsafe-inline' http://localhost:* ws://localhost:*" : "'self'"
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'${devCsp}; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'${devCsp}; img-src 'self' data: https:; connect-src 'self' https://api.openai.com https://api.anthropic.com https://*.openai.azure.com https://api.github.com${devCsp}; font-src 'self'${devCsp}`
        ]
      }
    })
  })

  mainWindow.on('ready-to-show', () => {
    const db = getDatabase()
    const zoomRow = db.prepare("SELECT value FROM settings WHERE key = 'zoomFactor'").get() as { value: string } | undefined
    if (zoomRow) {
      const factor = parseFloat(zoomRow.value)
      if (!isNaN(factor) && factor >= 0.5 && factor <= 3.0) {
        mainWindow?.webContents.setZoomFactor(factor)
      }
    }
    mainWindow?.show()
    if (mainWindow) {
      void loadModelCatalog(mainWindow).catch(() => {})
    }
    if (ClaudeAdapter.isAvailable()) {
      void probeClaudeCliModels()
        .then((models) => {
          cacheClaudeCliPtyModels(models)
          if (models.length > 0) mainWindow?.webContents.send('model:cli-models-updated')
        })
        .catch(() => {})
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Allow opening DevTools with Ctrl+Shift+I in any mode
  mainWindow.webContents.on('before-input-event', (_, input) => {
    if (input.control && input.shift && input.key === 'I') {
      mainWindow?.webContents.toggleDevTools()
    }
  })
}

function createTray(): void {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Nexy',
      click: () => mainWindow?.show()
    },
    {
      label: 'New Chat',
      click: () => {
        mainWindow?.show()
        mainWindow?.webContents.send('chat:new')
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit()
    }
  ])

  tray.setToolTip('Nexy')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
    }
  })
}

function registerGlobalHotkey(): void {
  const hotkey = process.platform === 'darwin' ? 'CommandOrControl+Shift+H' : 'Ctrl+Shift+H'

  globalShortcut.register(hotkey, () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function handleDeepLink(url: string): void {
  if (!url.startsWith(`${PROTOCOL}://`)) return
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'chat' && parsed.pathname.length > 1) {
      const conversationId = parsed.pathname.slice(1)
      if (!UUID_RE.test(conversationId)) return
      mainWindow?.webContents.send('deeplink:open-chat', conversationId)
    } else if (parsed.hostname === 'agent' && parsed.pathname.length > 1) {
      const agentId = parsed.pathname.slice(1)
      if (!UUID_RE.test(agentId)) return
      mainWindow?.webContents.send('deeplink:open-agent', agentId)
    }
    mainWindow?.show()
    mainWindow?.focus()
  } catch {
    debugLog('app', `invalid deep link URL: ${url}`)
    console.warn('[app] invalid deep link URL:', url)
  }
}

// Handle deep links on second instance (Windows/Linux)
app.on('second-instance', (_event, commandLine) => {
  const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`))
  if (url) handleDeepLink(url)
  mainWindow?.show()
  mainWindow?.focus()
})

// Handle deep links on macOS
app.on('open-url', (_event, url) => {
  handleDeepLink(url)
})

app.whenReady().then(() => {
  initLogger()

  // Windows uses the AppUserModelID as the notification/toast sender name.
  // Without this, Electron falls back to the default "electron.app.Nexy".
  // Must match the NSIS appId in electron-builder.yml.
  app.setAppUserModelId('com.nexy.app')

  // Remove the default Electron application menu
  Menu.setApplicationMenu(null)

  // Initialize database
  getDatabase()

  // Start scheduler after DB is ready
  schedulerEngine.start()

  registerAuthHandlers()
  registerUpdaterHandlers()

  createWindow()
  registerIpcHandlers(mainWindow ?? undefined)
  setIpChangeCallback((newUrl) => {
    void sendIpChangedPush(getDatabase(), newUrl).catch(() => {})
  })

  setClientCountChangeCallback((count) => {
    if (tray) {
      tray.setToolTip(
        count > 0
          ? `Nexy — ${count} Android ${count === 1 ? 'device' : 'devices'} connected (wakelock active)`
          : 'Nexy — No mobile clients'
      )
    }
    mainWindow?.webContents.send('ws:client-count', count)
  })

  void autoStartWsServerIfEnabled().then(() => {
    const url = getCurrentPairingUrl()
    if (url) void sendDesktopOnlinePush(getDatabase(), url).catch(() => {})
  })

  powerMonitor.on('resume', () => {
    void startWsServerIfNeeded().then(() => {
      const url = getCurrentPairingUrl()
      if (url) void sendDesktopOnlinePush(getDatabase(), url).catch(() => {})
    })
  })
  createTray()
  registerGlobalHotkey()

  // Window control IPC handlers (use sender to target the correct window)
  const EDIT_ACTIONS = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])

  ipcMain.handle('window:minimize', (event) => {
    if (!validateSender(event)) return
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('window:maximize', (event) => {
    if (!validateSender(event)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize(); else win.maximize()
  })
  ipcMain.handle('window:close', (event) => {
    if (!validateSender(event)) return
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle('window:is-maximized', (event) => {
    if (!validateSender(event)) return false
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })
  ipcMain.handle('window:edit-action', (event, action: string) => {
    if (!validateSender(event)) return
    if (!EDIT_ACTIONS.has(action)) return
    const wc = BrowserWindow.fromWebContents(event.sender)?.webContents
    if (!wc) return
    ;(wc as unknown as Record<string, () => void>)[action]?.()
  })
  ipcMain.handle('window:zoom', (event, delta: number) => {
    if (!validateSender(event)) return
    const wc = BrowserWindow.fromWebContents(event.sender)?.webContents
    if (!wc) return
    const db = getDatabase()
    if (delta === 0) {
      wc.setZoomFactor(1.0)
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('zoomFactor', '1')").run()
    } else {
      const STEP = 0.1
      const current = wc.getZoomFactor()
      const next = Math.round(Math.min(3.0, Math.max(0.5, current + (delta > 0 ? STEP : -STEP))) * 10) / 10
      wc.setZoomFactor(next)
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('zoomFactor', ?)").run(String(next))
    }
  })

  // Forward maximize/restore state changes to the renderer
  if (mainWindow) {
    const sendMaximizeChange = (maximized: boolean) =>
      mainWindow?.webContents.send('window:maximize-change', maximized)
    mainWindow.on('maximize', () => sendMaximizeChange(true))
    mainWindow.on('unmaximize', () => sendMaximizeChange(false))
    mainWindow.on('enter-full-screen', () => sendMaximizeChange(true))
    mainWindow.on('leave-full-screen', () => sendMaximizeChange(false))
  }

  // Initialize auto-updater
  if (mainWindow) {
    initDebugMode(mainWindow)
    initErrorLogCapture(mainWindow)
    initAutoUpdater(mainWindow)
    checkForUpdatesOnStartup()
  }

  // Apply auto-start setting
  const db = getDatabase()
  const autoStartRow = db.prepare("SELECT value FROM settings WHERE key = 'autoStart'").get() as { value: string } | undefined
  if (autoStartRow?.value === 'true') {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })
  }

  // Initialize MCP servers
  initMcpServers().catch((err) => {
    debugLog('mcp', `init failed at startup: ${err instanceof Error ? err.message : String(err)}`)
    console.error('[mcp] failed to init servers at startup:', err)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  shutdownMcpServers().catch(() => {})
  closeDatabase()
})
