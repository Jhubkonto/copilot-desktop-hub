export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  model?: string | null
  isEdited?: boolean
  previousContent?: string | null
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

export interface ToolConfig {
  enabled: boolean
  approval: 'auto' | 'always-ask' | 'disabled'
  instructions: string
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
  tools: { fileEdit: ToolConfig; terminal: ToolConfig; webFetch: ToolConfig }
  responseFormat: 'concise' | 'detailed' | 'code-only' | 'default'
  isDefault?: boolean
  rootDirectory?: string
  contextRules?: {
    ignoredGlobs: string[]
    autoInjectWorkspace: boolean
    autoInjectGit: boolean
  }
  memory?: string
  customCommands?: { name: string; description: string; prompt: string }[]
}

export interface ProjectOrchestrationConfig {
  orchestrationEnabled: boolean
  maxDelegationDepth: number
  showTeamActivity: boolean
}

export interface ScopeRule {
  id: string
  description: string
  pathGlob?: string
}

export interface Milestone {
  id: string
  title: string
  description?: string
  status: 'active' | 'upcoming' | 'completed'
  completedAt?: number
}

export interface ProjectVariable {
  key: string
  value: string
}

export interface ProjectConfig extends ProjectOrchestrationConfig {
  instructions: string
  rootDirectory: string
  variables: ProjectVariable[]
  instructionMode: 'prepend' | 'append' | 'replace' | 'standalone'
  instructionsEnabled: boolean
  inScope: ScopeRule[]
  outOfScope: ScopeRule[]
  milestones: Milestone[]
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  instructions: '',
  rootDirectory: '',
  variables: [],
  instructionMode: 'prepend',
  instructionsEnabled: true,
  orchestrationEnabled: false,
  maxDelegationDepth: 5,
  showTeamActivity: true,
  inScope: [],
  outOfScope: [],
  milestones: [],
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
  model?: string
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
  | 'agent:add-knowledge-file'
  | 'agent:create'
  | 'agent:delete'
  | 'agent:delete-preflight'
  | 'agent:duplicate'
  | 'agent:export'
  | 'agent:get'
  | 'agent:get-mcp-tool-overrides'
  | 'agent:import'
  | 'agent:list'
  | 'agent:list-knowledge-files'
  | 'agent:remove-knowledge-file'
  | 'agent:set-mcp-tool-override'
  | 'agent:update'
  | 'agent:update-knowledge-inject-mode'
  | 'app:check-updates'
  | 'app:create-gist'
  | 'app:download-update'
  | 'app:get-setting'
  | 'app:get-settings'
  | 'app:get-theme'
  | 'app:get-version'
  | 'app:install-update'
  | 'app:save-text-file'
  | 'app:set-auto-start'
  | 'app:set-setting'
  | 'app:set-theme'
  | 'auth:device-code'
  | 'auth:login'
  | 'auth:logout'
  | 'auth:status'
  | 'chat:new'
  | 'chat:send-message'
  | 'chat:stop-generation'
  | 'chat:stream-error'
  | 'chat:stream-response'
  | 'chat:team-activity'
  | 'cli:check'
  | 'cli:status'
  | 'context:git'
  | 'context:read-file'
  | 'context:workspace-summary'
  | 'conversation:create'
  | 'conversation:delete'
  | 'conversation:get-messages'
  | 'conversation:list'
  | 'conversation:rename'
  | 'conversation:search'
  | 'conversation:set-model'
  | 'conversation:set-pinned'
  | 'deeplink:open-agent'
  | 'deeplink:open-chat'
  | 'file:add-recent-dir'
  | 'file:get-cwd'
  | 'file:get-recent-dirs'
  | 'file:open-dialog'
  | 'file:open-directory-dialog'
  | 'file:set-cwd'
  | 'fs:list-directory'
  | 'fs:read-file'
  | 'fs:write-file'
  | 'mcp:add-server'
  | 'mcp:call-tool'
  | 'mcp:get-server-status'
  | 'mcp:list-servers'
  | 'mcp:list-tools'
  | 'mcp:list-tools-for-agent'
  | 'mcp:remove-server'
  | 'mcp:restart-server'
  | 'mcp:update-server'
  | 'message:delete'
  | 'message:delete-after'
  | 'project:add-agent'
  | 'project:create'
  | 'project:delete'
  | 'project:duplicate'
  | 'project:export'
  | 'project:get-config'
  | 'project:list'
  | 'project:list-agents'
  | 'project:remove-agent'
  | 'project:rename'
  | 'project:reorder-agents'
  | 'project:set-conversation'
  | 'project:set-default-model'
  | 'project:set-primary-agent'
  | 'project:update-config'
  | 'provider:get-azure-endpoint'
  | 'provider:has-key'
  | 'provider:list'
  | 'provider:remove-key'
  | 'provider:set-azure-endpoint'
  | 'provider:set-key'
  | 'provider:test-key'
  | 'terminal:create'
  | 'terminal:data'
  | 'terminal:dispose'
  | 'terminal:exit'
  | 'terminal:write'
  | 'tool:approval-response'
  | 'tool:execute'
  | 'tool:get-preferences'
  | 'tool:list'
  | 'tool:request-approval'
  | 'tool:set-preference'
  | 'updater:download-progress'
  | 'updater:error'
  | 'updater:no-update'
  | 'updater:update-available'
  | 'updater:update-downloaded'
  | 'window:close'
  | 'window:edit-action'
  | 'window:is-maximized'
  | 'window:maximize'
  | 'window:maximize-change'
  | 'window:minimize'
  | 'window:zoom'
