import https from 'https'
import http from 'http'
import { retrieveToken } from './auth'
import { BrowserWindow } from 'electron'
import type { ProviderMessage } from './providers'

interface CopilotToken {
  token: string
  expires_at: number
}

let cachedToken: CopilotToken | null = null
let activeRequest: http.ClientRequest | null = null

function httpPostJson(
  url: string,
  headers: Record<string, string>,
  body?: string
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          ...headers,
          ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {})
        }
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve({ status: res.statusCode || 0, data }))
      }
    )
    req.setTimeout(30000, () => req.destroy(new Error('Request timed out')))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function httpGetJson(
  url: string,
  headers: Record<string, string>
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'GET',
        headers
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve({ status: res.statusCode || 0, data }))
      }
    )
    req.setTimeout(30000, () => req.destroy(new Error('Request timed out')))
    req.on('error', reject)
    req.end()
  })
}

async function exchangeToken(githubToken: string): Promise<CopilotToken> {
  const { status, data } = await httpGetJson(
    'https://api.github.com/copilot_internal/v2/token',
    {
      Authorization: `token ${githubToken}`,
      'editor-version': 'vscode/1.95.0',
      'editor-plugin-version': 'copilot/1.200.0',
      'User-Agent': 'GithubCopilot/1.200.0',
      Accept: 'application/json'
    }
  )

  if (status !== 200) {
    let message = `Token exchange failed (HTTP ${status})`
    try {
      const parsed = JSON.parse(data)
      if (parsed.message) message = parsed.message
    } catch { /* use default message */ }
    console.error('[copilot-api] Token exchange error:', status, data)
    throw new Error(message)
  }

  const parsed = JSON.parse(data)
  if (!parsed.token) {
    throw new Error('No token in Copilot response — do you have an active Copilot subscription?')
  }

  return {
    token: parsed.token,
    expires_at: parsed.expires_at
  }
}

export async function getCopilotToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && cachedToken.expires_at > Date.now() / 1000 + 60) {
    return cachedToken.token
  }

  const githubToken = retrieveToken()
  if (!githubToken) {
    throw new Error('Not authenticated — sign in with GitHub first')
  }

  cachedToken = await exchangeToken(githubToken)
  return cachedToken.token
}

export interface CopilotApiError extends Error {
  errorType: 'auth' | 'rate_limit' | 'server' | 'network' | 'empty_response' | 'model_not_available'
  statusCode?: number
  retryable: boolean
  retryAfterSeconds?: number
}

function createApiError(
  message: string,
  errorType: CopilotApiError['errorType'],
  statusCode?: number,
  retryable = false,
  retryAfterSeconds?: number
): CopilotApiError {
  const err = new Error(message) as CopilotApiError
  err.errorType = errorType
  err.statusCode = statusCode
  err.retryable = retryable
  err.retryAfterSeconds = retryAfterSeconds
  return err
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sendCopilotRequestWithRetry(
  messages: ProviderMessage[],
  onChunk: (chunk: string) => void,
  model: string,
  options: { maxTokens: number; temperature: number },
  maxRetries = 3
): Promise<string> {
  let lastError: CopilotApiError | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 16000)
      console.log(`[copilot-api] Retry ${attempt}/${maxRetries} after ${backoffMs}ms`)
      await delay(backoffMs)
    }

    try {
      const token = await getCopilotToken()
      const result = await sendCopilotRequest(token, messages, onChunk, model, options)
      return result
    } catch (err) {
      const apiErr = err as CopilotApiError
      lastError = apiErr

      if (!apiErr.retryable || attempt === maxRetries) {
        throw apiErr
      }
      console.log(`[copilot-api] Retryable error (${apiErr.errorType}): ${apiErr.message}`)
    }
  }

  throw lastError!
}

function sendCopilotRequest(
  token: string,
  messages: ProviderMessage[],
  onChunk: (chunk: string) => void,
  model: string,
  options: { maxTokens: number; temperature: number }
): Promise<string> {
  const bodyPayload: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    temperature: options.temperature
  }
  if (model === 'gpt-5.4') {
    bodyPayload.max_completion_tokens = options.maxTokens
  } else {
    bodyPayload.max_tokens = options.maxTokens
  }
  const body = JSON.stringify(bodyPayload)

  return new Promise((resolve, reject) => {
    const urlObj = new URL('https://api.githubcopilot.com/chat/completions')
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'editor-version': 'vscode/1.95.0',
          'editor-plugin-version': 'copilot/1.200.0',
          'User-Agent': 'GithubCopilot/1.200.0',
          'Content-Length': String(Buffer.byteLength(body)),
          Accept: 'text/event-stream'
        }
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errData = ''
          res.on('data', (chunk) => (errData += chunk))
          res.on('end', () => {
            activeRequest = null
            let message = `Copilot API error (HTTP ${res.statusCode})`
            try {
              const parsed = JSON.parse(errData)
              if (parsed.error?.message) message = parsed.error.message
              else if (parsed.message) message = parsed.message
            } catch { /* use default */ }

            if (res.statusCode === 401 || res.statusCode === 403) {
              cachedToken = null
              reject(createApiError(message, 'auth', res.statusCode, false))
            } else if (res.statusCode === 404) {
              reject(createApiError(message, 'model_not_available', res.statusCode, false))
            } else if (res.statusCode === 429) {
              const retryAfterHeader = res.headers['retry-after']
              const retryAfterSeconds = Array.isArray(retryAfterHeader)
                ? Number.parseInt(retryAfterHeader[0] ?? '', 10)
                : Number.parseInt(retryAfterHeader ?? '', 10)
              reject(createApiError(
                message,
                'rate_limit',
                res.statusCode,
                true,
                Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined
              ))
            } else if (res.statusCode! >= 500) {
              reject(createApiError(message, 'server', res.statusCode, true))
            } else {
              reject(createApiError(message, 'network', res.statusCode, false))
            }
          })
          return
        }

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
          activeRequest = null
          if (!fullContent) {
            reject(createApiError(
              'Empty response from Copilot API',
              'empty_response',
              res.statusCode ?? undefined,
              true
            ))
            return
          }
          resolve(fullContent)
        })

        res.on('error', (err) => {
          activeRequest = null
          reject(createApiError(
            err.message || 'Network error',
            'network',
            undefined,
            true
          ))
        })
      }
    )

    req.on('error', (err) => {
      activeRequest = null
      reject(createApiError(
        err.message || 'Network error',
        'network',
        undefined,
        true
      ))
    })

    activeRequest = req
    req.write(body)
    req.end()
  })
}

export async function sendCopilotChatMessage(
  _window: BrowserWindow,
  messages: ProviderMessage[],
  onChunk: (chunk: string) => void,
  model = 'gpt-4o',
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  return sendCopilotRequestWithRetry(messages, onChunk, model, {
    maxTokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7
  })
}

export function abortCopilotStream(): void {
  if (activeRequest) {
    activeRequest.destroy()
    activeRequest = null
  }
}

export function clearCopilotTokenCache(): void {
  cachedToken = null
}
