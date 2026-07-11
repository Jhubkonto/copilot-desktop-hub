import { contextBridge, ipcRenderer } from 'electron'
import type { ChatTurnEvent } from '../shared/chat-turn-types'
import type {
  AndroidBuildCommandName,
  AndroidSigningConfig,
  AndroidWorkspaceInfo,
  BuildCommandName,
  BuildRecord,
  BuildStatus,
  CatalogModel,
  ConversationCompressionSaveInput,
  ContextInspectorSnapshot,
  ErrorReportCaptureInput,
  RemoteEditInvestigationActivity,
  RemoteEditInvestigationChunk,
  RemoteEditInvestigationResult,
  RemoteEditInvestigationSettings,
  RemoteEditVerificationDone,
  RemoteEditVerificationEvent,
  RemoteEditGitEvent,
  RemoteEditRecoveryEvent,
  RemoteEditFixEvent,
  RemoteEditFixDone,
  ErrorLogEntry,
  IpcChannels,
  IpcReturn,
  PromptLibraryInput,
  PromptLibraryUpdate,
  AvailableModelGroup,
  PublishedEntry,
  ProjectGeneratorMessage,
  ProjectGeneratorSpec,
  AgentGeneratorMessage,
  AgentGeneratorSpec,
  SkillConfig,
  SkillGeneratorMessage,
  SkillGeneratorSpec,
  ScheduleGeneratorMessage,
  ScheduleGeneratorSpec,
  AutomatedWorkflowConfirmationMode,
  AutomatedWorkflowGeneratorMessage,
  AutomatedWorkflowSpec,
  AutomatedWorkflowStepStatus,
  ArtifactGeneratorMessage,
  ArtifactPromotionRequest,
  ArtifactSpec,
  McpServerWithStatus,
  BackgroundActivity,
} from '../shared/types'

// ---------------------------------------------------------------------------
// Typed IPC helpers — channels constrained to IpcChannels union
// ---------------------------------------------------------------------------

type IpcEventHandler = (_event: Electron.IpcRendererEvent, ...args: any[]) => void // eslint-disable-line @typescript-eslint/no-explicit-any

function typedInvoke<C extends IpcChannels>(channel: C, ...args: unknown[]): Promise<IpcReturn<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcReturn<C>>
}

function typedOn(channel: IpcChannels, handler: IpcEventHandler): void {
  ipcRenderer.on(channel, handler)
}

function typedOff(channel: IpcChannels, handler: IpcEventHandler): void {
  ipcRenderer.removeListener(channel, handler)
}

// ---------------------------------------------------------------------------
// Exposed API
// ---------------------------------------------------------------------------

