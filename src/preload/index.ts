import { contextBridge, ipcRenderer } from 'electron'
import type {
  AndroidBuildCommandName,
  AndroidSigningConfig,
  AndroidWorkspaceInfo,
  BuildCommandName,
  BuildRecord,
  BuildStatus,
  CatalogModel,
  ConversationCompressionSaveInput,
  IpcChannels,
  IpcReturn,
  PromptLibraryInput,
  PromptLibraryUpdate,
  AvailableModelGroup,
  PublishedEntry,
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
      messageId?: string
      projectId?: string
      contextSnapshot?: string
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
  onStreamError: (callback: (error: { type: string; message: string; retryable: boolean; retryAfterSeconds?: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: { type: string; message: string; retryable: boolean; retryAfterSeconds?: number }) =>
      callback(error)
    typedOn('chat:stream-error', handler)
    return () => typedOff('chat:stream-error', handler)
  },
  onToolCallEvent: (callback: (data: { toolName: string; serverName: string; args: Record<string, unknown>; result: string; success: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { toolName: string; serverName: string; args: Record<string, unknown>; result: string; success: boolean }) =>
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
  onStreamModel: (callback: (model: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, model: string) => callback(model)
    typedOn('chat:stream-model', handler)
    return () => typedOff('chat:stream-model', handler)
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
  searchConversations: (query: string) =>
    typedInvoke('conversation:search', query),
  renameConversation: (id: string, title: string) =>
    typedInvoke('conversation:rename', id, title),
  setConversationModel: (id: string, model: string | null) =>
    typedInvoke('conversation:set-model', id, model),
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
  getWorkspaceSummary: () => typedInvoke('context:workspace-summary'),
  getGitContext: () => typedInvoke('context:git'),
  getGitDiff: () => typedInvoke('context:git-diff'),

  // Mobile companion WebSocket server
  wsStart: () => typedInvoke('ws:start'),
  wsStop: () => typedInvoke('ws:stop'),
  wsStatus: () => typedInvoke('ws:status'),
  wsRegenerateToken: () => typedInvoke('ws:regenerate-token'),

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
  listTools: () => typedInvoke('tool:list'),
  executeTool: (
    name: string,
    args: Record<string, unknown>,
    agentToolConfig?: { enabled: boolean; approval: string; instructions: string }
  ) => typedInvoke('tool:execute', name, args, agentToolConfig),
  respondToToolApproval: (requestId: string, approved: boolean, remember: boolean) =>
    typedInvoke('tool:approval-response', requestId, approved, remember),
  setToolPreference: (toolName: string, value: string) =>
    typedInvoke('tool:set-preference', toolName, value),
  getToolPreferences: () => typedInvoke('tool:get-preferences'),
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
  callMcpTool: (serverId: string, toolName: string, args: Record<string, unknown>, agentId?: string) =>
    typedInvoke('mcp:call-tool', serverId, toolName, args, agentId),
  restartMcpServer: (id: string) => typedInvoke('mcp:restart-server', id),

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
  createGist: (filename: string, content: string, description?: string) =>
    typedInvoke('app:create-gist', filename, content, description),

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
  onBuildLogChunk: (callback: (data: { buildId: string; line: string; stream: 'stdout' | 'stderr' }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { buildId: string; line: string; stream: 'stdout' | 'stderr' }) => callback(data)
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
  onAndroidLogChunk: (callback: (data: { buildId: string; line: string; stream: 'stdout' | 'stderr' }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { buildId: string; line: string; stream: 'stdout' | 'stderr' }) => callback(data)
    typedOn('android:log-chunk', handler)
    return () => typedOff('android:log-chunk', handler)
  },
  onAndroidCommandDone: (callback: (data: { buildId: string; status: BuildStatus; exitCode: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { buildId: string; status: BuildStatus; exitCode: number }) => callback(data)
    typedOn('android:command-done', handler)
    return () => typedOff('android:command-done', handler)
  },
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api

