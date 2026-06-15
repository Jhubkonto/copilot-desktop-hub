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
import { registerModelCatalogHandlers } from './model-catalog-handlers'
import { registerWikiHandlers } from './wiki-handlers'
import { registerPromptHandlers } from './prompt-handlers'
import { registerCliHandlers } from './cli-detection'
import { registerWsHandlers } from './ws-handlers'
import { registerBuildHandlers } from './build-handlers'
import { registerAndroidHandlers } from './android-handlers'
import { registerModelAvailabilityHandlers } from './model-availability'
import { cacheExternalWindowLabel, consumeSuppressFocusEvent } from './screen-capture'
import { registerErrorLogHandlers } from './error-log-handlers'
import { registerErrorReportHandlers } from './error-report-handlers'
import { registerSelfHealHandlers } from './self-heal-handlers'
import { registerSelfHealGitHandlers } from './self-heal/git-ops'
import { registerSelfHealRecoveryHandlers } from './self-heal/recovery'
import { registerProjectGeneratorHandlers } from './project-generator'

export function registerIpcHandlers(mainWindow?: BrowserWindow): void {
  registerSettingsHandlers()
  registerProjectHandlers()
  registerProjectAgentHandlers()
  registerWikiHandlers()
  registerPromptHandlers()
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
  registerCliHandlers()
  registerWsHandlers()
  registerScreenCaptureHandlers()
  registerModelCatalogHandlers()
  registerModelAvailabilityHandlers()
  registerErrorLogHandlers()
  registerErrorReportHandlers()
  registerSelfHealHandlers(mainWindow)
  registerSelfHealGitHandlers(mainWindow)
  registerSelfHealRecoveryHandlers(mainWindow)
  registerSystemHandlers()
  registerBuildHandlers(mainWindow)
  registerAndroidHandlers(mainWindow)
  registerProjectGeneratorHandlers(mainWindow)

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