const api = {
  // Platform
  platform: process.platform,

  // Settings
  getSettings: () => typedInvoke('app:get-settings'),
  getSetting: (key: string) => typedInvoke('app:get-setting', key),
  setSetting: (key: string, value: unknown) => typedInvoke('app:set-setting', key, value),
  getTheme: () => typedInvoke('app:get-theme'),
  setTheme: (theme: 'light' | 'dark') => typedInvoke('app:set-theme', theme),
  getVersion: () => typedInvoke('app:get-version'),
  getRuntimeInfo: () => typedInvoke('app:get-runtime-info'),
  setDebugEnabled: (enabled: boolean) => typedInvoke('debug:set-enabled', enabled),
  getVoiceStatus: () => typedInvoke('voice:get-status'),
  installLocalVoice: () => typedInvoke('voice:install-local'),
  transcribeVoice: (audio: Uint8Array) => typedInvoke('voice:transcribe', audio),
  onDebugLog: (callback: (entry: { prefix: string; message: string; timestamp: number }) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      entry: { prefix: string; message: string; timestamp: number }
    ) => callback(entry)
    typedOn('debug:log', handler)
    return () => typedOff('debug:log', handler)
  },
  getErrorLogPath: () => typedInvoke('errors:get-log-path'),
  getRecentErrors: (limit?: number) => typedInvoke('errors:get-recent', limit),
  getRendererConsoleErrors: () => typedInvoke('errors:get-renderer-console'),
  clearErrors: () => typedInvoke('errors:clear'),
  captureErrorReport: (input: ErrorReportCaptureInput) => typedInvoke('error-report:capture', input),
  deleteErrorReport: (id: string) => typedInvoke('error-report:delete', id),
  getErrorReport: (id: string) => typedInvoke('error-report:get', id),
  listErrorReports: (limit?: number, projectId?: string) => typedInvoke('error-report:list', limit, projectId),
  findActiveCodeChangeForConversation: (conversationId: string) => typedInvoke('error-report:find-active-for-conversation', conversationId),
  getInvestigationSettings: () => typedInvoke('remote-edit:get-investigation-settings'),
  setInvestigationSettings: (input: RemoteEditInvestigationSettings) => typedInvoke('remote-edit:set-investigation-settings', input),
  setRemoteEditReportStatus: (reportId: string, status: 'open' | 'investigating' | 'investigated' | 'completed' | 'rejected') =>
    typedInvoke('remote-edit:set-report-status', reportId, status),
  startInvestigation: (reportId: string, revisionNotes?: string) =>
    typedInvoke('remote-edit:start-investigation', reportId, revisionNotes),
  getActiveInvestigation: (reportId: string) => typedInvoke('remote-edit:get-active-investigation', reportId),
  getActiveCodeChanges: () => typedInvoke('remote-edit:get-active-code-changes'),
  onActiveCodeChangesChanged: (callback: (counts: Record<string, number>) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, counts: Record<string, number>) => callback(counts)
    typedOn('remote-edit:active-code-changes-changed', handler)
    return () => typedOff('remote-edit:active-code-changes-changed', handler)
  },
  onInvestigationActivity: (callback: (activity: RemoteEditInvestigationActivity) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, activity: RemoteEditInvestigationActivity) => callback(activity)
    typedOn('remote-edit:investigation-activity', handler)
    return () => typedOff('remote-edit:investigation-activity', handler)
  },
  onInvestigationChunk: (callback: (chunk: RemoteEditInvestigationChunk) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: RemoteEditInvestigationChunk) => callback(chunk)
    typedOn('remote-edit:investigation-chunk', handler)
    return () => typedOff('remote-edit:investigation-chunk', handler)
  },
  onInvestigationDone: (callback: (result: RemoteEditInvestigationResult) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: RemoteEditInvestigationResult) => callback(result)
    typedOn('remote-edit:investigation-done', handler)
    return () => typedOff('remote-edit:investigation-done', handler)
  },
  startFix: (reportId: string) => typedInvoke('remote-edit:start-fix', reportId),
  commitFixToWorkspace: (reportId: string) => typedInvoke('remote-edit:commit-to-workspace', reportId),
  revertStagedFile: (reportId: string, relativePath: string) =>
    typedInvoke('remote-edit:revert-staged-file', reportId, relativePath),
  markStagedFileReviewed: (reportId: string, relativePath: string) =>
    typedInvoke('remote-edit:mark-file-reviewed', reportId, relativePath),
  getStagedDiff: (reportId: string, relativePath: string) =>
    typedInvoke('remote-edit:get-staged-diff', reportId, relativePath),
  onFixEvent: (callback: (event: RemoteEditFixEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: RemoteEditFixEvent) => callback(data)
    typedOn('remote-edit:fix-event', handler)
    return () => typedOff('remote-edit:fix-event', handler)
  },
  onFixDone: (callback: (result: RemoteEditFixDone) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: RemoteEditFixDone) => callback(data)
    typedOn('remote-edit:fix-done', handler)
    return () => typedOff('remote-edit:fix-done', handler)
  },
  startVerification: (reportId: string) => typedInvoke('remote-edit:start-verification', reportId),
  getVerificationRuns: (reportId: string) => typedInvoke('remote-edit:get-verification-runs', reportId),
  onVerificationEvent: (callback: (event: RemoteEditVerificationEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: RemoteEditVerificationEvent) => callback(data)
    typedOn('remote-edit:verification-event', handler)
    return () => typedOff('remote-edit:verification-event', handler)
  },
  onVerificationDone: (callback: (result: RemoteEditVerificationDone) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: RemoteEditVerificationDone) => callback(data)
    typedOn('remote-edit:verification-done', handler)
    return () => typedOff('remote-edit:verification-done', handler)
  },
  getRemoteEditGitStatus: (reportId?: string) => typedInvoke('remote-edit:git-status', reportId),
  prepareRemoteEditCommit: (reportId: string) => typedInvoke('remote-edit:git-prepare-commit', reportId),
  commitRemoteEditFix: (reportId: string, message: string) => typedInvoke('remote-edit:git-commit', reportId, message),
  pushRemoteEditFix: (reportId: string) => typedInvoke('remote-edit:git-push', reportId),
  onRemoteEditGitEvent: (callback: (event: RemoteEditGitEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: RemoteEditGitEvent) => callback(data)
    typedOn('remote-edit:git-event', handler)
    return () => typedOff('remote-edit:git-event', handler)
  },
  prepareRemoteEditReload: (reportId: string) => typedInvoke('remote-edit:prepare-reload', reportId),
  getRemoteEditRecoveryRuns: (reportId: string) => typedInvoke('remote-edit:get-recovery-runs', reportId),
  rollbackRemoteEdit: (recoveryId: string) => typedInvoke('remote-edit:rollback', recoveryId),
  getRemoteEditHistory: () => typedInvoke('remote-edit:get-history'),
  getRemoteEditHistoryForReport: (reportId: string) => typedInvoke('remote-edit:get-history-for-report', reportId),
  onRemoteEditRecoveryEvent: (callback: (event: RemoteEditRecoveryEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: RemoteEditRecoveryEvent) => callback(data)
    typedOn('remote-edit:recovery-event', handler)
    return () => typedOff('remote-edit:recovery-event', handler)
  },
  onErrorLogEntry: (callback: (entry: ErrorLogEntry) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: ErrorLogEntry) => callback(entry)
    typedOn('errors:new', handler)
    return () => typedOff('errors:new', handler)
  },

  // Auth
  authStatus: () => typedInvoke('auth:status'),
  authLoginByok: () => typedInvoke('auth:login-byok'),
  authLogout: () => typedInvoke('auth:logout'),

  // Chat
  sendMessage: (
    conversationId: string,
    content: string,
    options?: {
      attachments?: { id: string; name: string; path: string; size: number }[]
      images?: { id: string; name: string; dataUrl: string }[]
      regenerate?: boolean
      agentId?: string
      model?: string
      cliBackend?: 'claude-cli' | 'codex-cli'
      messageId?: string
      projectId?: string
      contextSnapshot?: string
      displayContent?: string
    }
  ) => typedInvoke('chat:send-message', conversationId, content, options),
  onStreamResponse: (callback: (chunk: string | null) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: string | null) =>
      callback(chunk)
    typedOn('chat:stream-response', handler)
    return () => typedOff('chat:stream-response', handler)
  },
  onRemoteMessage: (callback: (data: { conversationId: string; content: string; images?: { id: string; name: string; dataUrl: string }[] }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { conversationId: string; content: string; images?: { id: string; name: string; dataUrl: string }[] }) =>
      callback(data)
    typedOn('chat:remote-message', handler)
    return () => typedOff('chat:remote-message', handler)
  },
  onRequestInspectorSnapshot: (callback: (data: { requestId: string; conversationId: string | null }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; conversationId: string | null }) =>
      callback(data)
    typedOn('context:request-inspector-snapshot', handler)
    return () => typedOff('context:request-inspector-snapshot', handler)
  },
  replyInspectorSnapshot: (requestId: string, snapshot: ContextInspectorSnapshot | null) => {
    ipcRenderer.send('context:inspector-snapshot-reply', requestId, snapshot)
  },
  onStreamError: (callback: (error: { type: string; message: string; retryable: boolean; retryAfterSeconds?: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: { type: string; message: string; retryable: boolean; retryAfterSeconds?: number }) =>
      callback(error)
    typedOn('chat:stream-error', handler)
    return () => typedOff('chat:stream-error', handler)
  },
  onToolCallEvent: (callback: (data: { toolName: string; serverName: string; args: Record<string, unknown>; result: string; success: boolean; conversationId: string | null }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { toolName: string; serverName: string; args: Record<string, unknown>; result: string; success: boolean; conversationId: string | null }) =>
      callback(data)
    typedOn('chat:tool-call-event', handler)
    return () => typedOff('chat:tool-call-event', handler)
  },
  onCliToolStart: (callback: (data: { id: string; name: string; input: Record<string, unknown> }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { id: string; name: string; input: Record<string, unknown> }) => callback(data)
    typedOn('chat:cli-tool-start', handler)
    return () => typedOff('chat:cli-tool-start', handler)
  },
  onCliToolEnd: (callback: (data: { id: string; content: string; isError: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { id: string; content: string; isError: boolean }) => callback(data)
    typedOn('chat:cli-tool-end', handler)
    return () => typedOff('chat:cli-tool-end', handler)
  },
  onCliCost: (callback: (data: { totalCostUsd: number; inputTokens: number; outputTokens: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { totalCostUsd: number; inputTokens: number; outputTokens: number }) => callback(data)
    typedOn('chat:cli-cost', handler)
    return () => typedOff('chat:cli-cost', handler)
  },
  onActivity: (callback: (event: { type: 'thinking' } | { type: 'tool'; name: string; server: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { type: 'thinking' } | { type: 'tool'; name: string; server: string }) =>
      callback(data)
    typedOn('chat:activity', handler)
    return () => typedOff('chat:activity', handler)
  },
  onActivityGlobal: (callback: (data: { conversationId: string; state: string; label: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { conversationId: string; state: string; label: string }) =>
      callback(data)
    typedOn('chat:activity-global', handler)
    return () => typedOff('chat:activity-global', handler)
  },
  onChatTurnEvent: (callback: (event: ChatTurnEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: ChatTurnEvent) => callback(data)
    typedOn('chat:turn-event', handler)
    return () => typedOff('chat:turn-event', handler)
  },
  onAndroidLog: (callback: (data: { tag: string; message: string; ts: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { tag: string; message: string; ts: number }) =>
      callback(data)
    typedOn('android:log', handler)
    return () => typedOff('android:log', handler)
  },
  onStreamModel: (callback: (model: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, model: string) => callback(model)
    typedOn('chat:stream-model', handler)
    return () => typedOff('chat:stream-model', handler)
  },
  onThinkingDelta: (callback: (data: { blockId: string; chunk: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { blockId: string; chunk: string }) => callback(data)
    typedOn('chat:thinking-delta', handler)
    return () => typedOff('chat:thinking-delta', handler)
  },
  onThinkingEnd: (callback: (data: { blockId: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { blockId: string }) => callback(data)
    typedOn('chat:thinking-end', handler)
    return () => typedOff('chat:thinking-end', handler)
  },
  stopGeneration: (conversationId?: string) => typedInvoke('chat:stop-generation', conversationId),

  // Conversations
  listConversations: () => typedInvoke('conversation:list'),
  createConversation: (agentId?: string, projectId?: string) =>
    typedInvoke('conversation:create', agentId, projectId),
  getConversationCompressionPreview: (id: string) => typedInvoke('conversation:compression-preview', id),
  prepareConversationCompressionSummary: (id: string) =>
    typedInvoke('conversation:prepare-compression-summary', id),
  saveConversationCompressionSummary: (input: ConversationCompressionSaveInput) =>
    typedInvoke('conversation:save-compression-summary', input),
  deleteConversation: (id: string) => typedInvoke('conversation:delete', id),
  exportConversationJson: (id: string) => typedInvoke('conversation:export-json', id),
  exportConversationPack: (id: string, options: { format: 'json' | 'markdown' | 'context-bundle' }) =>
    typedInvoke('conversation:export-pack', id, options),
  forkConversation: (id: string, options?: { model?: string | null; agentId?: string | null }) =>
    typedInvoke('conversation:fork', id, options ?? {}),
  importConversationJson: (targetConversationId?: string | null) =>
    typedInvoke('conversation:import-json', { targetConversationId: targetConversationId ?? null }),
  getMessages: (conversationId: string) =>
    typedInvoke('conversation:get-messages', conversationId),
  getActiveChatTurn: (conversationId: string) =>
    typedInvoke('chat:get-active-turn', conversationId),
  insertConversationMessage: (conversationId: string, role: string, content: string) =>
    typedInvoke('conversation:insert-message', conversationId, role, content),
  searchConversations: (query: string) =>
    typedInvoke('conversation:search', query),
  renameConversation: (id: string, title: string) =>
    typedInvoke('conversation:rename', id, title),
  setConversationModel: (id: string, model: string | null, cliBackend?: string | null) =>
    typedInvoke('conversation:set-model', id, model, cliBackend),
  setConversationMode: (id: string, mode: { thinkingEffortOverride?: 'low' | 'medium' | 'high' | 'max' | 'disabled' | null; fullAutoApproveOverride?: boolean | null }) =>
    typedInvoke('conversation:set-mode', id, mode),
  setConversationPinned: (id: string, pinned: boolean) =>
    typedInvoke('conversation:set-pinned', id, pinned),
  updateConversationContext: (
    conversationId: string,
    updates: { projectId?: string | null; agentId?: string | null }
  ) => typedInvoke('conversation:update-context', { conversationId, ...updates }),

  // Messages
  deleteMessage: (id: string) => typedInvoke('message:delete', id),
  deleteMessagesAfter: (conversationId: string, timestamp: number) =>
    typedInvoke('message:delete-after', conversationId, timestamp),

  // Files
  openFileDialog: () => typedInvoke('file:open-dialog'),
  getWorkingDirectory: () => typedInvoke('file:get-cwd'),
  setWorkingDirectory: (cwd: string) => typedInvoke('file:set-cwd', cwd),
  readContextFile: (filePath: string) => typedInvoke('context:read-file', filePath),
  getWorkspaceSummary: (rootDir?: string) => typedInvoke('context:workspace-summary', rootDir),
  getGitContext: () => typedInvoke('context:git'),
  getGitDiff: () => typedInvoke('context:git-diff'),

  // Mobile companion WebSocket server
  wsStart: () => typedInvoke('ws:start'),
  wsStop: () => typedInvoke('ws:stop'),
  wsStatus: () => typedInvoke('ws:status'),
  wsRegenerateToken: () => typedInvoke('ws:regenerate-token'),
  wsGetWakelockEnabled: () => typedInvoke('ws:wakelock-enabled'),
  wsSetWakelockEnabled: (enabled: boolean) => typedInvoke('ws:set-wakelock-enabled', enabled),
  wsGetAutoStartEnabled: () => typedInvoke('ws:auto-start-enabled'),
  wsSetAutoStartEnabled: (enabled: boolean) => typedInvoke('ws:set-auto-start-enabled', enabled),
  onMobileClientCount: (callback: (count: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, count: number) => callback(count)
    typedOn('ws:client-count', handler)
    return () => typedOff('ws:client-count', handler)
  },

  // CLI
  checkCli: () => typedInvoke('cli:check'),
  getCliStatus: () => typedInvoke('cli:status'),
  detectAllClis: () => typedInvoke('cli:detect-all'),
  getCliModels: (backend: string) => typedInvoke('cli:get-models', backend),

  // Agents
  listAgents: () => typedInvoke('agent:list'),
  getAgent: (id: string) => typedInvoke('agent:get', id),
  createAgent: (config: unknown) => typedInvoke('agent:create', config),
  updateAgent: (id: string, config: unknown) =>
    typedInvoke('agent:update', id, config),
  deleteAgentPreflight: (id: string) => typedInvoke('agent:delete-preflight', id),
  deleteAgent: (id: string) => typedInvoke('agent:delete', id),
  duplicateAgent: (id: string) => typedInvoke('agent:duplicate', id),
  exportAgent: (id: string) => typedInvoke('agent:export', id),
  importAgent: () => typedInvoke('agent:import'),

  // Skills
  listSkills: () => typedInvoke('skill:list'),
  getSkill: (id: string) => typedInvoke('skill:get', id),
  createSkill: (config: Partial<SkillConfig>) => typedInvoke('skill:create', config),
  updateSkill: (id: string, config: Partial<SkillConfig>) => typedInvoke('skill:update', id, config),
  deleteSkill: (id: string) => typedInvoke('skill:delete', id),
  duplicateSkill: (id: string) => typedInvoke('skill:duplicate', id),
  exportSkill: (id: string) => typedInvoke('skill:export', id),
  importSkill: () => typedInvoke('skill:import'),
  getSkillAgentLinks: (agentId: string) => typedInvoke('skill:get-agent-links', agentId),
  attachSkillToAgent: (agentId: string, skillId: string, attach: boolean) =>
    typedInvoke('skill:attach-to-agent', agentId, skillId, attach),
  reorderSkillsForAgent: (agentId: string, skillIds: string[]) =>
    typedInvoke('skill:reorder-for-agent', agentId, skillIds),
  getSkillAgentUsage: () => typedInvoke('skill:get-agent-usage'),

  // Projects (additional)
  duplicateProject: (id: string) => typedInvoke('project:duplicate', id),
  exportProject: (id: string) => typedInvoke('project:export', id),

  // Project Wiki
  listWikiEntries: (projectId: string) => typedInvoke('wiki:list-entries', projectId),
  createWikiEntry: (
    projectId: string,
    title: string,
    body: string,
    tags: string[],
    sourceInfo?: { conversationId?: string; messageId?: string },
  ) => typedInvoke('wiki:create-entry', projectId, title, body, tags, sourceInfo),
  updateWikiEntry: (id: string, fields: { title?: string; body?: string; tags?: string[]; superseded_by?: string | null }) =>
    typedInvoke('wiki:update-entry', id, fields),
  deleteWikiEntry: (id: string) => typedInvoke('wiki:delete-entry', id),
  extractWikiLearnings: (conversationId: string, projectId: string, model?: string) =>
    typedInvoke('wiki:extract-learnings', conversationId, projectId, model),

  // Prompt Library
  listPrompts: (projectId?: string | null) => typedInvoke('prompt:list', projectId ?? null),
  listPromptVersions: (promptId: string) => typedInvoke('prompt:list-versions', promptId),
  createPrompt: (input: PromptLibraryInput) => typedInvoke('prompt:create', input),
  updatePrompt: (id: string, fields: PromptLibraryUpdate) => typedInvoke('prompt:update', id, fields),
  rollbackPrompt: (promptId: string, version: number) => typedInvoke('prompt:rollback', promptId, version),
  deletePrompt: (id: string) => typedInvoke('prompt:delete', id),

  // Knowledge files
  listKnowledgeFiles: (agentId: string) =>
    typedInvoke('agent:list-knowledge-files', agentId),
  addKnowledgeFile: (agentId: string, filePath: string, injectMode: string) =>
    typedInvoke('agent:add-knowledge-file', agentId, filePath, injectMode),
  removeKnowledgeFile: (id: string) => typedInvoke('agent:remove-knowledge-file', id),
  updateKnowledgeInjectMode: (id: string, mode: string) =>
    typedInvoke('agent:update-knowledge-inject-mode', id, mode),
  readKnowledgeFile: (agentId: string, filePath: string) =>
    typedInvoke('fs:read-file', agentId, filePath),
  writeKnowledgeFile: (agentId: string, filePath: string, content: string) =>
    typedInvoke('fs:write-file', agentId, filePath, content),

  // Directories
  openDirectoryDialog: () => typedInvoke('file:open-directory-dialog'),
  getRecentDirs: () => typedInvoke('file:get-recent-dirs'),
  addRecentDir: (path: string) => typedInvoke('file:add-recent-dir', path),
  listDirectory: (path: string, depth?: number) =>
    typedInvoke('fs:list-directory', path, depth),

  // Models
  listModelCatalog: () => typedInvoke('model:list-catalog'),
  listAvailableModels: (): Promise<AvailableModelGroup[]> => typedInvoke('model:list-available'),
  onCatalogUpdated: (
    callback: (data: { models: CatalogModel[]; changeSummary?: string }) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { models: CatalogModel[]; changeSummary?: string }
    ) => callback(data)
    typedOn('model:catalog-updated', handler)
    return () => typedOff('model:catalog-updated', handler)
  },

  // Tools
  respondToToolApproval: (requestId: string, approved: boolean, remember: boolean) =>
    typedInvoke('tool:approval-response', requestId, approved, remember),
  onToolApprovalRequest: (
    callback: (data: {
      requestId: string
      tool: string
      args: Record<string, unknown>
      description: string
    }) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        requestId: string
        tool: string
        args: Record<string, unknown>
        description: string
      }
    ) => callback(data)
    typedOn('tool:request-approval', handler)
    return () => typedOff('tool:request-approval', handler)
  },

  onToolApprovalResolved: (callback: (requestId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, requestId: string) => callback(requestId)
    typedOn('tool:approval-resolved', handler)
    return () => typedOff('tool:approval-resolved', handler)
  },

  onToolAutoApproved: (callback: (data: { toolName: string; args: Record<string, unknown> }) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { toolName: string; args: Record<string, unknown> }
    ) => callback(data)
    typedOn('tool:auto-approved', handler)
    return () => typedOff('tool:auto-approved', handler)
  },

  // MCP Servers
  listMcpServers: () => typedInvoke('mcp:list-servers'),
  addMcpServer: (config: Record<string, unknown>) =>
    typedInvoke('mcp:add-server', config),
  updateMcpServer: (id: string, updates: Record<string, unknown>) =>
    typedInvoke('mcp:update-server', id, updates),
  removeMcpServer: (id: string) => typedInvoke('mcp:remove-server', id),
  getMcpServerStatus: (id: string) => typedInvoke('mcp:get-server-status', id),
  listMcpTools: (serverIds?: string[]) => typedInvoke('mcp:list-tools', serverIds),
  listMcpToolsForAgent: (agentId: string) => typedInvoke('mcp:list-tools-for-agent', agentId),
  getMcpToolOverrides: (agentId: string) => typedInvoke('agent:get-mcp-tool-overrides', agentId),
  setMcpToolOverride: (
    agentId: string,
    serverId: string,
    toolName: string,
    config: { enabled: boolean; approval: string; instructions: string }
  ) => typedInvoke('agent:set-mcp-tool-override', agentId, serverId, toolName, config),
  getMcpServerTrust: (agentId: string) => typedInvoke('agent:get-mcp-server-trust', agentId),
  setMcpServerTrust: (agentId: string, serverId: string, trust: string) =>
    typedInvoke('agent:set-mcp-server-trust', agentId, serverId, trust),
  callMcpTool: (serverId: string, toolName: string, args: Record<string, unknown>, agentId?: string) =>
    typedInvoke('mcp:call-tool', serverId, toolName, args, agentId),
  restartMcpServer: (id: string) => typedInvoke('mcp:restart-server', id),
  onMcpServerStatusChanged: (callback: (server: McpServerWithStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, server: McpServerWithStatus) => callback(server)
    typedOn('mcp:server-status-changed', handler)
    return () => typedOff('mcp:server-status-changed', handler)
  },

  // Providers (BYOK)
  listProviders: () => typedInvoke('provider:list'),
  setProviderKey: (provider: string, key: string) =>
    typedInvoke('provider:set-key', provider, key),
  removeProviderKey: (provider: string) => typedInvoke('provider:remove-key', provider),
  hasProviderKey: (provider: string) => typedInvoke('provider:has-key', provider),
  testProviderKey: (provider: string, key: string, endpoint?: string) =>
    typedInvoke('provider:test-key', provider, key, endpoint),
  getAzureEndpoint: () => typedInvoke('provider:get-azure-endpoint'),
  setAzureEndpoint: (endpoint: string) =>
    typedInvoke('provider:set-azure-endpoint', endpoint),
  confirmProviderKeyHandoff: (provider: string) =>
    typedInvoke('provider:key-handoff-confirm', provider),
  onProviderKeyHandoffRequest: (callback: (provider: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { provider: string }) => callback(data.provider)
    typedOn('provider:key-handoff-request', handler)
    return () => typedOff('provider:key-handoff-request', handler)
  },
  onProviderKeyHandoffSent: (callback: (provider: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { provider: string }) => callback(data.provider)
    typedOn('provider:key-handoff-sent', handler)
    return () => typedOff('provider:key-handoff-sent', handler)
  },

  // Projects
  listProjects: () => typedInvoke('project:list'),
  createProject: (name: string, color: string) => typedInvoke('project:create', name, color),
  renameProject: (id: string, name: string) => typedInvoke('project:rename', id, name),
  deleteProject: (id: string) => typedInvoke('project:delete', id),
  setConversationProject: (conversationId: string, projectId: string | null) =>
    typedInvoke('project:set-conversation', conversationId, projectId),
  setProjectDefaultModel: (id: string, model: string | null) =>
    typedInvoke('project:set-default-model', id, model),

  // Project Agents
  listProjectAgents: (projectId: string) => typedInvoke('project:list-agents', projectId),
  addAgentToProject: (projectId: string, agentId: string) =>
    typedInvoke('project:add-agent', projectId, agentId),
  removeAgentFromProject: (projectId: string, agentId: string) =>
    typedInvoke('project:remove-agent', projectId, agentId),
  setProjectPrimaryAgent: (projectId: string, agentId: string) =>
    typedInvoke('project:set-primary-agent', projectId, agentId),
  reorderProjectAgents: (projectId: string, orderedAgentIds: string[]) =>
    typedInvoke('project:reorder-agents', projectId, orderedAgentIds),
  updateProjectConfig: (projectId: string, config: Record<string, unknown>) =>
    typedInvoke('project:update-config', projectId, config),
  getProjectConfig: (projectId: string) =>
    typedInvoke('project:get-config', projectId),
  inspectProjectWorkspace: (rootDirectory: string) =>
    typedInvoke('project:inspect-workspace', rootDirectory),
  listProjectAuditSessions: (projectId?: string | null) =>
    typedInvoke('project-audit:list-sessions', projectId),
  listProjectAuditFiles: (sessionId: string) =>
    typedInvoke('project-audit:list-files', sessionId),
  getProjectAuditDiff: (sessionId: string, relativePath: string) =>
    typedInvoke('project-audit:get-diff', sessionId, relativePath),
  automatedWorkflowGeneratorChat: (projectId: string | null, messages: AutomatedWorkflowGeneratorMessage[], modelOverride?: string) =>
    typedInvoke('automated-workflow-generator:chat', projectId, messages, modelOverride),
  onAutomatedWorkflowGeneratorToken: (callback: (chunk: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: string) => callback(chunk)
    typedOn('automated-workflow-generator:token', handler)
    return () => typedOff('automated-workflow-generator:token', handler)
  },
  onAutomatedWorkflowGeneratorSpecReady: (callback: (spec: AutomatedWorkflowSpec) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, spec: AutomatedWorkflowSpec) => callback(spec)
    typedOn('automated-workflow-generator:spec-ready', handler)
    return () => typedOff('automated-workflow-generator:spec-ready', handler)
  },
  onAutomatedWorkflowGeneratorDone: (callback: (data: { hasSpec: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { hasSpec: boolean }) => callback(data)
    typedOn('automated-workflow-generator:done', handler)
    return () => typedOff('automated-workflow-generator:done', handler)
  },
  onAutomatedWorkflowGeneratorError: (callback: (data: { message: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { message: string }) => callback(data)
    typedOn('automated-workflow-generator:error', handler)
    return () => typedOff('automated-workflow-generator:error', handler)
  },
  getAutomatedWorkflowGeneratorModel: () => typedInvoke('automated-workflow-generator:get-model'),
  setAutomatedWorkflowGeneratorModel: (modelId: string) => typedInvoke('automated-workflow-generator:set-model', modelId),
  saveAutomatedWorkflowRunFromSpec: (projectId: string | null, spec: AutomatedWorkflowSpec, model: string | null, existingRunId?: string | null) =>
    typedInvoke('automated-workflow-runs:save-spec', projectId, spec, model, existingRunId),
  listAutomatedWorkflowRuns: (projectId: string | null) =>
    typedInvoke('automated-workflow-runs:list', projectId),
  listAllAutomatedWorkflowRuns: () =>
    typedInvoke('automated-workflow-runs:list-all'),
  getAutomatedWorkflowRun: (runId: string) =>
    typedInvoke('automated-workflow-runs:get', runId),
  updateAutomatedWorkflowRunStepStatus: (runId: string, stepId: string, status: AutomatedWorkflowStepStatus) =>
    typedInvoke('automated-workflow-runs:update-step-status', runId, stepId, status),
  discardAutomatedWorkflowRun: (runId: string) =>
    typedInvoke('automated-workflow-runs:discard', runId),
  onAutomatedWorkflowRunsChanged: (callback: (data: { projectId: string; runId: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { projectId: string; runId: string }) => callback(data)
    typedOn('automated-workflow-runs:changed', handler)
    return () => typedOff('automated-workflow-runs:changed', handler)
  },
  startAutomatedWorkflowRun: (runId: string) =>
    typedInvoke('automated-workflow-runs:start', runId),
  confirmAutomatedWorkflowStep: (runId: string, stepDbId: string, editedOutput?: string) =>
    typedInvoke('automated-workflow-runs:confirm-step', runId, stepDbId, editedOutput),
  retryAutomatedWorkflowStep: (runId: string, stepDbId: string) =>
    typedInvoke('automated-workflow-runs:retry-step', runId, stepDbId),
  skipAutomatedWorkflowStep: (runId: string, stepDbId: string) =>
    typedInvoke('automated-workflow-runs:skip-step', runId, stepDbId),
  abortAutomatedWorkflowRun: (runId: string) =>
    typedInvoke('automated-workflow-runs:abort', runId),
  setAutomatedWorkflowConfirmationMode: (runId: string, mode: AutomatedWorkflowConfirmationMode) =>
    typedInvoke('automated-workflow-runs:set-confirmation-mode', runId, mode),
  onAutomatedWorkflowStepStream: (callback: (data: { runId: string; stepDbId: string; chunk: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { runId: string; stepDbId: string; chunk: string }) => callback(data)
    typedOn('automated-workflow-runs:step-stream', handler)
    return () => typedOff('automated-workflow-runs:step-stream', handler)
  },
  onTeamActivity: (callback: (step: {
    stepId: string
    agentId: string
    agentName: string
    agentIcon: string
    task: string
    status: 'delegating' | 'done' | 'error'
    result?: string
    durationMs?: number
  }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, step: Parameters<typeof callback>[0]) =>
      callback(step)
    typedOn('chat:team-activity', handler)
    return () => typedOff('chat:team-activity', handler)
  },
  onTeamStepStream: (callback: (event: { stepId: string; chunk: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    typedOn('chat:team-step-stream', handler)
    return () => typedOff('chat:team-step-stream', handler)
  },
  onWikiInjected: (callback: (data: { count: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { count: number }) => callback(data)
    typedOn('chat:wiki-injected', handler)
    return () => typedOff('chat:wiki-injected', handler)
  },

  // Window controls
  minimizeWindow: () => typedInvoke('window:minimize'),
  maximizeWindow: () => typedInvoke('window:maximize'),
  closeWindow: () => typedInvoke('window:close'),
  isWindowMaximized: () => typedInvoke('window:is-maximized'),
  editAction: (action: string) => typedInvoke('window:edit-action', action),
  zoomIn: () => typedInvoke('window:zoom', 0.5),
  zoomOut: () => typedInvoke('window:zoom', -0.5),
  resetZoom: () => typedInvoke('window:zoom', 0),
  onMaximizeChange: (callback: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
    typedOn('window:maximize-change', handler)
    return () => typedOff('window:maximize-change', handler)
  },
  captureScreen: () => typedInvoke('screen:capture'),
  captureWindowScreenshot: () => typedInvoke('screen:capture-window'),
  checkScreenPermission: () => typedInvoke('screen:check-permission'),
  ocrImage: (dataUrl: string) => typedInvoke('screen:ocr-image', dataUrl),
  readClipboardContent: (): Promise<IpcReturn<'clipboard:read-content'>> =>
    ipcRenderer.invoke('clipboard:read-content'),
  readClipboardImage: () => typedInvoke('clipboard:read-image'),
  onAutoClipboardFocus: (callback: () => void) => {
    const handler = () => callback()
    typedOn('clipboard:auto-focus', handler)
    return () => typedOff('clipboard:auto-focus', handler)
  },

  // Auto-start
  setAutoStart: (enabled: boolean) => typedInvoke('app:set-auto-start', enabled),
  saveTextFile: (defaultFileName: string, content: string) =>
    typedInvoke('app:save-text-file', defaultFileName, content),

  // Updates
  checkForUpdates: () => typedInvoke('app:check-updates'),
  downloadUpdate: () => typedInvoke('app:download-update'),
  installUpdate: () => typedInvoke('app:install-update'),
  onUpdateAvailable: (callback: (info: { version: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: { version: string }) =>
      callback(info)
    typedOn('updater:update-available', handler)
    return () => typedOff('updater:update-available', handler)
  },
  onUpdateDownloaded: (callback: () => void) => {
    typedOn('updater:update-downloaded', callback)
    return () => typedOff('updater:update-downloaded', callback)
  },

  // System events
  onNewChat: (callback: () => void) => {
    typedOn('chat:new', callback)
    return () => typedOff('chat:new', callback)
  },

  // Build orchestrator
  buildGetWorkspaceInfo: () => typedInvoke('build:get-workspace-info'),
  buildSetWorkspacePath: (path: string) => typedInvoke('build:set-workspace-path', path),
  buildStartCommand: (cmd: BuildCommandName) => typedInvoke('build:start-command', cmd),
  buildCancelCommand: (buildId: string) => typedInvoke('build:cancel-command', buildId),
  buildGetRecords: (limit?: number) => typedInvoke('build:get-records', limit),
  buildRunPreflight: () => typedInvoke('build:run-preflight'),
  buildLaunchDev: () => typedInvoke('build:launch-dev'),
  onBuildLogChunk: (callback: (data: { buildId: string; line: string; stream: 'stdout' | 'stderr'; replace?: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { buildId: string; line: string; stream: 'stdout' | 'stderr'; replace?: boolean }) => callback(data)
    typedOn('build:log-chunk', handler)
    return () => typedOff('build:log-chunk', handler)
  },
  onBuildCommandDone: (callback: (data: { buildId: string; status: BuildStatus; exitCode: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { buildId: string; status: BuildStatus; exitCode: number }) => callback(data)
    typedOn('build:command-done', handler)
    return () => typedOff('build:command-done', handler)
  },

  // Local update feed
  buildGetFeedInfo: () => typedInvoke('build:get-feed-info'),
  buildSetFeedPath: (feedPath: string) => typedInvoke('build:set-feed-path', feedPath),
  buildPublishUpdate: () => typedInvoke('build:publish-update'),
  buildListPublished: () => typedInvoke('build:list-published') as Promise<PublishedEntry[]>,
  buildRollbackUpdate: (version: string) => typedInvoke('build:rollback-update', version),

  // Android build and distribution
  androidGetWorkspaceInfo: () => typedInvoke('android:get-workspace-info') as Promise<AndroidWorkspaceInfo>,
  androidSetWorkspacePath: (workspacePath: string) => typedInvoke('android:set-workspace-path', workspacePath) as Promise<AndroidWorkspaceInfo>,
  androidStartCommand: (cmd: AndroidBuildCommandName) => typedInvoke('android:start-command', cmd),
  androidCancelCommand: (buildId: string) => typedInvoke('android:cancel-command', buildId),
  androidGetRecords: (limit?: number) => typedInvoke('android:get-records', limit) as Promise<BuildRecord[]>,
  androidGetSigningConfig: () => typedInvoke('android:get-signing-config') as Promise<AndroidSigningConfig | null>,
  androidSetSigningConfig: (config: AndroidSigningConfig) => typedInvoke('android:set-signing-config', config),
  androidValidateSigningConfig: () => typedInvoke('android:validate-signing-config'),
  androidListAdbDevices: () => typedInvoke('android:list-adb-devices'),
  androidInstallApk: (serial: string, apkPath: string) => typedInvoke('android:install-apk', serial, apkPath),
  androidPublishUpdate: () => typedInvoke('android:publish-update'),
  androidGetUpdateManifest: () => typedInvoke('android:get-update-manifest'),
  androidGetPublishHistory: () => typedInvoke('android:get-publish-history') as Promise<import('../shared/types').AndroidUpdateManifest[]>,
  androidRestoreVersion: (versionCode: number) => typedInvoke('android:restore-version', versionCode),
  androidSaveFcmServiceAccount: (json: string) => typedInvoke('android:save-fcm-service-account', json),
  androidGetFcmConfigStatus: () => typedInvoke('android:get-fcm-config-status'),
  onAndroidLogChunk: (callback: (data: { buildId: string; line: string; stream: 'stdout' | 'stderr'; replace?: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { buildId: string; line: string; stream: 'stdout' | 'stderr'; replace?: boolean }) => callback(data)
    typedOn('android:log-chunk', handler)
    return () => typedOff('android:log-chunk', handler)
  },
  onAndroidCommandDone: (callback: (data: { buildId: string; status: BuildStatus; exitCode: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { buildId: string; status: BuildStatus; exitCode: number }) => callback(data)
    typedOn('android:command-done', handler)
    return () => typedOff('android:command-done', handler)
  },

  // Project generator
  projectGeneratorChat: (messages: ProjectGeneratorMessage[], existingAgents: { id: string; name: string; icon: string; systemPrompt: string }[], modelOverride?: string, images?: { dataUrl: string }[]) =>
    typedInvoke('project-generator:chat', messages, existingAgents, modelOverride, images),
  onProjectGeneratorToken: (callback: (chunk: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: string) => callback(chunk)
    typedOn('project-generator:token', handler)
    return () => typedOff('project-generator:token', handler)
  },
  onProjectGeneratorSpecReady: (callback: (spec: ProjectGeneratorSpec) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, spec: ProjectGeneratorSpec) => callback(spec)
    typedOn('project-generator:spec-ready', handler)
    return () => typedOff('project-generator:spec-ready', handler)
  },
  onProjectGeneratorDone: (callback: (data: { hasSpec: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { hasSpec: boolean }) => callback(data)
    typedOn('project-generator:done', handler)
    return () => typedOff('project-generator:done', handler)
  },
  onProjectGeneratorError: (callback: (data: { message: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { message: string }) => callback(data)
    typedOn('project-generator:error', handler)
    return () => typedOff('project-generator:error', handler)
  },
  projectGeneratorGetModel: () => typedInvoke('project-generator:get-model'),
  projectGeneratorSetModel: (modelId: string) => typedInvoke('project-generator:set-model', modelId),

  // Agent generator
  agentGeneratorChat: (messages: AgentGeneratorMessage[], modelOverride?: string) =>
    typedInvoke('agent-generator:chat', messages, modelOverride),
  onAgentGeneratorToken: (callback: (chunk: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: string) => callback(chunk)
    typedOn('agent-generator:token', handler)
    return () => typedOff('agent-generator:token', handler)
  },
  onAgentGeneratorSpecReady: (callback: (spec: AgentGeneratorSpec) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, spec: AgentGeneratorSpec) => callback(spec)
    typedOn('agent-generator:spec-ready', handler)
    return () => typedOff('agent-generator:spec-ready', handler)
  },
  onAgentGeneratorDone: (callback: (data: { hasSpec: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { hasSpec: boolean }) => callback(data)
    typedOn('agent-generator:done', handler)
    return () => typedOff('agent-generator:done', handler)
  },
  onAgentGeneratorError: (callback: (data: { message: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { message: string }) => callback(data)
    typedOn('agent-generator:error', handler)
    return () => typedOff('agent-generator:error', handler)
  },
  agentGeneratorGetModel: () => typedInvoke('agent-generator:get-model'),
  agentGeneratorSetModel: (modelId: string) => typedInvoke('agent-generator:set-model', modelId),

  // Skill generator
  skillGeneratorChat: (messages: SkillGeneratorMessage[], modelOverride?: string) =>
    typedInvoke('skill-generator:chat', messages, modelOverride),
  onSkillGeneratorToken: (callback: (chunk: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: string) => callback(chunk)
    typedOn('skill-generator:token', handler)
    return () => typedOff('skill-generator:token', handler)
  },
  onSkillGeneratorSpecReady: (callback: (spec: SkillGeneratorSpec) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, spec: SkillGeneratorSpec) => callback(spec)
    typedOn('skill-generator:spec-ready', handler)
    return () => typedOff('skill-generator:spec-ready', handler)
  },
  onSkillGeneratorDone: (callback: (data: { hasSpec: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { hasSpec: boolean }) => callback(data)
    typedOn('skill-generator:done', handler)
    return () => typedOff('skill-generator:done', handler)
  },
  onSkillGeneratorError: (callback: (data: { message: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { message: string }) => callback(data)
    typedOn('skill-generator:error', handler)
    return () => typedOff('skill-generator:error', handler)
  },
  skillGeneratorGetModel: () => typedInvoke('skill-generator:get-model'),
  skillGeneratorSetModel: (modelId: string) => typedInvoke('skill-generator:set-model', modelId),

  // Schedule generator
  scheduleGeneratorChat: (messages: ScheduleGeneratorMessage[], modelOverride?: string) =>
    typedInvoke('scheduler-generator:chat', messages, modelOverride),
  onScheduleGeneratorToken: (callback: (chunk: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: string) => callback(chunk)
    typedOn('scheduler-generator:token', handler)
    return () => typedOff('scheduler-generator:token', handler)
  },
  onScheduleGeneratorSpecReady: (callback: (spec: ScheduleGeneratorSpec) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, spec: ScheduleGeneratorSpec) => callback(spec)
    typedOn('scheduler-generator:spec-ready', handler)
    return () => typedOff('scheduler-generator:spec-ready', handler)
  },
  onScheduleGeneratorDone: (callback: (data: { hasSpec: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { hasSpec: boolean }) => callback(data)
    typedOn('scheduler-generator:done', handler)
    return () => typedOff('scheduler-generator:done', handler)
  },
  onScheduleGeneratorError: (callback: (data: { message: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { message: string }) => callback(data)
    typedOn('scheduler-generator:error', handler)
    return () => typedOff('scheduler-generator:error', handler)
  },
  getScheduleGeneratorModel: () => typedInvoke('scheduler-generator:get-model'),
  setScheduleGeneratorModel: (modelId: string) => typedInvoke('scheduler-generator:set-model', modelId),

  // Artifact CRUD
  artifactList: (projectId?: string) =>
    typedInvoke('artifact:list', projectId),
  artifactGet: (id: string) =>
    typedInvoke('artifact:get', id),
  artifactListVersions: (artifactId: string) =>
    typedInvoke('artifact:list-versions', artifactId),
  artifactGetVersion: (versionId: string) =>
    typedInvoke('artifact:get-version', versionId),
  artifactDelete: (id: string) =>
    typedInvoke('artifact:delete', id),
  artifactMoveToProject: (artifactId: string, projectId: string | null) =>
    typedInvoke('artifact:move-to-project', artifactId, projectId),
  artifactPromoteMessage: (input: ArtifactPromotionRequest) =>
    typedInvoke('artifact:promote-message', input),
  artifactExport: (versionId: string, format: string) =>
    typedInvoke('artifact:export', versionId, format),
  artifactOpenFolder: (absolutePath: string) =>
    typedInvoke('artifact:open-folder', absolutePath),
  artifactGetFileContent: (versionId: string, relativePath: string) =>
    typedInvoke('artifact:get-file-content', versionId, relativePath),

  // Artifact generator
  artifactGeneratorChat: (messages: ArtifactGeneratorMessage[], projectId?: string, modelOverride?: string) =>
    typedInvoke('artifact-generator:chat', messages, projectId, modelOverride),
  artifactGeneratorGenerate: (runId: string, spec: ArtifactSpec, projectId?: string, modelOverride?: string) =>
    typedInvoke('artifact-generator:generate', runId, spec, projectId, modelOverride),
  artifactGeneratorGetRuns: () =>
    typedInvoke('artifact-generator:get-runs'),
  artifactGeneratorGetStorageRoot: () =>
    typedInvoke('artifact-generator:get-storage-root'),
  artifactGeneratorSetStorageRoot: (path: string) =>
    typedInvoke('artifact-generator:set-storage-root', path),
  onArtifactGeneratorToken: (callback: (chunk: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: string) => callback(chunk)
    typedOn('artifact-generator:token', handler)
    return () => typedOff('artifact-generator:token', handler)
  },
  onArtifactGeneratorSpecReady: (callback: (spec: ArtifactSpec) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, spec: ArtifactSpec) => callback(spec)
    typedOn('artifact-generator:spec-ready', handler)
    return () => typedOff('artifact-generator:spec-ready', handler)
  },
  onArtifactGeneratorFileEvent: (callback: (event: { file: string; absolutePath?: string; status: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, e: { file: string; absolutePath?: string; status: string }) => callback(e)
    typedOn('artifact-generator:file-event', handler)
    return () => typedOff('artifact-generator:file-event', handler)
  },
  onArtifactGeneratorDone: (callback: (result: { hasSpec: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: { hasSpec: boolean }) => callback(result)
    typedOn('artifact-generator:done', handler)
    return () => typedOff('artifact-generator:done', handler)
  },

  // Scheduler
  schedulerList: () => typedInvoke('scheduler:list'),
  schedulerGet: (id: string) => typedInvoke('scheduler:get', id),
  schedulerCreate: (input: import('../shared/types').ScheduledTaskCreateInput) => typedInvoke('scheduler:create', input),
  schedulerUpdate: (id: string, input: import('../shared/types').ScheduledTaskUpdateInput) => typedInvoke('scheduler:update', id, input),
  schedulerDelete: (id: string) => typedInvoke('scheduler:delete', id),
  schedulerSetEnabled: (id: string, enabled: boolean) => typedInvoke('scheduler:set-enabled', id, enabled),
  schedulerRunNow: (id: string) => typedInvoke('scheduler:run-now', id),
  schedulerListRuns: (taskId: string, limit?: number) => typedInvoke('scheduler:list-runs', taskId, limit),
  schedulerListWorkflowTemplates: () => typedInvoke('scheduler:list-workflow-templates'),
  onSchedulerTaskUpdated: (callback: (task: import('../shared/types').ScheduledTask) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, task: import('../shared/types').ScheduledTask) => callback(task)
    typedOn('scheduler:task-updated', handler)
    return () => typedOff('scheduler:task-updated', handler)
  },
  onSchedulerTaskDeleted: (callback: (taskId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, taskId: string) => callback(taskId)
    typedOn('scheduler:task-deleted', handler)
    return () => typedOff('scheduler:task-deleted', handler)
  },
  onSchedulerRunUpdated: (callback: (run: import('../shared/types').ScheduledRun) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, run: import('../shared/types').ScheduledRun) => callback(run)
    typedOn('scheduler:run-updated', handler)
    return () => typedOff('scheduler:run-updated', handler)
  },

  // Debrief
  generateDebrief: (conversationId: string, projectId: string | null, model?: string) =>
    typedInvoke('conversation:generate-debrief', conversationId, projectId, model),
  startDebriefGeneration: (conversationId: string, projectId: string | null, model?: string) =>
    typedInvoke('conversation:start-debrief-generation', conversationId, projectId, model),
  getDebrief: (conversationId: string) =>
    typedInvoke('conversation:get-debrief', conversationId),
  markConversationComplete: (conversationId: string) =>
    typedInvoke('conversation:mark-complete', conversationId),
  markConversationIncomplete: (conversationId: string) =>
    typedInvoke('conversation:mark-incomplete', conversationId),
  onConversationCompleted: (callback: (data: { conversationId: string; completedAt: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { conversationId: string; completedAt: number }) => callback(data)
    typedOn('conversation:completed', handler)
    return () => typedOff('conversation:completed', handler)
  },
  onConversationIncompleted: (callback: (data: { conversationId: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { conversationId: string }) => callback(data)
    typedOn('conversation:incompleted', handler)
    return () => typedOff('conversation:incompleted', handler)
  },

  // Quiz
  generateQuiz: (conversationId: string, projectId: string | null, model?: string) =>
    typedInvoke('conversation:generate-quiz', conversationId, projectId, model),
  startQuizGeneration: (conversationId: string, projectId: string | null, model?: string) =>
    typedInvoke('conversation:start-quiz-generation', conversationId, projectId, model),
  getQuiz: (conversationId: string) =>
    typedInvoke('conversation:get-quiz', conversationId),

  // Activity feed
  getActivityList: () => typedInvoke('activity:list'),
  onActivityChanged: (callback: (activities: BackgroundActivity[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, activities: BackgroundActivity[]) => callback(activities)
    typedOn('activity:changed', handler)
    return () => typedOff('activity:changed', handler)
  },
  dismissActivity: (id: string) => typedInvoke('activity:dismiss', id),

  // Artifacts (live updates)
  onArtifactUpdated: (callback: (data: { artifactId: string; projectId: string | null }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { artifactId: string; projectId: string | null }) => callback(data)
    typedOn('artifact:updated', handler)
    return () => typedOff('artifact:updated', handler)
  },
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
