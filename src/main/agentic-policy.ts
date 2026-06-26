import type { AgentConfig } from '../shared/types'

export function isFullAutoApprove(agent: AgentConfig | Record<string, unknown>): boolean {
  return (agent as Record<string, unknown>).fullAutoApprove === true
}

/**
 * Resolve the effective agentic policy for an agent. When `fullAutoApprove`
 * is set, the policy is forced to the most permissive preset and all
 * `neverAllow` entries are cleared — the flag means "trust everything".
 */
export function resolveAgenticPolicy(agent: AgentConfig): {
  preset: 'normal' | 'autonomous'
  neverAllow: string[]
} {
  if (isFullAutoApprove(agent)) {
    return { preset: 'autonomous', neverAllow: [] }
  }
  return { preset: agent.agenticMode ? 'autonomous' : 'normal', neverAllow: [] }
}
