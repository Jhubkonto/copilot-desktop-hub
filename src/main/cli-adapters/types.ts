import type { BrowserWindow } from 'electron'
import type { ProviderMessage } from '../providers'

export interface CliAdapterRequest {
  systemPrompt?: string
  messages: ProviderMessage[]
  images?: { id: string; name: string; dataUrl: string }[]
  mcpServers?: {
    id: string
    key: string
    command: string
    args: string[]
    env?: Record<string, string>
    cwd?: string
  }[]
  allowedTools?: string[]
  cwd: string
  model: string
  conversationId: string
}

export type CliStreamEvent =
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; id: string; content: string; isError: boolean }
  | { type: 'cost'; totalCostUsd: number; inputTokens: number; outputTokens: number }

export interface CliAgentAdapter {
  readonly name: string
  send(
    window: BrowserWindow,
    req: CliAdapterRequest,
    onChunk: (chunk: string) => void,
    onEvent?: (event: CliStreamEvent) => void
  ): Promise<string>
  isAvailable(): boolean
}
