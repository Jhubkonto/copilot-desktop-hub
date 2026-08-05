import type { CliAgentAdapter } from './types'
import { ClaudeAdapter } from './claude'
import { CodexAdapter } from './codex'
import { HermesAcpAdapterInstance } from './hermes-acp'

const adapters = new Map<string, CliAgentAdapter>([
  ['claude-cli', ClaudeAdapter],
  ['codex-cli', CodexAdapter],
  ['hermes-cli', HermesAcpAdapterInstance],
])

export function getAdapter(backend: string): CliAgentAdapter | undefined {
  return adapters.get(backend)
}
