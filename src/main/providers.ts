import { safeStorage } from 'electron'
import { getDatabase } from './database'
import https from 'https'
import { safeHandle } from './safe-handle'
import http from 'http'

export type ProviderName = 'copilot' | 'openai' | 'anthropic' | 'azure'

// Track active streaming request so it can be aborted
let activeStreamingRequest: http.ClientRequest | null = null

export function abortActiveStream(): void {
  if (activeStreamingRequest) {
    activeStreamingRequest.destroy()
    activeStreamingRequest = null
  }
}

interface ProviderConfig {
  name: ProviderName
  label: string
  apiKeySettingKey: string
  models: string[]
}

export const PROVIDERS: ProviderConfig[] = [
  {
    name: 'copilot',
    label: 'GitHub Copilot',
    apiKeySettingKey: '',
    models: ['default']
  },
  {
    name: 'openai',
    label: 'OpenAI',
    apiKeySettingKey: 'byok_openai_key',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-preview', 'o1-mini']
  },
  {
    name: 'anthropic',
    label: 'Anthropic',
    apiKeySettingKey: 'byok_anthropic_key',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229']
  },
  {
    name: 'azure',
    label: 'Azure OpenAI',
    apiKeySettingKey: 'byok_azure_key',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']
  }
]

function storeApiKey(provider: string, key: string): void {
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

function retrieveApiKey(provider: string): string | null {
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

function removeApiKey(provider: string): void {
  const db = getDatabase()
  const settingKey = `byok_${provider}_key`
  db.prepare("DELETE FROM settings WHERE key IN (?, ?)").run(settingKey, `${settingKey}_encrypted`)
}

function httpsRequest(
  url: string,
  options: https.RequestOptions,
  body: string
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        ...options
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve({ status: res.statusCode || 0, data }))
      }
    )
    req.setTimeout(30000, () => {
      req.destroy(new Error('Request timed out'))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

export async function sendOpenAIMessage(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  onChunk: (chunk: string) => void
): Promise<string> {
  const body = JSON.stringify({
    model,
    messages,
    stream: true,
    max_tokens: 4096
  })

  return new Promise((resolve, reject) => {
    const urlObj = new URL('https://api.openai.com/v1/chat/completions')
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let fullContent = ''
        let buffer = ''

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data: ')) continue
            const data = trimmed.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              const delta = parsed.choices?.[0]?.delta?.content
              if (delta) {
                fullContent += delta
                onChunk(delta)
              }
            } catch {
              // Skip malformed chunks
            }
          }
        })

        res.on('end', () => {
          activeStreamingRequest = null
          resolve(fullContent)
        })

        res.on('error', (err) => {
          activeStreamingRequest = null
          reject(err)
        })
      }
    )
    req.on('error', (err) => {
      activeStreamingRequest = null
      reject(err)
    })
    activeStreamingRequest = req
    req.write(body)
    req.end()
  })
}

export async function sendAnthropicMessage(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  systemPrompt: string | undefined,
  onChunk: (chunk: string) => void
): Promise<string> {
  const body = JSON.stringify({
    model,
    max_tokens: 4096,
    stream: true,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: messages.filter((m) => m.role !== 'system')
  })

  return new Promise((resolve, reject) => {
    const urlObj = new URL('https://api.anthropic.com/v1/messages')
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let fullContent = ''
        let buffer = ''

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data: ')) continue
            const data = trimmed.slice(6)

            try {
              const parsed = JSON.parse(data)
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                fullContent += parsed.delta.text
                onChunk(parsed.delta.text)
              }
            } catch {
              // Skip malformed chunks
            }
          }
        })

        res.on('end', () => {
          activeStreamingRequest = null
          resolve(fullContent)
        })

        res.on('error', (err) => {
          activeStreamingRequest = null
          reject(err)
        })
      }
    )
    req.on('error', (err) => {
      activeStreamingRequest = null
      reject(err)
    })
    activeStreamingRequest = req
    req.write(body)
    req.end()
  })
}

export async function sendAzureMessage(
  apiKey: string,
  endpoint: string,
  deployment: string,
  messages: { role: string; content: string }[],
  onChunk: (chunk: string) => void
): Promise<string> {
  const apiVersion = '2024-02-01'
  const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`
  const body = JSON.stringify({
    messages,
    stream: true,
    max_tokens: 4096
  })

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey,
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let fullContent = ''
        let buffer = ''

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data: ')) continue
            const data = trimmed.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              const delta = parsed.choices?.[0]?.delta?.content
              if (delta) {
                fullContent += delta
                onChunk(delta)
              }
            } catch {
              // Skip malformed chunks
            }
          }
        })

        res.on('end', () => {
          activeStreamingRequest = null
          resolve(fullContent)
        })
        res.on('error', (err) => {
          activeStreamingRequest = null
          reject(err)
        })
      }
    )
    req.on('error', (err) => {
      activeStreamingRequest = null
      reject(err)
    })
    activeStreamingRequest = req
    req.write(body)
    req.end()
  })
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

export function getProviderForAgent(agentModel: string): { provider: ProviderName; model: string } {
  // Check if the model string includes a provider prefix (e.g. "azure:gpt-4o")
  if (agentModel.includes(':')) {
    const [prefix, model] = agentModel.split(':', 2)
    const provider = PROVIDERS.find((p) => p.name === prefix)
    if (provider) return { provider: provider.name, model }
  }

  for (const p of PROVIDERS) {
    if (p.name === 'copilot') continue
    for (const m of p.models) {
      if (agentModel === m) {
        return { provider: p.name, model: m }
      }
    }
  }
  return { provider: 'copilot', model: agentModel || 'default' }
}

export function isProviderConfigured(provider: ProviderName): boolean {
  if (provider === 'copilot') return true
  return !!retrieveApiKey(provider)
}

export function getApiKey(provider: ProviderName): string | null {
  if (provider === 'copilot') return null
  return retrieveApiKey(provider)
}

export function registerProviderHandlers(): void {
  safeHandle('provider:list', () => {
    return PROVIDERS.map((p) => ({
      ...p,
      configured: p.name === 'copilot' || !!retrieveApiKey(p.name)
    }))
  })

  safeHandle('provider:set-key', (_event, provider: string, key: string) => {
    storeApiKey(provider, key)
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
    try {
      if (provider === 'openai') {
        const result = await httpsRequest(
          'https://api.openai.com/v1/models',
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Length': '0'
            }
          },
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
          {
            method: 'GET',
            headers: { 'api-key': key, 'Content-Length': '0' }
          },
          ''
        )
        return { valid: result.status === 200 }
      }
      return { valid: false, error: 'Unknown provider' }
    } catch (error) {
      return { valid: false, error: (error as Error).message }
    }
  })

  safeHandle('provider:get-azure-endpoint', () => {
    return getAzureEndpoint()
  })

  safeHandle('provider:set-azure-endpoint', (_event, endpoint: string) => {
    setAzureEndpoint(endpoint)
    return true
  })
}
