export type ToastType = 'info' | 'success' | 'error'

export interface ToolCallEvent {
  toolName: string
  serverName: string
  args: Record<string, unknown>
  result: string
  success: boolean
  resultImages?: { dataUrl: string }[]
}

export interface Attachment {
  id: string
  name: string
  path: string
  size: number
}

export interface PastedImage {
  id: string
  dataUrl: string
  name: string
  label?: string
  mode?: 'vision' | 'text'
  ocrText?: string
  ocrPending?: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'team-activity' | 'tool-call'
  content: string
  timestamp: number
  model?: string | null
  attachments?: Attachment[]
  images?: PastedImage[]
  isEdited?: boolean
  isError?: boolean
  errorType?: string
  retryable?: boolean
  isStopped?: boolean
  contextSnapshot?: string
  toolName?: string
  serverName?: string
  toolArgs?: Record<string, unknown>
  toolResult?: string
  toolSuccess?: boolean
  toolResultImages?: { dataUrl: string }[]
}

export interface ContextRef {
  key: 'workspace' | 'git' | 'file' | 'clipboard'
  token: string
  value?: string
}

export interface AtContextOption {
  token: '@workspace' | '@git' | '@file:'
  key: ContextRef['key']
  description: string
}

export interface StreamError {
  type: string
  message: string
  retryable: boolean
  retryAfterSeconds?: number
}

export interface ContextSnapshot {
  systemPrompt: string
  contextRefs: { token: string; key: string }[]
  attachments: { name: string; size: number }[]
  historyLength: number
  estimatedTokens: number
  model: string
  timestamp: number
}

export interface TeamActivityStep {
  stepId: string
  agentId: string
  agentName: string
  agentIcon: string
  task: string
  status: 'delegating' | 'done' | 'error'
  result?: string
  durationMs?: number
}

export interface ConversationDbMessage {
  id: string
  role: string
  content: string
  timestamp: number
  model?: string | null
  is_edited?: number
  attachments?: string
  context_snapshot?: string | null
}

export const AT_CONTEXT_OPTIONS: AtContextOption[] = [
  {
    token: '@workspace',
    key: 'workspace',
    description: 'Attach workspace summary',
  },
  {
    token: '@git',
    key: 'git',
    description: 'Attach git branch, status, recent commits',
  },
  {
    token: '@file:',
    key: 'file',
    description: 'Attach file by path (example: @file:src/main.ts)',
  },
]

