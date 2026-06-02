import type { BrowserWindow } from 'electron'
import type { ProviderMessage } from '../providers'

export interface CliAdapterRequest {
  systemPrompt?: string
  messages: ProviderMessage[]
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
