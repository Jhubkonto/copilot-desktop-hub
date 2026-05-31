import https from 'https'
import http from 'http'
import { retrieveToken } from './auth'
import { BrowserWindow } from 'electron'
import { parseSseStream, httpsRequestWithResponse } from './http-client'
import type { ProviderMessage } from './providers'
import type { CatalogModel } from '../shared/types'

interface CopilotToken {
  token: string
  expires_at: number
}

let cachedToken: CopilotToken | null = null
const activeRequests = new Map<string, http.ClientRequest>()
let fallbackRequestCounter = 0

async function httpPostJson(
  url: string,
  headers: Record<string, string>,
  body?: string
): Promise<{ status: number; data: string }> {
  const urlObj = new URL(url)
  return httpsRequestWithResponse(
    {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        ...headers,
        ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {})
      }
    },
    body
  )
}

async function httpGetJson(
  url: string,
  headers: Record<string, string>
): Promise<{ status: number; data: string }> {
  const urlObj = new URL(url)
  return httpsRequestWithResponse({
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers
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
  conversationId?: string,
  maxRetries = 3,
  onModel?: (model: string) => void
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
      const result = await sendCopilotRequest(token, messages, onChunk, model, options, conversationId, onModel)
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
  options: { maxTokens: number; temperature: number },
  conversationId?: string,
  onModel?: (model: string) => void
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
    const requestId = conversationId ?? `__copilot_request__:${fallbackRequestCounter++}`
    const cleanupActiveRequest = (req: http.ClientRequest) => {
      if (activeRequests.get(requestId) === req) {
        activeRequests.delete(requestId)
      }
    }
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
            cleanupActiveRequest(req)
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
        let modelEmitted = false

        parseSseStream(res, (data) => {
          try {
            const parsed = JSON.parse(data)
            if (!modelEmitted && onModel && parsed.model) {
              modelEmitted = true
              onModel(parsed.model)
            }
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) {
              fullContent += delta
              onChunk(delta)
            }
          } catch {
            // Skip malformed chunks
          }
        })
          .then(() => {
            cleanupActiveRequest(req)
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
          .catch((err: Error) => {
            cleanupActiveRequest(req)
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
      cleanupActiveRequest(req)
      reject(createApiError(
        err.message || 'Network error',
        'network',
        undefined,
        true
      ))
    })

    activeRequests.set(requestId, req)
    req.write(body)
    req.end()
  })
}

export async function sendCopilotChatMessage(
  _window: BrowserWindow,
  messages: ProviderMessage[],
  onChunk: (chunk: string) => void,
  model = 'gpt-4o',
  options: { maxTokens?: number; temperature?: number } = {},
  conversationId?: string,
  onModel?: (model: string) => void
): Promise<string> {
  return sendCopilotRequestWithRetry(messages, onChunk, model, {
    maxTokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7
  }, conversationId, 3, onModel)
}

export function abortCopilotStream(conversationId?: string): void {
  if (conversationId) {
    const req = activeRequests.get(conversationId)
    if (req) {
      req.destroy()
      activeRequests.delete(conversationId)
    }
    return
  }

  for (const req of activeRequests.values()) req.destroy()
  activeRequests.clear()
}

export function clearCopilotTokenCache(): void {
  cachedToken = null
}

// ── Non-streaming / tool-call support (used by orchestrator) ─────────────────

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolCallResult {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface CopilotNonStreamResult {
  content: string | null
  toolCalls: ToolCallResult[]
  model?: string
}

/**
 * Single non-streaming round-trip to the Copilot API.
 * Returns the full text content and/or any tool calls from the response.
 */
export async function sendCopilotNonStreaming(
  messages: ProviderMessage[],
  tools: ToolDefinition[] | undefined,
  model: string,
  options: { maxTokens: number; temperature: number },
  toolChoice: 'auto' | 'required' | 'none' = 'auto'
): Promise<CopilotNonStreamResult> {
  const token = await getCopilotToken()

  const bodyPayload: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    temperature: options.temperature
  }
  if (model === 'gpt-5.4') {
    bodyPayload.max_completion_tokens = options.maxTokens
  } else {
    bodyPayload.max_tokens = options.maxTokens
  }
  if (tools && tools.length > 0) {
    bodyPayload.tools = tools
    bodyPayload.tool_choice = toolChoice
  }

  const body = JSON.stringify(bodyPayload)

  const { status, data } = await httpPostJson(
    'https://api.githubcopilot.com/chat/completions',
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'editor-version': 'vscode/1.95.0',
      'editor-plugin-version': 'copilot/1.200.0',
      'User-Agent': 'GithubCopilot/1.200.0',
      Accept: 'application/json'
    },
    body
  )

  if (status >= 400) {
    let message = `Copilot API error (HTTP ${status})`
    try {
      const parsed = JSON.parse(data)
      if (parsed.error?.message) message = parsed.error.message
      else if (parsed.message) message = parsed.message
    } catch { /* use default */ }
    throw createApiError(message, status >= 500 ? 'server' : 'network', status, status >= 500)
  }

  const parsed = JSON.parse(data)
  const message = parsed.choices?.[0]?.message

  const toolCalls: ToolCallResult[] = (message?.tool_calls ?? []).map(
    (tc: { id: string; function: { name: string; arguments: string } }) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: (() => {
        try { return JSON.parse(tc.function.arguments) } catch { return {} }
      })()
    })
  )

  return {
    content: typeof message?.content === 'string' ? message.content : null,
    toolCalls,
    model: typeof parsed.model === 'string' ? parsed.model : undefined
  }
}

