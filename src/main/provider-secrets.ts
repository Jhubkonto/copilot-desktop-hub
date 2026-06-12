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

export async function fetchAndCacheOpenRouterModels(apiKey: string): Promise<void> {
  try {
    const result = await httpsRequest(
      'https://openrouter.ai/api/v1/models',
      { method: 'GET', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Length': '0' } },
      ''
    )
    if (result.status !== 200) return
    const parsed = JSON.parse(result.data)
    const ids: string[] = (parsed.data ?? []).map((m: { id: string }) => m.id).filter(Boolean)
    const db = getDatabase()
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('openrouter_models_cache', JSON.stringify(ids))
  } catch { /* fail silently — stale cache is acceptable */ }
}

export function getOpenRouterModels(): string[] {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('openrouter_models_cache') as { value: string } | undefined
    if (!row) return []
    return JSON.parse(row.value) as string[]
  } catch { return [] }
}
