/**
 * Shared "which backend actually answers this" decision, used by both normal chat dispatch
 * (chat-handlers.ts) and the Code Changes investigation pipeline (remote-edit/investigator.ts via
 * loadInvestigationSettings). Extracted so the two can't drift apart — before this existed, a
 * conversation running entirely on the CLI-availability fallback (no BYOK key configured anywhere,
 * authMode='none', a local Claude/Codex CLI auto-detected) would chat successfully but Code
 * Changes had no way to know that fallback had been chosen, since it's a runtime decision that's
 * never persisted to the conversations row — /code-change would fail with "No provider configured"
 * even though the exact same conversation was demonstrably working.
 */

import type { ProviderName } from './provider-core-types'
import { getApiKey, getOpenRouterModels } from './providers'
import { ClaudeAdapter } from './cli-adapters/claude'
import { CodexAdapter } from './cli-adapters/codex'
import { getCliModels } from './cli-detection'
import { retrieveAuthMode } from './auth'
import { getDatabase } from './database'

export type EffectiveCliBackend = 'claude-cli' | 'codex-cli' | undefined

/**
 * Resolves the model a request should route on when no explicit model was sent — mirrors
 * ws-handlers.ts's chat:send-message handling (Android's "no model or 'default' picked" case),
 * which falls back to the global `default_model` setting rather than leaving it unresolved.
 */
export function resolveEffectiveModelForRouting(explicitModel: string | null | undefined): string | undefined {
  if (explicitModel && explicitModel !== 'default') return explicitModel
  const row = getDatabase().prepare("SELECT value FROM settings WHERE key = 'default_model'").get() as { value: string } | undefined
  return row?.value || undefined
}

/**
 * Classifies a model as belonging to a CLI backend's own model list, if any — the other half of
 * ws-handlers.ts's `inferredCliBackend` computation. A conversation with no explicit backend but
 * whose (possibly default_model-derived) model is a known CLI model routes through that CLI.
 */
export function inferCliBackendFromModel(model: string | undefined): EffectiveCliBackend {
  if (!model) return undefined
  if (CodexAdapter.isAvailable() && getCliModels('codex-cli').some((m) => m.id === model)) return 'codex-cli'
  if (ClaudeAdapter.isAvailable() && getCliModels('claude-cli').some((m) => m.id === model)) return 'claude-cli'
  return undefined
}

export function resolveEffectiveBackend(opts: {
  /** An explicit per-request override (e.g. from the Android WS path) — always wins. */
  cliBackend?: string
  /** The agent's own forced backend, if any — constrains routing for the whole conversation. */
  agentBackend?: string
  /** The conversation's persisted cli_backend column, if the user previously picked a CLI model. */
  convCliBackend?: string | null
  selectedModel: string
  providerName: ProviderName
}): EffectiveCliBackend {
  const byokKeyForModel = getApiKey(opts.providerName)
  // A model in the OpenRouter cache is BYOK unless the agent explicitly forces a CLI backend —
  // prevents a stale conversation cli_backend value from hijacking a provider chat.
  const selectedModelIsOpenRouter = getOpenRouterModels().includes(opts.selectedModel)

  if (opts.cliBackend === 'codex-cli' && CodexAdapter.isAvailable()) return 'codex-cli'
  if (opts.cliBackend === 'claude-cli' && ClaudeAdapter.isAvailable()) return 'claude-cli'
  if (opts.agentBackend === 'codex-cli' && CodexAdapter.isAvailable()) return 'codex-cli'
  if (opts.agentBackend === 'claude-cli' && ClaudeAdapter.isAvailable()) return 'claude-cli'
  if (!selectedModelIsOpenRouter && opts.convCliBackend === 'codex-cli' && CodexAdapter.isAvailable()) {
    return 'codex-cli'
  }
  if (!selectedModelIsOpenRouter && opts.convCliBackend === 'claude-cli' && ClaudeAdapter.isAvailable()) {
    return 'claude-cli'
  }
  if (retrieveAuthMode() === 'none' && !byokKeyForModel) {
    if (ClaudeAdapter.isAvailable()) return 'claude-cli'
    if (CodexAdapter.isAvailable()) return 'codex-cli'
  }
  return undefined
}
