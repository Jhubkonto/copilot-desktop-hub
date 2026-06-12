export interface KnowledgeFile {
  id: string
  agent_id: string
  file_path: string
  inject_mode: 'always' | 'on-demand'
  sort_order: number
  created_at: number
  updated_at: number
}

export interface McpTool {
  name: string
  description?: string
  serverId: string
  serverName: string
}

export interface McpServerInfo {
  id: string
  name: string
  enabled: boolean
  status: 'connecting' | 'connected' | 'error' | 'disconnected'
  error?: string
  toolCount: number
}

export interface McpToolOverride {
  agent_id: string
  server_id: string
  tool_name: string
  enabled: number
  approval: string
  instructions: string
}

export type McpTrustTier = 'auto' | 'always-ask' | 'block' | 'custom'
