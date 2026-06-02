export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolCallResult {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ProviderNonStreamResult {
  content: string | null
  toolCalls: ToolCallResult[]
  model?: string
}

export type ToolChoice = 'auto' | 'required' | 'none'
