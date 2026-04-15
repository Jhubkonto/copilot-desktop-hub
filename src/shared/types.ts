export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
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
  | 'agent:list'
  | 'agent:create'
  | 'agent:update'
  | 'agent:delete'
