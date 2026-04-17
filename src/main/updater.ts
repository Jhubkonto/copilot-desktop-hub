import { autoUpdater } from 'electron-updater'
import { BrowserWindow, ipcMain } from 'electron'

let mainWindow: BrowserWindow | null = null

export function initAutoUpdater(window: BrowserWindow): void {
  mainWindow = window

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = console

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('updater:update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes
    })
  })

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('updater:no-update')
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('updater:download-progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('updater:update-downloaded')
  })

  autoUpdater.on('error', (error) => {
    mainWindow?.webContents.send('updater:error', error.message)
  })
}

export function registerUpdaterHandlers(): void {
  ipcMain.handle('app:check-updates', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return {
        updateAvailable: !!result?.updateInfo,
        currentVersion: autoUpdater.currentVersion?.version,
        latestVersion: result?.updateInfo?.version
      }
    } catch {
      return {
        updateAvailable: false,
        currentVersion: autoUpdater.currentVersion?.version
      }
    }
  })

  ipcMain.handle('app:download-update', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('app:install-update', () => {
    autoUpdater.quitAndInstall(false, true)
  })
}

export function checkForUpdatesOnStartup(): void {
  // Delay initial check by 10 seconds to let the app settle
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 10_000)
}
