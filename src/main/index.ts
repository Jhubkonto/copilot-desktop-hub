import { app, BrowserWindow, shell, globalShortcut, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { getDatabase, closeDatabase } from './database'
import { registerIpcHandlers } from './ipc-handlers'
import { registerAuthHandlers } from './auth'
import { registerCliHandlers, checkCliOnStartup } from './cli-detection'
import { shutdownCopilot } from './copilot'
import { disposeAllTerminals } from './terminal'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

const isDev = !app.isPackaged

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
  shutdownCopilot().catch(() => {})
  closeDatabase()
})
