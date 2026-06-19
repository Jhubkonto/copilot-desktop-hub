import https from 'https'
import { safeHandle } from './safe-handle'
import { httpsRequestWithResponse } from './http-client'
import {
  storeApiKey,
  removeApiKey,
  retrieveApiKey,
  fetchAndCacheOpenRouterModels,
  getAzureEndpoint,
  setAzureEndpoint,
} from './provider-secrets'
import { PROVIDERS, getProviderForAgent, isProviderConfigured, DEFAULT_PROVIDER_MODEL } from './provider-registry'
import { abortActiveStream, activeStreamingRequests } from './provider-stream-state'

// ---- public types (re-exported from core-types for consumers that import from 'providers') ----
export type {
  ProviderName,
  MessageContentPart,
  MessageContent,
  ToolCallMessage,
  ProviderMessage,
} from './provider-core-types'

export const NO_PROVIDER_CONFIGURED_MESSAGE = 'No provider configured. Add an API key in Settings.'

// ---- re-exports ----
export {
  DEFAULT_PROVIDER_MODEL,
  PROVIDERS,
  getProviderForAgent,
  isProviderConfigured,
  abortActiveStream,
  activeStreamingRequests,
  retrieveApiKey,
  getAzureEndpoint,
  setAzureEndpoint,
  fetchAndCacheOpenRouterModels,
}
export { getOpenRouterModels } from './provider-secrets'
export { toAnthropicMessages, toOpenAICompatibleMessages } from './provider-messages'
export { toAnthropicTools } from './providers/anthropic-provider'
export {
  sendOpenAIMessage,
  sendOpenAINonStreaming,
  sendOpenAIWithTools,
  sendAzureMessage,
  sendAzureNonStreaming,
  sendAzureWithTools,
} from './providers/openai-provider'
export { sendAnthropicMessage, sendAnthropicWithTools } from './providers/anthropic-provider'
export { sendProviderWithTools, sendProviderNonStreaming } from './provider-tools'

import type { ProviderName } from './provider-core-types'
export function getApiKey(provider: ProviderName): string | null {
  return retrieveApiKey(provider)
}

// ---- IPC handlers ----
function httpsRequest(
  url: string,
  options: https.RequestOptions,
  body: string
): Promise<{ status: number; data: string }> {
  const urlObj = new URL(url)
  return httpsRequestWithResponse(
    { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, ...options },
    body
  )
}

export function registerProviderHandlers(): void {
  safeHandle('provider:list', () => {
    return PROVIDERS.map((p) => ({
      ...p,
      configured: !!retrieveApiKey(p.name)
    }))
  })

  safeHandle('provider:set-key', async (_event, provider: string, key: string) => {
    storeApiKey(provider, key)
    if (provider === 'openrouter') {
      await fetchAndCacheOpenRouterModels(key)
    }
    return true
  })

  safeHandle('provider:remove-key', (_event, provider: string) => {
    removeApiKey(provider)
    return true
  })

  safeHandle('provider:has-key', (_event, provider: string) => {
    return !!retrieveApiKey(provider)
  })

  safeHandle('provider:test-key', async (_event, provider: string, key: string, endpoint?: string) => {
    return testProviderKey(provider, key, endpoint)
  })

  safeHandle('provider:get-azure-endpoint', () => {
    return getAzureEndpoint()
  })

  safeHandle('provider:set-azure-endpoint', (_event, endpoint: string) => {
    setAzureEndpoint(endpoint)
    return true
  })
}

export async function testProviderKey(provider: string, key: string, endpoint?: string): Promise<{ valid: boolean; error?: string }> {
  try {
      if (provider === 'openai') {
        const result = await httpsRequest(
          'https://api.openai.com/v1/models',
          { method: 'GET', headers: { Authorization: `Bearer ${key}`, 'Content-Length': '0' } },
          ''
        )
        return { valid: result.status === 200 }
      } else if (provider === 'anthropic') {
        const result = await httpsRequest(
          'https://api.anthropic.com/v1/messages',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': key,
              'anthropic-version': '2023-06-01'
            }
          },
          JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }]
          })
        )
        return { valid: result.status !== 401 }
      } else if (provider === 'azure') {
        if (!endpoint) return { valid: false, error: 'Azure endpoint is required' }
        const testUrl = `${endpoint.replace(/\/$/, '')}/openai/models?api-version=2024-02-01`
        const result = await httpsRequest(
          testUrl,
          { method: 'GET', headers: { 'api-key': key, 'Content-Length': '0' } },
          ''
        )
        return { valid: result.status === 200 }
      }
      const providerCfg = PROVIDERS.find((p) => p.name === provider)
      if (providerCfg?.baseUrl) {
        const result = await httpsRequest(
          `${providerCfg.baseUrl}/models`,
          { method: 'GET', headers: { Authorization: `Bearer ${key}`, 'Content-Length': '0' } },
          ''
        )
        if (result.status === 200 && provider === 'openrouter') {
          await fetchAndCacheOpenRouterModels(key)
        }
        return { valid: result.status === 200 }
      }
      return { valid: false, error: 'Unknown provider' }
    } catch (error) {
      return { valid: false, error: (error as Error).message }
    }
}
