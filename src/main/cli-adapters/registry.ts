import type { CliAgentAdapter } from './types'
import { ClaudeAdapter } from './claude'
import { CodexAdapter } from './codex'
import { HermesAcpAdapterInstance } from './hermes-acp'

let adapters: Map<string, CliAgentAdapter> | null = null

function getAdapters(): Map<string, CliAgentAdapter> {
  if (!adapters) {
    adapters = new Map<string, CliAgentAdapter>([
      ['claude-cli', ClaudeAdapter],
      ['codex-cli', CodexAdapter],
      ['hermes-cli', HermesAcpAdapterInstance],
    ])
  }
  return adapters
}

export function getAdapter(backend: string): CliAgentAdapter | undefined {
  return getAdapters().get(backend)
}
