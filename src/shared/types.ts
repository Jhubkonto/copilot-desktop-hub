export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  attachments?: Attachment[]
}

export interface Attachment {
  id: string
  name: string
  path: string
  size: number
}

export interface Conversation {
  id: string
  agentId: string | null
  title: string
  createdAt: number
  updatedAt: number
}

export interface AgentConfig {
  id: string
  name: string
  icon: string
  systemPrompt: string
  model: string
  temperature: number
  maxTokens: number
  contextDirectories: string[]
  contextFiles: string[]
  mcpServers: string[]
  agenticMode: boolean
  tools: {
    fileEdit: boolean
    terminal: boolean
    webFetch: boolean
  }
  responseFormat: 'concise' | 'detailed' | 'code-only' | 'default'
  isDefault?: boolean
}

export interface SendMessageOptions {
  attachments?: Attachment[]
  regenerate?: boolean
  agentId?: string
}

export interface AppSettings {
  theme: 'light' | 'dark'
  globalHotkey: string
  autoStart: boolean
  autoUpdate: boolean
}

export type IpcChannels =
  | 'app:get-settings'
  | 'app:set-setting'
  | 'app:get-theme'
  | 'app:set-theme'
  | 'chat:send-message'
  | 'chat:stream-response'
  | 'chat:stop-generation'
  | 'conversation:list'
  | 'conversation:create'
  | 'conversation:delete'
  | 'conversation:get-messages'
  | 'conversation:search'
  | 'conversation:rename'
  | 'message:delete'
  | 'message:delete-after'
  | 'file:open-dialog'
  | 'agent:list'
  | 'agent:get'
  | 'agent:create'
  | 'agent:update'
  | 'agent:delete'
  | 'agent:duplicate'
  | 'agent:export'
  | 'agent:import'
  | 'file:open-directory-dialog'
