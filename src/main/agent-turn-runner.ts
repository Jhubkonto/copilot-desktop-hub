import { getAgentConfig } from './agents'
import {
  NO_PROVIDER_CONFIGURED_MESSAGE,
  PROVIDERS,
  getProviderForAgent,
  getApiKey,
  getAzureEndpoint,
  sendOpenAIMessage,
  sendAnthropicMessage,
  sendAzureMessage,
} from './providers'
import type { ProviderMessage } from './provider-core-types'

export interface AgentTurnOptions {
  /** Omit for a bare-model turn — no agent config is resolved, so no skills apply either
   *  (skill access is strictly agent-gated; there is no "skills for a bare model" mode). */
  agentId?: string
  fallbackModel: string
  taskContent: string
  /** Used as the provider-request conversation id — must be unique per call. */
  requestId: string
  generationOptions: { temperature: number; maxTokens: number }
  onChunk: (chunk: string) => void
  /** Overrides the agent's configured system prompt entirely, if set. */
  systemPromptOverride?: string
}

/**
 * Sends a single bounded turn to a specific agent using its configured provider, with one retry
 * if no output was emitted on the first attempt (avoids duplicating partial streamed output).
 * Extracted from orchestrator.ts's callSpecialist so both the multi-agent orchestrator and the
 * automated workflow executor share one "call an agent, get its full response" primitive rather
 * than each re-implementing provider dispatch + retry-on-empty-stream separately.
 */
export async function runAgentTurn(opts: AgentTurnOptions): Promise<string> {
  const { agentId, fallbackModel, taskContent, requestId, generationOptions, onChunk, systemPromptOverride } = opts

  // No agentId → bare-model turn: skip agent/skill config resolution entirely rather than
  // passing a sentinel through getAgentConfig. cfg stays null, and the fallbacks below already
  // handle a null cfg gracefully (they were written for "agent config unavailable", which this
  // now legitimately is, not just a defensive fallback for the impossible case).
  const cfg = agentId ? getAgentConfig(agentId) : null
  const agentModel = typeof cfg?.model === 'string' && cfg.model !== 'default' ? cfg.model : fallbackModel
  const { provider, model } = getProviderForAgent(agentModel)
  const apiKey = getApiKey(provider)
  if (!apiKey) {
    throw new Error(NO_PROVIDER_CONFIGURED_MESSAGE)
  }

  const systemContent = systemPromptOverride ?? (typeof cfg?.systemPrompt === 'string'
    ? `${cfg.systemPrompt}\n\nYou are a specialist in the team. Answer concisely and factually.`
    : 'You are a specialist AI assistant. Answer concisely and factually.')

  const messages: ProviderMessage[] = [
    { role: 'system', content: systemContent },
    { role: 'user', content: taskContent },
  ]

  let chunksEmitted = 0
  const wrappedOnChunk = (chunk: string) => {
    chunksEmitted++
    onChunk(chunk)
  }

  const attempt = (): Promise<string> => {
    if (provider === 'openai') {
      return sendOpenAIMessage(requestId, apiKey, model, messages, wrappedOnChunk, generationOptions)
    }
    if (provider === 'anthropic') {
      return sendAnthropicMessage(requestId, apiKey, model, messages.filter((m) => m.role !== 'system'), systemContent, wrappedOnChunk, generationOptions)
    }
    const providerCfg = PROVIDERS.find((p) => p.name === provider)
    if (providerCfg?.baseUrl) {
      return sendOpenAIMessage(requestId, apiKey, model, messages, wrappedOnChunk, generationOptions, providerCfg.baseUrl)
    }
    const endpoint = getAzureEndpoint()
    if (!endpoint) {
      throw new Error('Azure endpoint not configured')
    }
    return sendAzureMessage(requestId, apiKey, endpoint, model, messages, wrappedOnChunk, generationOptions)
  }

  try {
    return await attempt()
  } catch (firstError) {
    if (chunksEmitted === 0) {
      return attempt()
    }
    throw firstError
  }
}
