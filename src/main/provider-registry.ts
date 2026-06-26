import type { ProviderName } from './provider-core-types'
import { getOpenRouterModels, retrieveApiKey } from './provider-secrets'

export const DEFAULT_PROVIDER_MODEL = 'gpt-5-mini'

interface ProviderConfig {
  name: ProviderName
  label: string
  apiKeySettingKey: string
  models: string[]
  baseUrl?: string
}

export const PROVIDERS: ProviderConfig[] = [
  {
    name: 'openai',
    label: 'OpenAI',
    apiKeySettingKey: 'byok_openai_key',
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-preview', 'o1-mini']
  },
  {
    name: 'anthropic',
    label: 'Anthropic',
    apiKeySettingKey: 'byok_anthropic_key',
    models: ['claude-opus-4.8', 'claude-opus-4.7', 'claude-opus-4.6', 'claude-opus-4.5', 'claude-sonnet-4.6', 'claude-sonnet-4.5', 'claude-sonnet-4', 'claude-haiku-4.5', 'claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229']
  },
  {
    name: 'azure',
    label: 'Azure OpenAI',
    apiKeySettingKey: 'byok_azure_key',
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']
  },
  {
    name: 'gemini',
    label: 'Google Gemini',
    apiKeySettingKey: 'byok_gemini_key',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash']
  },
  {
    name: 'mistral',
    label: 'Mistral',
    apiKeySettingKey: 'byok_mistral_key',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest', 'open-mistral-7b']
  },
  {
    name: 'groq',
    label: 'Groq',
    apiKeySettingKey: 'byok_groq_key',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it']
  },
  {
    name: 'xai',
    label: 'xAI (Grok)',
    apiKeySettingKey: 'byok_xai_key',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-3', 'grok-3-mini', 'grok-2-1212']
  },
  {
    name: 'openrouter',
    label: 'OpenRouter',
    apiKeySettingKey: 'byok_openrouter_key',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: []
  }
]

const MODEL_TO_PROVIDER = new Map<string, ProviderName>(
  PROVIDERS.flatMap((p) => p.models.map((m) => [m, p.name] as [string, ProviderName]))
)

export function getProviderForAgent(agentModel: string): { provider: ProviderName; model: string } {
  const normalizedModel = !agentModel || agentModel === 'default' ? DEFAULT_PROVIDER_MODEL : agentModel

  if (normalizedModel.includes(':')) {
    const [prefix, model] = normalizedModel.split(':', 2)
    const provider = PROVIDERS.find((p) => p.name === prefix)
    if (provider) return { provider: provider.name, model }
  }

  const staticProvider = MODEL_TO_PROVIDER.get(normalizedModel)
  if (staticProvider) return { provider: staticProvider, model: normalizedModel }

  const orModels = getOpenRouterModels()
  if (orModels.includes(normalizedModel)) {
    return { provider: 'openrouter', model: normalizedModel }
  }

  if (normalizedModel.startsWith('claude')) {
    return { provider: 'anthropic', model: normalizedModel }
  }

  return { provider: 'openai', model: normalizedModel }
}

export function isProviderConfigured(provider: ProviderName): boolean {
  return !!retrieveApiKey(provider)
}
