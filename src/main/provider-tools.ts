import type { ProviderNonStreamResult, ToolChoice, ToolDefinition } from './provider-types'
import type { ProviderName } from './provider-core-types'
import type { ProviderMessage } from './provider-core-types'
import { getAzureEndpoint } from './provider-secrets'
import { sendAnthropicWithTools } from './providers/anthropic-provider'
import { sendOpenAIWithTools, sendOpenAINonStreaming, sendAzureNonStreaming } from './providers/openai-provider'

export const NO_PROVIDER_CONFIGURED_MESSAGE = 'No provider configured. Add an API key in Settings.'

/**
 * Provider-agnostic non-streaming completion with tool calling support.
 * Routes to the appropriate backend. Throws for Azure (not yet supported as orchestration leader).
 */
export async function sendProviderWithTools(
  provider: ProviderName,
  apiKey: string | null,
  model: string,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<ProviderNonStreamResult> {
  if (!apiKey) {
    throw new Error(NO_PROVIDER_CONFIGURED_MESSAGE)
  }
  if (provider === 'anthropic') {
    return sendAnthropicWithTools(apiKey, model, messages, tools, toolChoice, options)
  }
  if (provider === 'openai') {
    return sendOpenAIWithTools(apiKey, model, messages, tools, toolChoice, options)
  }
  throw new Error(
    'Azure OpenAI does not support the multi-agent orchestration leader role. ' +
    'Please select an OpenAI or Anthropic model as the team leader.'
  )
}

/**
 * Provider-agnostic non-streaming completion. Routes to the correct backend based on provider.
 */
export async function sendProviderNonStreaming(
  provider: ProviderName,
  apiKey: string | null,
  model: string,
  messages: ProviderMessage[],
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<ProviderNonStreamResult> {
  if (!apiKey) {
    throw new Error(NO_PROVIDER_CONFIGURED_MESSAGE)
  }
  if (provider === 'anthropic') {
    return sendAnthropicWithTools(apiKey, model, messages, [], 'none', options)
  }
  if (provider === 'openai') {
    return sendOpenAINonStreaming(apiKey, model, messages, options)
  }
  const endpoint = getAzureEndpoint()
  if (!endpoint) {
    throw new Error('Azure endpoint not configured')
  }
  return sendAzureNonStreaming(apiKey, endpoint, model, messages, options)
}
