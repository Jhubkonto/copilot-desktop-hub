import { ClaudeAdapter } from './cli-adapters/claude'
import { CodexAdapter } from './cli-adapters/codex'
import { getCliModels } from './cli-detection'
import { PROVIDERS, isProviderConfigured, getOpenRouterModels, fetchAndCacheOpenRouterModels, retrieveApiKey } from './providers'
import { fetchAndCacheAnthropicModels, getCachedAnthropicModels } from './anthropic-models'
import { safeHandle } from './safe-handle'
import { debugTime, debugTimeEnd } from './debug-mode'
import type { AvailableModelGroup } from '../shared/types'

export function getAvailableModelGroups(): AvailableModelGroup[] {
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

  for (const provider of PROVIDERS) {
    if (!isProviderConfigured(provider.name)) continue
    const rawModels = provider.name === 'openrouter' ? getOpenRouterModels() : provider.models
    const models = rawModels.map((id) => ({
      id: provider.name === 'azure' ? `azure:${id}` : id,
      label: id,
    }))
    if (models.length > 0) {
      groups.push({ sourceKey: provider.name, sourceLabel: provider.label, sourceType: 'provider', models })
    }
  }

  return groups
}

export function registerModelAvailabilityHandlers(): void {
  safeHandle('model:list-available', () => {
    debugTime('model:list-available')
    const r = getAvailableModelGroups()
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
}
