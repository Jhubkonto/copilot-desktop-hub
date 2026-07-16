import type { CliAgentAdapter } from './types'
import { ClaudeAdapter } from './claude'
import { CodexAdapter } from './codex'
import { HermesAdapter } from './hermes'

const adapters = new Map<string, CliAgentAdapter>([
  ['claude-cli', ClaudeAdapter],
  ['codex-cli', CodexAdapter],
  ['hermes-cli', HermesAdapter],
])

export function getAdapter(backend: string): CliAgentAdapter | undefined {
  return adapters.get(backend)
}
