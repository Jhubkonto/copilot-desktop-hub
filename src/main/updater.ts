import pkg from 'electron-updater'
const { autoUpdater } = pkg
import { app, BrowserWindow } from 'electron'
import { safeHandle } from './safe-handle'
import { getFeedUrl, isFeedRunning } from './local-feed-server'
import { log } from './logger'

let mainWindow: BrowserWindow | null = null
let lastFeedUrl = ''

// The local feed server starts asynchronously during handler registration, so
// it may not be listening yet when initAutoUpdater runs. Re-sync before every
// check so the updater always points at the live server (its port changes per
// launch).
function syncFeedUrl(): void {
  if (!isFeedRunning()) return
  const url = getFeedUrl()
  if (!url || url === lastFeedUrl) return
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url } as never)
    lastFeedUrl = url
  } catch { /* ignore — may not work in dev mode */ }
}

export function initAutoUpdater(window: BrowserWindow): void {
  mainWindow = window

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = log

  syncFeedUrl()

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
  safeHandle('app:check-updates', async () => {
    try {
      syncFeedUrl()
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

  safeHandle('app:download-update', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return true
    } catch {
      return false
    }
  })

  safeHandle('app:install-update', () => {
    autoUpdater.quitAndInstall(false, true)
  })
}

export type MobileUpdateInstallResult =
  | { mode: 'installing'; version: string }
  | { mode: 'relaunching' }
  | { mode: 'no-update'; error: string }
  | { mode: 'error'; error: string }

// Completes a phone-initiated update: after the new installer has been
// published to the local feed, download it via electron-updater and silently
// reinstall + restart so no desktop interaction is needed. In dev checkouts
// there is nothing to install, so just relaunch the process.
export async function installPublishedUpdateAndRestart(): Promise<MobileUpdateInstallResult> {
  if (!app.isPackaged) {
    setTimeout(() => { app.relaunch(); app.exit(0) }, 1500)
    return { mode: 'relaunching' }
  }
  try {
    syncFeedUrl()
    const result = await autoUpdater.checkForUpdates()
    if (!result?.isUpdateAvailable) {
      const current = autoUpdater.currentVersion?.version ?? '?'
      return {
        mode: 'no-update',
        error: `Published build is not newer than the running app (v${current}). Bump the version in package.json and rebuild.`,
      }
    }
    await autoUpdater.downloadUpdate()
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1500)
    return { mode: 'installing', version: result.updateInfo.version }
  } catch (err) {
    return { mode: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

export function checkForUpdatesOnStartup(): void {
  if (!app.isPackaged) return
  setTimeout(() => {
    setImmediate(() => {
      syncFeedUrl()
      autoUpdater.checkForUpdates().catch(() => {})
    })
  }, 10_000)
}
