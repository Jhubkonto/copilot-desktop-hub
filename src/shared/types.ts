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

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthUser {
  login: string
  avatar_url: string
  name: string | null
}

export interface AuthStatus {
  authenticated: boolean
  user: AuthUser | null
}

export interface AuthLoginResult {
  success: boolean
  user?: AuthUser
  error?: string
}

// ---------------------------------------------------------------------------
// Database row shapes (snake_case — returned directly from SQLite handlers)
// ---------------------------------------------------------------------------

export interface ConversationRow {
  id: string
  agent_id: string | null
  project_id: string | null
  title: string
  model: string | null
  pinned: number
  created_at: number
  updated_at: number
}

export interface MessageRow {
  id: string
  conversation_id: string
  role: string
  content: string
  model: string | null
  is_edited: number
  previous_content: string | null
  timestamp: number
  tool_calls: string | null
  attachments: string | null
  context_snapshot: string | null
}

export interface KnowledgeFile {
  id: string
  agent_id: string
  file_path: string
  inject_mode: string
  sort_order: number
  created_at: number
  updated_at: number
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectRow {
  id: string
  name: string
  color: string
  default_model: string | null
  config: ProjectConfig
  created_at: number
  updated_at: number
}

export interface ProjectAgent {
  agentId: string
  agentName: string
  agentIcon: string
  isPrimary: boolean
  sortOrder: number
}

// ---------------------------------------------------------------------------
// Agent operations
// ---------------------------------------------------------------------------

export interface AffectedProject {
  id: string
  name: string
  is_primary: number
}

export interface DeleteAgentPreflight {
  affectedProjects: AffectedProject[]
  affectedConvCount: number
}

export interface DeleteAgentResult {
  success: boolean
  reason?: string
  affectedProjects?: AffectedProject[]
  affectedConvCount?: number
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

export interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  serverId: string
  serverName: string
}

export interface McpServerWithStatus extends McpServerConfig {
  status: 'connecting' | 'connected' | 'error' | 'disconnected'
  error?: string
  toolCount: number
}

export interface McpServerStatus {
  status: 'connecting' | 'connected' | 'error' | 'disconnected'
  error?: string
  tools: McpTool[]
}

export interface McpToolOverrideRow {
  agent_id: string
  server_id: string
  tool_name: string
  enabled: number
  approval: string
  instructions: string
}

export interface McpCallResult {
  success: boolean
  result?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** Shape returned by `tool:list` (built-in tool catalogue). */
export interface BuiltinToolDefinition {
  name: string
  description: string
  args: { name: string; type: string; required: boolean }[]
}

export interface ToolExecuteResult {
  success: boolean
  result?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Files / directories
// ---------------------------------------------------------------------------

export interface DirectoryEntry {
  name: string
  relativePath: string
  type: 'file' | 'dir'
}

export interface ContextFileResult {
  path: string
  content: string
  truncated: boolean
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export interface ProviderInfo {
  name: string
  label: string
  apiKeySettingKey: string
  models: string[]
  configured: boolean
}

export interface ProviderTestResult {
  valid: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// IPC return-type map  (RF.12 — every invoke channel → concrete return type)
// ---------------------------------------------------------------------------

export type IpcReturnMap = {
  // Agent
  'agent:add-knowledge-file': KnowledgeFile | null
  'agent:create': AgentConfig
  'agent:delete': DeleteAgentResult
  'agent:delete-preflight': DeleteAgentPreflight
  'agent:duplicate': AgentConfig | null
  'agent:export': boolean
  'agent:get': AgentConfig | null
  'agent:get-mcp-tool-overrides': McpToolOverrideRow[]
  'agent:import': AgentConfig | null
  'agent:list': AgentConfig[]
  'agent:list-knowledge-files': KnowledgeFile[]
  'agent:remove-knowledge-file': boolean
  'agent:set-mcp-tool-override': boolean
  'agent:update': AgentConfig
  'agent:update-knowledge-inject-mode': boolean
  // App
  'app:check-updates': void
  'app:create-gist': string
  'app:download-update': void
  'app:get-setting': string | null
  'app:get-settings': Record<string, string>
  'app:get-theme': string
  'app:get-version': string
  'app:install-update': void
  'app:save-text-file': string
  'app:set-auto-start': boolean
  'app:set-setting': boolean
  'app:set-theme': boolean
  // Auth
  'auth:device-code': void
  'auth:login': AuthLoginResult
  'auth:logout': void
  'auth:status': AuthStatus
  // Chat
  'chat:new': void
  'chat:send-message': void
  'chat:stop-generation': void
  'chat:stream-error': void
  'chat:stream-response': void
  'chat:team-activity': void
  // CLI
  'cli:check': void
  'cli:status': void
  // Context
  'context:git': string
  'context:read-file': ContextFileResult
  'context:workspace-summary': string
  // Conversation
  'conversation:create': ConversationRow
  'conversation:delete': boolean
  'conversation:get-messages': MessageRow[]
  'conversation:list': ConversationRow[]
  'conversation:rename': boolean
  'conversation:search': ConversationRow[]
  'conversation:set-model': boolean
  'conversation:set-pinned': boolean
  'conversation:update-context': boolean
  // Deeplink (push-only)
  'deeplink:open-agent': void
  'deeplink:open-chat': void
  // File
  'file:add-recent-dir': string[]
  'file:get-cwd': string
  'file:get-recent-dirs': string[]
  'file:open-dialog': Attachment[]
  'file:open-directory-dialog': string[]
  'file:set-cwd': boolean
  // FS
  'fs:list-directory': DirectoryEntry[]
  'fs:read-file': string
  'fs:write-file': boolean
  // MCP
  'mcp:add-server': McpServerConfig
  'mcp:call-tool': McpCallResult
  'mcp:get-server-status': McpServerStatus
  'mcp:list-servers': McpServerWithStatus[]
  'mcp:list-tools': McpTool[]
  'mcp:list-tools-for-agent': McpTool[]
  'mcp:remove-server': boolean
  'mcp:restart-server': boolean
  'mcp:update-server': McpServerConfig | null
  // Message
  'message:delete': void
  'message:delete-after': void
  // Project
  'project:add-agent': boolean
  'project:create': ProjectRow
  'project:delete': boolean
  'project:duplicate': ProjectRow | null
  'project:export': boolean
  'project:get-config': ProjectConfig
  'project:list': ProjectRow[]
  'project:list-agents': ProjectAgent[]
  'project:remove-agent': boolean
  'project:rename': boolean
  'project:reorder-agents': boolean
  'project:set-conversation': boolean
  'project:set-default-model': boolean
  'project:set-primary-agent': boolean
  'project:update-config': boolean
  // Provider
  'provider:get-azure-endpoint': string
  'provider:has-key': boolean
  'provider:list': ProviderInfo[]
  'provider:remove-key': boolean
  'provider:set-azure-endpoint': boolean
  'provider:set-key': boolean
  'provider:test-key': ProviderTestResult
  // Tool
  'tool:approval-response': boolean
  'tool:execute': ToolExecuteResult
  'tool:get-preferences': Record<string, string>
  'tool:list': BuiltinToolDefinition[]
  'tool:request-approval': void
  'tool:set-preference': boolean
  // Updater (push-only)
  'updater:download-progress': void
  'updater:error': void
  'updater:no-update': void
  'updater:update-available': void
  'updater:update-downloaded': void
  // Window
  'window:close': void
  'window:edit-action': void
  'window:is-maximized': boolean
  'window:maximize': void
  'window:maximize-change': void
  'window:minimize': void
  'window:zoom': void
}

/** Resolves the concrete return type for a given IPC channel. */
export type ApiError = { error: string }
export function isApiError(result: unknown): result is ApiError {
  return typeof result === 'object' && result !== null && 'error' in result && typeof (result as Record<string, unknown>).error === 'string'
}
export type IpcReturn<C extends IpcChannels> = C extends keyof IpcReturnMap ? IpcReturnMap[C] : never

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
  | 'conversation:update-context'
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
