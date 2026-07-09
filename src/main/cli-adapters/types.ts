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
  thinkingEffort?: 'low' | 'medium' | 'high' | 'max' | 'disabled'
  skipPermissions?: boolean
}

export type CliStreamEvent =
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; id: string; content: string; isError: boolean }
  | { type: 'cost'; totalCostUsd: number; inputTokens: number; outputTokens: number }
  | { type: 'thinking_chunk'; blockId: string; chunk: string }
  | { type: 'thinking_end'; blockId: string }
  // A transient status update (e.g. CLI lifecycle narration) — surfaced as the live
  // "Thinking…" activity line, never persisted into message history. Distinct from
  // thinking_chunk/thinking_end, which accumulate into a reasoning block that sticks
  // around after the turn completes.
  | { type: 'activity'; label: string }

export interface CliAgentAdapter {
  readonly name: string
  send(
    window: BrowserWindow,
    req: CliAdapterRequest,
    onChunk: (chunk: string) => void,
    onEvent?: (event: CliStreamEvent) => void,
    signal?: AbortSignal
  ): Promise<string>
  isAvailable(): boolean
}
