import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Platform
  platform: process.platform,

  // Settings
  getSettings: () => ipcRenderer.invoke('app:get-settings'),
  getSetting: (key: string) => ipcRenderer.invoke('app:get-setting', key),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('app:set-setting', key, value),
  getTheme: () => ipcRenderer.invoke('app:get-theme'),
  setTheme: (theme: 'light' | 'dark') => ipcRenderer.invoke('app:set-theme', theme),
  getVersion: () => ipcRenderer.invoke('app:get-version'),

  // Auth
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authLogin: () => ipcRenderer.invoke('auth:login'),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  onDeviceCode: (
    callback: (data: { userCode: string; verificationUri: string }) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { userCode: string; verificationUri: string }
    ) => callback(data)
    ipcRenderer.on('auth:device-code', handler)
    return () => ipcRenderer.removeListener('auth:device-code', handler)
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
    }
  ) => ipcRenderer.invoke('chat:send-message', conversationId, content, options),
  onStreamResponse: (callback: (chunk: string | null) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: string | null) =>
      callback(chunk)
    ipcRenderer.on('chat:stream-response', handler)
    return () => ipcRenderer.removeListener('chat:stream-response', handler)
  },
  onStreamError: (callback: (error: { type: string; message: string; retryable: boolean; retryAfterSeconds?: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: { type: string; message: string; retryable: boolean; retryAfterSeconds?: number }) =>
      callback(error)
    ipcRenderer.on('chat:stream-error', handler)
    return () => ipcRenderer.removeListener('chat:stream-error', handler)
  },
  stopGeneration: () => ipcRenderer.invoke('chat:stop-generation'),

  // Conversations
  listConversations: () => ipcRenderer.invoke('conversation:list'),
  createConversation: (agentId?: string, projectId?: string) =>
    ipcRenderer.invoke('conversation:create', agentId, projectId),
  deleteConversation: (id: string) => ipcRenderer.invoke('conversation:delete', id),
  getMessages: (conversationId: string) =>
    ipcRenderer.invoke('conversation:get-messages', conversationId),
  searchConversations: (query: string) =>
    ipcRenderer.invoke('conversation:search', query),
  renameConversation: (id: string, title: string) =>
    ipcRenderer.invoke('conversation:rename', id, title),
  setConversationModel: (id: string, model: string | null) =>
    ipcRenderer.invoke('conversation:set-model', id, model),
  setConversationPinned: (id: string, pinned: boolean) =>
    ipcRenderer.invoke('conversation:set-pinned', id, pinned),

  // Messages
  deleteMessage: (id: string) => ipcRenderer.invoke('message:delete', id),
  deleteMessagesAfter: (conversationId: string, timestamp: number) =>
    ipcRenderer.invoke('message:delete-after', conversationId, timestamp),

  // Files
  openFileDialog: () => ipcRenderer.invoke('file:open-dialog'),
  getWorkingDirectory: () => ipcRenderer.invoke('file:get-cwd'),
  setWorkingDirectory: (cwd: string) => ipcRenderer.invoke('file:set-cwd', cwd),
  readContextFile: (filePath: string) => ipcRenderer.invoke('context:read-file', filePath),
  getWorkspaceSummary: () => ipcRenderer.invoke('context:workspace-summary'),
  getGitContext: () => ipcRenderer.invoke('context:git'),

  // Agents
  listAgents: () => ipcRenderer.invoke('agent:list'),
  getAgent: (id: string) => ipcRenderer.invoke('agent:get', id),
  createAgent: (config: unknown) => ipcRenderer.invoke('agent:create', config),
  updateAgent: (id: string, config: unknown) =>
    ipcRenderer.invoke('agent:update', id, config),
  deleteAgent: (id: string) => ipcRenderer.invoke('agent:delete', id),
  duplicateAgent: (id: string) => ipcRenderer.invoke('agent:duplicate', id),
  exportAgent: (id: string) => ipcRenderer.invoke('agent:export', id),
  importAgent: () => ipcRenderer.invoke('agent:import'),

  // Directories
  openDirectoryDialog: () => ipcRenderer.invoke('file:open-directory-dialog'),

  // Tools
  listTools: () => ipcRenderer.invoke('tool:list'),
  executeTool: (name: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke('tool:execute', name, args),
  respondToToolApproval: (requestId: string, approved: boolean, remember: boolean) =>
    ipcRenderer.invoke('tool:approval-response', requestId, approved, remember),
  setToolPreference: (toolName: string, value: string) =>
    ipcRenderer.invoke('tool:set-preference', toolName, value),
  getToolPreferences: () => ipcRenderer.invoke('tool:get-preferences'),
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
    ipcRenderer.on('tool:request-approval', handler)
    return () => ipcRenderer.removeListener('tool:request-approval', handler)
  },

  // Terminal
  createTerminal: (id: string, cwd?: string) =>
    ipcRenderer.invoke('terminal:create', id, cwd),
  writeTerminal: (id: string, data: string) =>
    ipcRenderer.invoke('terminal:write', id, data),
  disposeTerminal: (id: string) => ipcRenderer.invoke('terminal:dispose', id),
  onTerminalData: (callback: (id: string, data: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string, data: string) =>
      callback(id, data)
    ipcRenderer.on('terminal:data', handler)
    return () => ipcRenderer.removeListener('terminal:data', handler)
  },
  onTerminalExit: (callback: (id: string, code: number | null) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      id: string,
      code: number | null
    ) => callback(id, code)
    ipcRenderer.on('terminal:exit', handler)
    return () => ipcRenderer.removeListener('terminal:exit', handler)
  },

  // MCP Servers
  listMcpServers: () => ipcRenderer.invoke('mcp:list-servers'),
  addMcpServer: (config: Record<string, unknown>) =>
    ipcRenderer.invoke('mcp:add-server', config),
  updateMcpServer: (id: string, updates: Record<string, unknown>) =>
    ipcRenderer.invoke('mcp:update-server', id, updates),
  removeMcpServer: (id: string) => ipcRenderer.invoke('mcp:remove-server', id),
  getMcpServerStatus: (id: string) => ipcRenderer.invoke('mcp:get-server-status', id),
  listMcpTools: (serverIds?: string[]) => ipcRenderer.invoke('mcp:list-tools', serverIds),
  callMcpTool: (serverId: string, toolName: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke('mcp:call-tool', serverId, toolName, args),
  restartMcpServer: (id: string) => ipcRenderer.invoke('mcp:restart-server', id),

  // Providers (BYOK)
  listProviders: () => ipcRenderer.invoke('provider:list'),
  setProviderKey: (provider: string, key: string) =>
    ipcRenderer.invoke('provider:set-key', provider, key),
  removeProviderKey: (provider: string) => ipcRenderer.invoke('provider:remove-key', provider),
  hasProviderKey: (provider: string) => ipcRenderer.invoke('provider:has-key', provider),
  testProviderKey: (provider: string, key: string, endpoint?: string) =>
    ipcRenderer.invoke('provider:test-key', provider, key, endpoint),
  getAzureEndpoint: () => ipcRenderer.invoke('provider:get-azure-endpoint'),
  setAzureEndpoint: (endpoint: string) =>
    ipcRenderer.invoke('provider:set-azure-endpoint', endpoint),

  // Projects
  listProjects: () => ipcRenderer.invoke('project:list'),
  createProject: (name: string, color: string) => ipcRenderer.invoke('project:create', name, color),
  renameProject: (id: string, name: string) => ipcRenderer.invoke('project:rename', id, name),
  deleteProject: (id: string) => ipcRenderer.invoke('project:delete', id),
  setConversationProject: (conversationId: string, projectId: string | null) =>
    ipcRenderer.invoke('project:set-conversation', conversationId, projectId),

  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
  editAction: (action: string) => ipcRenderer.invoke('window:edit-action', action),
  zoomIn: () => ipcRenderer.invoke('window:zoom', 0.5),
  zoomOut: () => ipcRenderer.invoke('window:zoom', -0.5),
  resetZoom: () => ipcRenderer.invoke('window:zoom', 0),
  onMaximizeChange: (callback: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
    ipcRenderer.on('window:maximize-change', handler)
    return () => ipcRenderer.removeListener('window:maximize-change', handler)
  },

  // Auto-start
  setAutoStart: (enabled: boolean) => ipcRenderer.invoke('app:set-auto-start', enabled),
  saveTextFile: (defaultFileName: string, content: string) =>
    ipcRenderer.invoke('app:save-text-file', defaultFileName, content),
  createGist: (filename: string, content: string, description?: string) =>
    ipcRenderer.invoke('app:create-gist', filename, content, description),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('app:check-updates'),
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  onUpdateAvailable: (callback: (info: { version: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: { version: string }) =>
      callback(info)
    ipcRenderer.on('updater:update-available', handler)
    return () => ipcRenderer.removeListener('updater:update-available', handler)
  },
  onUpdateDownloaded: (callback: () => void) => {
    ipcRenderer.on('updater:update-downloaded', callback)
    return () => ipcRenderer.removeListener('updater:update-downloaded', callback)
  },

  // System events
  onNewChat: (callback: () => void) => {
    ipcRenderer.on('chat:new', callback)
    return () => ipcRenderer.removeListener('chat:new', callback)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
