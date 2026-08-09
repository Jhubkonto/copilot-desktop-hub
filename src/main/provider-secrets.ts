import { safeStorage } from 'electron'
import { getDatabase } from './database'
import { httpsRequestWithResponse } from './http-client'
import https from 'https'

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

export function storeApiKey(provider: string, key: string): void {
  const db = getDatabase()
  const settingKey = `byok_${provider}_key`
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(key).toString('base64')
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(settingKey, encrypted)
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(`${settingKey}_encrypted`, 'true')
  } else {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(settingKey, key)
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(`${settingKey}_encrypted`, 'false')
  }
}

export function retrieveApiKey(provider: string): string | null {
  const db = getDatabase()
  const settingKey = `byok_${provider}_key`
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey) as { value: string } | undefined
  if (!row) return null

  const encRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(`${settingKey}_encrypted`) as { value: string } | undefined
  if (encRow?.value === 'true' && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(row.value, 'base64'))
  }
  return row.value
}

export function removeApiKey(provider: string): void {
  const db = getDatabase()
  const settingKey = `byok_${provider}_key`
  db.prepare("DELETE FROM settings WHERE key IN (?, ?)").run(settingKey, `${settingKey}_encrypted`)
}

export function getAzureEndpoint(): string | null {
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'byok_azure_endpoint'").get() as { value: string } | undefined
  return row?.value || null
}

export function setAzureEndpoint(endpoint: string): void {
  const db = getDatabase()
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('byok_azure_endpoint', ?)").run(endpoint)
}

/**
 * Generic OpenAI-compatible `/models` fetch-and-cache. Every provider whose API
 * exposes a `{ data: [{ id }] }` listing (OpenAI, OpenRouter, Gemini's OpenAI
 * shim, Azure) funnels through here so the dropdowns stay live instead of frozen
 * to the hand-maintained arrays in provider-registry.ts. `transformId` lets a
 * provider strip API-specific prefixes (e.g. Gemini's `models/` prefix).
 */
async function fetchAndCacheModelsList(
  cacheKey: string,
  url: string,
  headers: Record<string, string>,
  transformId: (id: string) => string = (id) => id,
): Promise<void> {
  try {
    const result = await httpsRequest(url, { method: 'GET', headers: { ...headers, 'Content-Length': '0' } }, '')
    if (result.status !== 200) return
    const parsed = JSON.parse(result.data)
    const ids: string[] = (parsed.data ?? [])
      .map((m: { id: string }) => m.id)
      .filter(Boolean)
      .map(transformId)
    if (ids.length === 0) return
    const db = getDatabase()
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(cacheKey, JSON.stringify(ids))
  } catch { /* fail silently — stale cache is acceptable */ }
}

/** Reads a cached model-id list written by {@link fetchAndCacheModelsList}. */
export function getCachedProviderModels(cacheKey: string): string[] {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(cacheKey) as { value: string } | undefined
    if (!row) return []
    return JSON.parse(row.value) as string[]
  } catch { return [] }
}

export async function fetchAndCacheOpenRouterModels(apiKey: string): Promise<void> {
  await fetchAndCacheModelsList('openrouter_models_cache', 'https://openrouter.ai/api/v1/models', {
    Authorization: `Bearer ${apiKey}`,
  })
}

export function getOpenRouterModels(): string[] {
  return getCachedProviderModels('openrouter_models_cache')
}

export async function fetchAndCacheOpenAIModels(apiKey: string): Promise<void> {
  await fetchAndCacheModelsList('openai_models_cache', 'https://api.openai.com/v1/models', {
    Authorization: `Bearer ${apiKey}`,
  })
}

export async function fetchAndCacheGeminiModels(apiKey: string): Promise<void> {
  await fetchAndCacheModelsList(
    'gemini_models_cache',
    'https://generativelanguage.googleapis.com/v1beta/openai/models',
    { Authorization: `Bearer ${apiKey}` },
    // Gemini's OpenAI shim returns ids like "models/gemini-2.5-pro"; strip the prefix
    // so they match the registry IDs and route correctly.
    (id) => id.replace(/^models\//, ''),
  )
}

export async function fetchAndCacheAzureModels(apiKey: string, endpoint: string): Promise<void> {
  await fetchAndCacheModelsList(
    'azure_models_cache',
    `${endpoint.replace(/\/$/, '')}/openai/models?api-version=2024-02-01`,
    { 'api-key': apiKey },
  )
}
