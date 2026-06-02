import type { CliAgentAdapter } from './types'
import { ClaudeAdapter } from './claude'
import { CodexAdapter } from './codex'
import { GhCopilotAdapter } from './gh-copilot'

const adapters = new Map<string, CliAgentAdapter>([
  ['claude-cli', ClaudeAdapter],
  ['codex-cli', CodexAdapter],
  ['gh-copilot', GhCopilotAdapter],
])

export function getAdapter(backend: string): CliAgentAdapter | undefined {
  return adapters.get(backend)
}
