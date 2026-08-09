import { ClaudeAdapter } from './cli-adapters/claude'
import { CodexAdapter } from './cli-adapters/codex'
import { HermesAdapter } from './cli-adapters/hermes'
import { getCliModels } from './cli-detection'
import {
  PROVIDERS,
  isProviderConfigured,
  getProviderModelIds,
  getOpenRouterModels,
  fetchAndCacheOpenRouterModels,
  fetchAndCacheOpenAIModels,
  fetchAndCacheGeminiModels,
  fetchAndCacheAzureModels,
  getCachedProviderModels,
  getAzureEndpoint,
  retrieveApiKey,
} from './providers'
import { fetchAndCacheAnthropicModels, getCachedAnthropicModels } from './anthropic-models'
import { MODEL_LABELS } from '../shared/models'
import { safeHandle } from './safe-handle'
import { debugTime, debugTimeEnd } from './debug-mode'
import type { AvailableModelGroup } from '../shared/types'

/**
 * @param hermesProfile When the caller is scoped to a specific agent whose backend is Hermes,
 *   its profile name — so the Hermes group reflects that profile's own `config.yaml` model
 *   rather than the default profile's (a localllm-scoped agent otherwise shows the wrong model).
 */
export function getAvailableModelGroups(hermesProfile?: string): AvailableModelGroup[] {
  const groups: AvailableModelGroup[] = []

  if (ClaudeAdapter.isAvailable()) {
    const models = getCliModels('claude-cli')
    if (models.length > 0) {
      groups.push({ sourceKey: 'claude-cli', sourceLabel: 'Claude CLI', sourceType: 'cli', models })
    }
  }

  if (CodexAdapter.isAvailable()) {
    const models = getCliModels('codex-cli')
    if (models.length > 0) {
      groups.push({ sourceKey: 'codex-cli', sourceLabel: 'Codex CLI', sourceType: 'cli', models })
    }
  }

  if (HermesAdapter.isAvailable()) {
    const models = getCliModels('hermes-cli', hermesProfile)
    if (models.length > 0) {
      groups.push({ sourceKey: 'hermes-cli', sourceLabel: 'Hermes Agent', sourceType: 'cli', models })
    }
  }

  for (const provider of PROVIDERS) {
    if (!isProviderConfigured(provider.name)) continue
    const models = getProviderModelIds(provider).map((id) => ({
      id: provider.name === 'azure' ? `azure:${id}` : id,
      label: MODEL_LABELS[id] ?? id,
    }))
    if (models.length > 0) {
      groups.push({ sourceKey: provider.name, sourceLabel: provider.label, sourceType: 'provider', models })
    }
  }

  return groups
}

export function registerModelAvailabilityHandlers(): void {
  safeHandle('model:list-available', (_event, hermesProfile?: string) => {
    debugTime('model:list-available')
    const r = getAvailableModelGroups(hermesProfile)
    debugTimeEnd('model:list-available')
    return r
  })

  // Backfill OpenRouter model cache if key exists but cache is empty (e.g. key was set before cache was introduced)
  if (isProviderConfigured('openrouter') && getOpenRouterModels().length === 0) {
    const key = retrieveApiKey('openrouter')
    if (key) fetchAndCacheOpenRouterModels(key).catch(() => {})
  }

  // Backfill Anthropic model cache if key exists but cache is empty (e.g. key was set before cache was introduced)
  if (isProviderConfigured('anthropic') && getCachedAnthropicModels().length === 0) {
    const key = retrieveApiKey('anthropic')
    if (key) fetchAndCacheAnthropicModels(key).catch(() => {})
  }

  // Backfill OpenAI-compatible provider caches (key set before live fetch existed)
  if (isProviderConfigured('openai') && getCachedProviderModels('openai_models_cache').length === 0) {
    const key = retrieveApiKey('openai')
    if (key) fetchAndCacheOpenAIModels(key).catch(() => {})
  }
  if (isProviderConfigured('gemini') && getCachedProviderModels('gemini_models_cache').length === 0) {
    const key = retrieveApiKey('gemini')
    if (key) fetchAndCacheGeminiModels(key).catch(() => {})
  }
  if (isProviderConfigured('azure') && getCachedProviderModels('azure_models_cache').length === 0) {
    const key = retrieveApiKey('azure')
    const endpoint = getAzureEndpoint()
    if (key && endpoint) fetchAndCacheAzureModels(key, endpoint).catch(() => {})
  }
}
