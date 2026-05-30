import { BrowserWindow } from 'electron'
import { registerProjectHandlers, registerProjectAgentHandlers } from './project-handlers'
import { registerSettingsHandlers } from './settings-handlers'
import { registerConversationHandlers, registerMessageHandlers } from './conversation-handlers'
import { registerChatHandlers } from './chat-handlers'
import { registerFileHandlers, registerContextHandlers } from './file-handlers'
import { registerSystemHandlers } from './system-handlers'
import { registerAgentHandlers } from './agents'
import { registerKnowledgeHandlers } from './knowledge'
import { registerToolHandlers } from './tools'
import { registerMcpHandlers } from './mcp'
import { registerProviderHandlers } from './providers'
import { registerScreenCaptureHandlers } from './screen-capture-handlers'
import { cacheExternalWindowLabel, consumeSuppressFocusEvent } from './screen-capture'

export function registerIpcHandlers(mainWindow?: BrowserWindow): void {
  registerSettingsHandlers()
  registerProjectHandlers()
  registerProjectAgentHandlers()
  registerConversationHandlers()
  registerChatHandlers()
  registerMessageHandlers()
  registerFileHandlers()
  registerContextHandlers()
  registerAgentHandlers()
  registerKnowledgeHandlers()
  registerToolHandlers()
  registerMcpHandlers()
  registerProviderHandlers()
  registerScreenCaptureHandlers()
  registerSystemHandlers()

  if (mainWindow) {
    mainWindow.on('blur', () => {
      cacheExternalWindowLabel(mainWindow.getTitle()).catch(() => {})
    })
    mainWindow.on('focus', () => {
      if (consumeSuppressFocusEvent()) return
      mainWindow.webContents.send('clipboard:auto-focus')
    })
  }
}

// Re-exports for backward compatibility (tests and external code may import these)
export { clearDirListingCache } from './chat-handlers'
export { listDirectoryEntries, type DirectoryEntry } from './file-handlers'
