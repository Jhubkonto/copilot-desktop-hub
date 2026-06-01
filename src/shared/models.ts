import type { CatalogModel } from './types'

const MODEL_LABELS: Record<string, string> = {
  'gpt-5.5':           'GPT-5.5',
  'gpt-5.4':           'GPT-5.4',
  'gpt-5.3-codex':     'GPT-5.3-Codex',
  'gpt-5.2-codex':     'GPT-5.2-Codex',
  'gpt-5.2':           'GPT-5.2',
  'gpt-5-mini':        'GPT-5 mini',
  'gpt-4.1':           'GPT-4.1',
  'claude-opus-4.8':   'Claude Opus 4.8',
  'claude-opus-4.7':   'Claude Opus 4.7',
  'claude-opus-4.6':   'Claude Opus 4.6',
  'claude-opus-4.5':   'Claude Opus 4.5',
  'claude-sonnet-4.6': 'Claude Sonnet 4.6',
  'claude-sonnet-4.5': 'Claude Sonnet 4.5',
  'claude-sonnet-4':   'Claude Sonnet 4',
  'claude-haiku-4.5':  'Claude Haiku 4.5',
}

// Multipliers keyed by model ID — sourced from GitHub Copilot billing docs.
const MODEL_MULTIPLIERS: Record<string, number> = {
  'gpt-5.5':           57,
  'gpt-5.4':            6,
  'gpt-5.4-mini':       6,
  'gpt-5.3-codex':      6,
  'gpt-5.2-codex':      3,
  'gpt-5.2':            3,
  'gpt-5.1':            3,
  'gpt-5.1-codex':      3,
  'gpt-5.1-codex-mini': 0.33,
  'gpt-5.1-codex-max':  3,
  'gpt-5-mini':         0.33,
  'gpt-4.1':            1,
  'gpt-4o':             0.33,
  'gpt-4o-mini':        0.33,
  'claude-opus-4.8':   27,
  'claude-opus-4.7':   27,
  'claude-opus-4.6':   27,
  'claude-opus-4.5':   15,
  'claude-sonnet-4.6':  9,
  'claude-sonnet-4.5':  6,
  'claude-sonnet-4':    6,
  'claude-haiku-4.5':   0.33,
}

// Fallback multipliers keyed by display name for models whose API IDs are not
// known in advance (e.g. Gemini models). The API may not return billing data
// for all models, so this covers the gap.
const MODEL_MULTIPLIERS_BY_NAME: Record<string, number> = {
  'Gemini 2.5 Pro':            1,
  'Gemini 3 Flash':            0.33,
  'Gemini 3 Flash (Preview)':  0.33,
  'Gemini 3 Pro':              6,
  'Gemini 3.1 Pro':            6,
  'Gemini 3.5 Flash':          14,
  'GPT-4o':                    0.33,
  'GPT-4o mini':               0.33,
  'Raptor mini':               0.33,
  'Raptor mini (Preview)':     0.33,
}

export function getModelLabel(model: string | null | undefined, catalog?: CatalogModel[], globalDefaultModel?: string): string {
  if (!model || model === 'default') {
    if (globalDefaultModel && globalDefaultModel !== 'default') {
      return `Global default (${getModelLabel(globalDefaultModel, catalog)})`
    }
    return 'Global default'
  }
  if (catalog?.length) {
    const entry = catalog.find((item) => item.id === model)
    if (entry) return entry.name
  }
  return MODEL_LABELS[model] ?? model
}

export function getModelMultiplier(model: string | null | undefined, catalog?: CatalogModel[]): string | null {
  if (!model || model === 'default') return null

  // 1. Prefer live value from API catalog
  if (catalog?.length) {
    const entry = catalog.find((item) => item.id === model)
    if (entry?.multiplier !== undefined) return formatMultiplier(entry.multiplier)

    // 2. Name-based fallback for models the API doesn't include billing data for
    if (entry) {
      const byName = MODEL_MULTIPLIERS_BY_NAME[entry.name]
      if (byName !== undefined) return formatMultiplier(byName)
    }
  }

  // 3. Static ID-based map
  const byId = MODEL_MULTIPLIERS[model]
  if (byId !== undefined) return formatMultiplier(byId)

  return null
}

function formatMultiplier(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return `${rounded}x`
}

/**
 * Returns true if this model supports tool calling.
 * Models with an empty capabilities array are treated as tool-capable
 * (optimistic fallback for static/cached entries that predate capability data).
 */
export function modelSupportsTools(model: CatalogModel): boolean {
  return model.capabilities.length === 0 || model.capabilities.includes('tool_calls')
}

/**
 * Returns true if the given model ID supports tool calling.
 * Unknown or 'default' model IDs are treated as tool-capable (optimistic).
 */
export function modelIdSupportsTools(modelId: string | null | undefined, catalog?: CatalogModel[]): boolean {
  if (!modelId || modelId === 'default') return true
  const entry = catalog?.find((m) => m.id === modelId)
  if (!entry) return true // unknown model → optimistic
  return modelSupportsTools(entry)
}

export function getAvailableModelIds(
  catalog?: CatalogModel[],
  currentModel?: string | null,
  requiresTools?: boolean,
): string[] {
  const filtered = requiresTools
    ? (catalog ?? []).filter(modelSupportsTools)
    : (catalog ?? [])

  const ids: string[] = filtered.length > 0 || catalog?.length
    ? ['default', ...filtered.map((model) => model.id)]
    : ['default']

  const seen = new Set(ids)

  // Always include the current selection even if it doesn't support tools so
  // the active model isn't silently hidden; callers should auto-fallback
  // separately when the model is incompatible.
  if (currentModel && currentModel !== 'default' && !seen.has(currentModel)) {
    ids.push(currentModel)
  }

  return ids
}
