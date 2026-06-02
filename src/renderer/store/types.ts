export interface Conversation {
  id: string
  agent_id: string | null
  model?: string | null
  pinned?: number
  project_id?: string | null
  title: string
  created_at: number
  updated_at: number
}

export interface Project {
  id: string
  name: string
  color: string
  default_model?: string | null
  created_at: number
  updated_at: number
}

import type { AuthMode } from '../../shared/types'

export interface AuthState {
  authenticated: boolean
  mode: AuthMode
  user: null
  cliInstalled: boolean
}

export interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

export interface ToolApprovalRequest {
  requestId: string
  tool: string
  args: Record<string, unknown>
  description: string
}

export interface ProjectAgent {
  agentId: string
  agentName: string
  agentIcon: string
  isPrimary: boolean
  sortOrder: number
}

export interface DeleteAgentImpact {
  agentId: string
  agentName: string
  affectedProjects: { id: string; name: string; is_primary: number }[]
  affectedConvCount: number
}

export type {
  ProjectOrchestrationConfig,
  ScopeRule,
  Milestone,
  ProjectVariable,
  ProjectConfig,
} from '../../shared/types'
export { DEFAULT_PROJECT_CONFIG } from '../../shared/types'

export type Theme = 'light' | 'dark'
export type ActiveSectionPane = 'projects' | 'agents' | 'chats' | null
