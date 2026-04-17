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

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  enabled: boolean
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

export interface ToolCall {
  id: string
  tool: string
  args: Record<string, unknown>
  status: 'pending' | 'approved' | 'denied' | 'running' | 'completed' | 'failed'
  result?: string
  error?: string
}

export interface ToolApprovalRequest {
  requestId: string
  tool: string
  args: Record<string, unknown>
  description: string
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
  | 'tool:list'
  | 'tool:execute'
  | 'tool:request-approval'
  | 'tool:approval-response'
  | 'tool:set-preference'
  | 'tool:get-preferences'
  | 'terminal:create'
  | 'terminal:write'
  | 'terminal:data'
  | 'terminal:exit'
  | 'terminal:dispose'
  | 'mcp:list-servers'
  | 'mcp:add-server'
  | 'mcp:update-server'
  | 'mcp:remove-server'
  | 'mcp:get-server-status'
  | 'mcp:list-tools'
  | 'mcp:call-tool'
  | 'mcp:restart-server'
  | 'provider:list'
  | 'provider:set-key'
  | 'provider:remove-key'
  | 'provider:has-key'
  | 'provider:test-key'
  | 'app:set-auto-start'
  | 'app:check-updates'
