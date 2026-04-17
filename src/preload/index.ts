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

  // CLI detection
  checkCli: () => ipcRenderer.invoke('cli:check'),
  cliStatus: () => ipcRenderer.invoke('cli:status'),

  // Chat
  sendMessage: (
    conversationId: string,
    content: string,
    options?: { attachments?: { id: string; name: string; path: string; size: number }[]; regenerate?: boolean; agentId?: string }
  ) => ipcRenderer.invoke('chat:send-message', conversationId, content, options),
  onStreamResponse: (callback: (chunk: string | null) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: string | null) =>
      callback(chunk)
    ipcRenderer.on('chat:stream-response', handler)
    return () => ipcRenderer.removeListener('chat:stream-response', handler)
  },
  stopGeneration: () => ipcRenderer.invoke('chat:stop-generation'),

  // Conversations
  listConversations: () => ipcRenderer.invoke('conversation:list'),
  createConversation: (agentId?: string) =>
    ipcRenderer.invoke('conversation:create', agentId),
  deleteConversation: (id: string) => ipcRenderer.invoke('conversation:delete', id),
  getMessages: (conversationId: string) =>
    ipcRenderer.invoke('conversation:get-messages', conversationId),
  searchConversations: (query: string) =>
    ipcRenderer.invoke('conversation:search', query),
  renameConversation: (id: string, title: string) =>
    ipcRenderer.invoke('conversation:rename', id, title),

  // Messages
  deleteMessage: (id: string) => ipcRenderer.invoke('message:delete', id),
  deleteMessagesAfter: (conversationId: string, timestamp: number) =>
    ipcRenderer.invoke('message:delete-after', conversationId, timestamp),

  // Files
  openFileDialog: () => ipcRenderer.invoke('file:open-dialog'),

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
  testProviderKey: (provider: string, key: string) =>
    ipcRenderer.invoke('provider:test-key', provider, key),

  // Auto-start
  setAutoStart: (enabled: boolean) => ipcRenderer.invoke('app:set-auto-start', enabled),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('app:check-updates'),

  // System events
  onNewChat: (callback: () => void) => {
    ipcRenderer.on('chat:new', callback)
    return () => ipcRenderer.removeListener('chat:new', callback)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
