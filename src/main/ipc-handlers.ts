import { BrowserWindow } from 'electron'
import { registerProjectHandlers, registerProjectAgentHandlers } from './project-handlers'
import { registerSettingsHandlers } from './settings-handlers'
import { registerConversationHandlers, registerMessageHandlers } from './conversation-handlers'
import { registerChatHandlers } from './chat-handlers'
import { registerEmergencyStopHandlers } from './emergency-stop'
import { registerFileHandlers, registerContextHandlers } from './file-handlers'
import { registerSystemHandlers } from './system-handlers'
import { registerAgentHandlers } from './agents'
import { registerSkillHandlers } from './skills'
import { registerKnowledgeHandlers } from './knowledge'
import { registerToolHandlers } from './tools'
import { registerMcpHandlers, initDesktopNavigatorMcp } from './mcp'
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
import { registerRemoteEditHandlers } from './remote-edit-handlers'
import { registerRemoteEditGitHandlers } from './remote-edit/git-ops'
import { registerRemoteEditRecoveryHandlers } from './remote-edit/recovery'
import { registerCodeChangeHandlers } from './code-change-handlers'
import { registerProjectGeneratorHandlers } from './project-generator'
import { registerAgentGeneratorHandlers } from './agent-generator'
import { registerArtifactHandlers } from './artifacts'
import { registerArtifactGeneratorHandlers } from './artifact-generator'
import { registerSkillGeneratorHandlers } from './skill-generator'
import { registerScheduleGeneratorHandlers } from './scheduler-generator'
import { registerAutomatedWorkflowGeneratorHandlers } from './automated-workflow-generator'
import { registerAutomatedWorkflowRunHandlers } from './automated-workflow-runs'
import { registerAutomatedWorkflowExecutorHandlers } from './automated-workflow-executor'
import { registerVoiceHandlers } from './voice-handlers'
import { registerSchedulerHandlers } from './scheduler-handlers'
import { registerDebriefHandlers } from './debrief-handlers'
import { registerQuizHandlers } from './quiz-handlers'
import { registerTeachbackHandlers } from './teachback-handlers'
import { registerRatingHandlers } from './rating-handlers'
import { registerProjectAuditHandlers } from './project-audit'
import { registerActivityHandlers } from './activity-tracker'
import { markApplicationViewed } from './activity-badge'

export function registerIpcHandlers(mainWindow?: BrowserWindow): void {
  registerSettingsHandlers()
  registerProjectHandlers()
  registerProjectAgentHandlers()
  registerProjectAuditHandlers()
  registerWikiHandlers()
  registerPromptHandlers()
  registerConversationHandlers()
  registerChatHandlers()
  registerEmergencyStopHandlers()
  registerMessageHandlers()
  registerFileHandlers()
  registerContextHandlers()
  registerAgentHandlers()
  registerSkillHandlers()
  registerKnowledgeHandlers()
  registerToolHandlers()
  registerMcpHandlers()
  if (mainWindow) {
    initDesktopNavigatorMcp(mainWindow)
  }
  registerProviderHandlers()
  registerCliHandlers()
  registerWsHandlers()
  registerScreenCaptureHandlers()
  registerVoiceHandlers()
  registerModelCatalogHandlers()
  registerModelAvailabilityHandlers()
  registerErrorLogHandlers()
  registerErrorReportHandlers()
  registerRemoteEditHandlers(mainWindow)
  registerRemoteEditGitHandlers(mainWindow)
  registerRemoteEditRecoveryHandlers(mainWindow)
  registerCodeChangeHandlers(mainWindow)
  registerSystemHandlers()
  registerBuildHandlers(mainWindow)
  registerAndroidHandlers(mainWindow)
  registerProjectGeneratorHandlers(mainWindow)
  registerAgentGeneratorHandlers(mainWindow)
  registerSkillGeneratorHandlers(mainWindow)
  registerScheduleGeneratorHandlers(mainWindow)
  registerAutomatedWorkflowGeneratorHandlers(mainWindow)
  registerAutomatedWorkflowRunHandlers()
  registerAutomatedWorkflowExecutorHandlers()
  registerArtifactHandlers()
  registerArtifactGeneratorHandlers(mainWindow)
  registerSchedulerHandlers()
  registerDebriefHandlers()
  registerQuizHandlers()
  registerTeachbackHandlers()
  registerRatingHandlers()
  registerActivityHandlers()
  if (mainWindow) {
    mainWindow.on('blur', () => {
      cacheExternalWindowLabel(mainWindow.getTitle()).catch(() => {})
    })
    mainWindow.on('focus', () => {
      markApplicationViewed()
      if (consumeSuppressFocusEvent()) return
      mainWindow.webContents.send('clipboard:auto-focus')
    })
  }
}

// Re-exports for backward compatibility (tests and external code may import these)
export { clearDirListingCache } from './chat-handlers'
export { listDirectoryEntries, type DirectoryEntry } from './file-handlers'
