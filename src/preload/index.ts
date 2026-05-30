import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannels, IpcReturn } from '../shared/types'

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
  authLogin: () => typedInvoke('auth:login'),
  authLogout: () => typedInvoke('auth:logout'),
  onDeviceCode: (
    callback: (data: { userCode: string; verificationUri: string }) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { userCode: string; verificationUri: string }
    ) => callback(data)
    typedOn('auth:device-code', handler)
    return () => typedOff('auth:device-code', handler)
  },

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
  stopGeneration: (conversationId?: string) => typedInvoke('chat:stop-generation', conversationId),

  // Conversations
  listConversations: () => typedInvoke('conversation:list'),
  createConversation: (agentId?: string, projectId?: string) =>
    typedInvoke('conversation:create', agentId, projectId),
  deleteConversation: (id: string) => typedInvoke('conversation:delete', id),
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
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
