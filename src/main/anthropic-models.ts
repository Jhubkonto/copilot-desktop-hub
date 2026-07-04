import { getDatabase } from './database'
import { httpsRequestWithResponse } from './http-client'
import { MODEL_LABELS } from '../shared/models'

const CACHE_KEY = 'anthropic_models_cache'

export type CliModelOption = { id: string; label: string }

export async function fetchAndCacheAnthropicModels(apiKey: string): Promise<void> {
  try {
    const result = await httpsRequestWithResponse(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/models',
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': '0',
        },
      },
      ''
    )
    if (result.status !== 200) return
    const parsed = JSON.parse(result.data)
    const ids: string[] = (parsed.data ?? []).map((m: { id: string }) => m.id).filter(Boolean)
    const db = getDatabase()
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(CACHE_KEY, JSON.stringify(ids))
  } catch { /* fail silently — stale cache is acceptable */ }
}

export function getCachedAnthropicModels(): CliModelOption[] {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(CACHE_KEY) as { value: string } | undefined
    if (!row) return []
    const ids = JSON.parse(row.value) as string[]
    return ids.map((id) => ({ id, label: MODEL_LABELS[id] ?? id }))
  } catch { return [] }
}
