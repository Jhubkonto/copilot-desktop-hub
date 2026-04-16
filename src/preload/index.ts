import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Settings
  getSettings: () => ipcRenderer.invoke('app:get-settings'),
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
  sendMessage: (conversationId: string, content: string) =>
    ipcRenderer.invoke('chat:send-message', conversationId, content),
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

  // Agents
  listAgents: () => ipcRenderer.invoke('agent:list'),
  createAgent: (config: unknown) => ipcRenderer.invoke('agent:create', config),
  updateAgent: (id: string, config: unknown) =>
    ipcRenderer.invoke('agent:update', id, config),
  deleteAgent: (id: string) => ipcRenderer.invoke('agent:delete', id),

  // System events
  onNewChat: (callback: () => void) => {
    ipcRenderer.on('chat:new', callback)
    return () => ipcRenderer.removeListener('chat:new', callback)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