export async function fetchModelCatalog(): Promise<CatalogModel[] | null> {
  try {
    const token = await getCopilotToken()
    const { status, data } = await httpGetJson(
      'https://api.githubcopilot.com/models',
      {
        Authorization: `Bearer ${token}`,
        'editor-version': 'vscode/1.95.0',
        'editor-plugin-version': 'copilot/1.200.0',
        'User-Agent': 'GithubCopilot/1.200.0',
        Accept: 'application/json'
      }
    )
    if (status !== 200) return null
    const parsed = JSON.parse(data) as { data?: unknown[] }
    if (!Array.isArray(parsed.data)) return null

    const mapped = parsed.data
      .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
      .filter((entry) => {
        // Skip deprecated models (GPT 3.5 Turbo, legacy GPT 4, etc.)
        if (entry.deprecated === true) return false
        const policy = (entry.policy as Record<string, unknown>) ?? {}
        if (policy.state === 'deprecated') return false

        // Skip non-chat model types (embeddings, trajectory utilities, etc.)
        const caps = (entry.capabilities as Record<string, unknown>) ?? {}
        const modelType = String(caps.type ?? '').toLowerCase()
        if (modelType && modelType !== 'chat') return false

        return true
      })
      .map((entry) => {
        const caps = (entry.capabilities as Record<string, unknown>) ?? {}
        const supports = (caps.supports as Record<string, boolean>) ?? {}
        const limits = (caps.limits as Record<string, number>) ?? {}
        const billing = (entry.billing as Record<string, unknown>) ?? {}
        return {
          id: String(entry.id ?? ''),
          name: String(entry.name ?? entry.id ?? ''),
          vendor: String(entry.vendor ?? ''),
          capabilities: Object.entries(supports)
            .filter(([, value]) => value === true)
            .map(([key]) => key),
          contextWindow: typeof limits.max_context_window_tokens === 'number'
            ? limits.max_context_window_tokens
            : undefined,
          multiplier: typeof billing.multiplier === 'number' && Number.isFinite(billing.multiplier)
            ? billing.multiplier
            : undefined
        } satisfies CatalogModel
      })
      .filter((model) => model.id.length > 0)

    // The API returns versioned variants of the same model (e.g. gpt-4o,
    // gpt-4o-2024-05-13, gpt-4o-2024-08-06). Collapse by display name,
    // keeping the entry with the shortest ID (the canonical base model).
    const byName = new Map<string, CatalogModel>()
    for (const model of mapped) {
      const existing = byName.get(model.name)
      if (!existing || model.id.length < existing.id.length) {
        byName.set(model.name, model)
      }
    }
    return [...byName.values()]
  } catch {
    return null
  }
}
