import { app, BrowserWindow, shell, globalShortcut, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { getDatabase, closeDatabase } from './database'
import { registerIpcHandlers } from './ipc-handlers'
import { registerAuthHandlers } from './auth'
import { registerCliHandlers, checkCliOnStartup } from './cli-detection'
import { shutdownCopilot } from './copilot'
import { disposeAllTerminals } from './terminal'
import { initMcpServers, shutdownMcpServers } from './mcp'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

const isDev = !app.isPackaged
const PROTOCOL = 'copilot-hub'

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
    title: 'Copilot Desktop Hub',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
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
}

function createTray(): void {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Copilot Desktop Hub',
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

  tray.setToolTip('Copilot Desktop Hub')
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

function handleDeepLink(url: string): void {
  if (!url.startsWith(`${PROTOCOL}://`)) return
  const parsed = new URL(url)
  // copilot-hub://chat/CONVERSATION_ID
  // copilot-hub://agent/AGENT_ID
  if (parsed.hostname === 'chat' && parsed.pathname.length > 1) {
    const conversationId = parsed.pathname.slice(1)
    mainWindow?.webContents.send('deeplink:open-chat', conversationId)
  } else if (parsed.hostname === 'agent' && parsed.pathname.length > 1) {
    const agentId = parsed.pathname.slice(1)
    mainWindow?.webContents.send('deeplink:open-agent', agentId)
  }
  mainWindow?.show()
  mainWindow?.focus()
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
  // Initialize database
  getDatabase()

  // Register all IPC handlers
  registerIpcHandlers()
  registerAuthHandlers()
  registerCliHandlers()

  // Check for Copilot CLI
  const cliStatus = checkCliOnStartup()
  if (!cliStatus.installed) {
    console.log('Copilot CLI not found — will show setup guidance in the UI')
  }

  createWindow()
  createTray()
  registerGlobalHotkey()

  // Apply auto-start setting
  const db = getDatabase()
  const autoStartRow = db.prepare("SELECT value FROM settings WHERE key = 'autoStart'").get() as { value: string } | undefined
  if (autoStartRow?.value === 'true') {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })
  }

  // Initialize MCP servers
  initMcpServers().catch((err) =>
    console.error('Failed to init MCP servers:', err)
  )

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
  disposeAllTerminals()
  shutdownMcpServers().catch(() => {})
  shutdownCopilot().catch(() => {})
  closeDatabase()
})
