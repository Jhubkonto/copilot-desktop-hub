import https from 'https'
import http from 'http'
import { parseSseStream, httpsRequestWithResponse } from '../http-client'
import type { ProviderNonStreamResult, ToolCallResult, ToolChoice, ToolDefinition } from '../provider-types'
import type { ProviderMessage } from '../provider-core-types'
import { activeStreamingRequests, incrementFallbackCounter } from '../provider-stream-state'
import { toOpenAICompatibleMessages } from '../provider-messages'
import { debugLog } from '../debug-mode'

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

// Returns true for OpenAI o-series and compatible reasoning models.
function supportsReasoningEffort(model: string): boolean {
  return /^o\d|\/o\d|[/-]o1[^a-z]|[/-]o3[^a-z]|[/-]o4[^a-z]/i.test(model)
}

export async function sendOpenAIMessage(
  conversationId: string,
  apiKey: string,
  model: string,
  messages: ProviderMessage[],
  onChunk: (chunk: string) => void,
  options: {
    maxTokens?: number
    temperature?: number
    thinkingEffort?: string
    onThinkingChunk?: (blockId: string, chunk: string) => void
    onThinkingEnd?: (blockId: string) => void
  } = {},
  baseUrl?: string
): Promise<string> {
  const bodyObj: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
  }
  if (options.thinkingEffort && options.thinkingEffort !== 'disabled' && supportsReasoningEffort(model)) {
    const effortMap: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', max: 'high' }
    const effort = effortMap[options.thinkingEffort]
    if (effort) bodyObj.reasoning_effort = effort
  }
  const body = JSON.stringify(bodyObj)
  debugLog('openai', `stream: model=${model} baseUrl=${baseUrl ?? 'openai-default'} reasoningEffort=${bodyObj.reasoning_effort ?? 'none'} msgs=${messages.length} keyLen=${apiKey.length}`)

  return new Promise((resolve, reject) => {
    const requestId = conversationId || `__provider_request__:${incrementFallbackCounter()}`
    const cleanupActiveRequest = (req: http.ClientRequest) => {
      if (activeStreamingRequests.get(requestId) === req) {
        activeStreamingRequests.delete(requestId)
      }
    }
    const urlObj = new URL(`${baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`)
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
        const contentType = res.headers['content-type'] ?? ''
        debugLog('openai', `stream: HTTP ${res.statusCode} model=${model} contentType="${contentType.split(';')[0]}"`)

        if (res.statusCode && res.statusCode >= 400) {
          let errBody = ''
          res.on('data', (chunk: Buffer) => { errBody += chunk.toString() })
          res.on('end', () => {
            let message = `OpenAI-compatible API error (HTTP ${res.statusCode})`
            try {
              const parsed = JSON.parse(errBody)
              if (parsed.error?.message) message = parsed.error.message
            } catch { /* use default */ }
            debugLog('openai', `stream error: HTTP ${res.statusCode} model=${model} baseUrl=${baseUrl ?? 'openai-default'} message="${message}"`)
            cleanupActiveRequest(req)
            reject(new Error(message))
          })
          return
        }

        if (!contentType.includes('text/event-stream')) {
          // Non-streaming response (some providers ignore stream:true).
          // Collect the full body and extract content normally.
          let body = ''
          res.on('data', (chunk: Buffer) => { body += chunk.toString() })
          res.on('end', () => {
            try {
              const parsed = JSON.parse(body)
              const content = parsed.choices?.[0]?.message?.content
              if (content) { fullContent = content; onChunk(content) }
            } catch { /* malformed */ }
            cleanupActiveRequest(req)
            resolve(fullContent)
          })
          res.on('error', (err: Error) => { cleanupActiveRequest(req); reject(err) })
          return
        }

        let sawEmptyStop = false
        let reasoningBlockOpen = false
        parseSseStream(res, (data) => {
          try {
            const parsed = JSON.parse(data)
            const choice = parsed.choices?.[0]
            const delta = choice?.delta
            const finishReason = choice?.finish_reason
            const textContent = delta?.content ?? choice?.message?.content
            const reasoning = delta?.reasoning ?? delta?.reasoning_content
            if (reasoning && typeof reasoning === 'string') {
              reasoningBlockOpen = true
              options.onThinkingChunk?.('reasoning-0', reasoning)
            }
            if (textContent) {
              if (reasoningBlockOpen) {
                options.onThinkingEnd?.('reasoning-0')
                reasoningBlockOpen = false
              }
              fullContent += textContent
              onChunk(textContent)
            }
            if (!textContent && finishReason === 'stop') {
              if (reasoningBlockOpen) {
                options.onThinkingEnd?.('reasoning-0')
                reasoningBlockOpen = false
              }
              sawEmptyStop = true
            }
          } catch {
            // Skip malformed chunks
          }
        })
          .then(() => {
            cleanupActiveRequest(req)
            if (fullContent === '' && sawEmptyStop) {
              reject(new Error('The model returned an empty response. The conversation may be too long for this model — try starting a new conversation.'))
              return
            }
            resolve(fullContent)
          })
          .catch((err: Error) => { cleanupActiveRequest(req); reject(err) })
      }
    )
    req.on('error', (err) => { cleanupActiveRequest(req); reject(err) })
    activeStreamingRequests.set(requestId, req)
    req.write(body)
    req.end()
  })
}

export async function sendOpenAINonStreaming(
  apiKey: string,
  model: string,
  messages: ProviderMessage[],
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<ProviderNonStreamResult> {
  const body = JSON.stringify({
    model,
    messages: toOpenAICompatibleMessages(messages),
    stream: false,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.3
  })

  const { status, data } = await httpsRequest(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Length': String(Buffer.byteLength(body))
      }
    },
    body
  )

  if (status >= 400) {
    let message = `OpenAI API error (HTTP ${status})`
    try {
      const parsed = JSON.parse(data)
      if (parsed.error?.message) message = parsed.error.message
    } catch { /* use default */ }
    throw new Error(message)
  }

  const parsed = JSON.parse(data)
  const msg = parsed.choices?.[0]?.message
  return {
    content: typeof msg?.content === 'string' ? msg.content : null,
    toolCalls: []
  }
}

export async function sendOpenAIWithTools(
  apiKey: string,
  model: string,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  options: { maxTokens?: number; temperature?: number; thinkingEffort?: string } = {},
  baseUrl?: string
): Promise<ProviderNonStreamResult> {
  const bodyObj: Record<string, unknown> = {
    model,
    messages: toOpenAICompatibleMessages(messages),
    stream: false,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7
  }
  if (tools.length > 0) {
    bodyObj.tools = tools
    bodyObj.tool_choice = toolChoice
  }
  if (options.thinkingEffort && options.thinkingEffort !== 'disabled' && supportsReasoningEffort(model)) {
    const effortMap: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', max: 'high' }
    const effort = effortMap[options.thinkingEffort]
    if (effort) bodyObj.reasoning_effort = effort
  }
  const body = JSON.stringify(bodyObj)
  const url = baseUrl ? `${baseUrl}/chat/completions` : 'https://api.openai.com/v1/chat/completions'
  debugLog('openai', `withTools: model=${model} baseUrl=${baseUrl ?? 'openai-default'} tools=${tools.length} toolChoice=${toolChoice} keyLen=${apiKey.length}`)
  const { status, data } = await httpsRequest(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Length': String(Buffer.byteLength(body))
      }
    },
    body
  )
  if (status >= 400) {
    let message = `OpenAI API error (HTTP ${status})`
    try {
      const parsed = JSON.parse(data)
      if (parsed.error?.message) message = parsed.error.message
    } catch { /* use default */ }
    debugLog('openai', `withTools error: HTTP ${status} model=${model} baseUrl=${baseUrl ?? 'openai-default'} message="${message}"`)
    throw new Error(message)
  }
  debugLog('openai', `withTools: HTTP ${status} model=${model}`)
  const parsed = JSON.parse(data)
  const msg = parsed.choices?.[0]?.message
  const toolCalls: ToolCallResult[] = (msg?.tool_calls ?? []).map(
    (tc: { id: string; function: { name: string; arguments: string } }) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: (() => { try { return JSON.parse(tc.function.arguments) } catch { return {} } })()
    })
  )
  return {
    content: typeof msg?.content === 'string' ? msg.content : null,
    toolCalls
  }
}

export async function sendAzureMessage(
  conversationId: string,
  apiKey: string,
  endpoint: string,
  deployment: string,
  messages: ProviderMessage[],
  onChunk: (chunk: string) => void,
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const apiVersion = '2024-02-01'
  const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`
  const body = JSON.stringify({
    messages,
    stream: true,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7
  })

  return new Promise((resolve, reject) => {
    const requestId = conversationId || `__provider_request__:${incrementFallbackCounter()}`
    const cleanupActiveRequest = (req: http.ClientRequest) => {
      if (activeStreamingRequests.get(requestId) === req) {
        activeStreamingRequests.delete(requestId)
      }
    }
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

        parseSseStream(res, (data) => {
          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content
            if (delta) { fullContent += delta; onChunk(delta) }
          } catch {
            // Skip malformed chunks
          }
        })
          .then(() => { cleanupActiveRequest(req); resolve(fullContent) })
          .catch((err: Error) => { cleanupActiveRequest(req); reject(err) })
      }
    )
    req.on('error', (err) => { cleanupActiveRequest(req); reject(err) })
    activeStreamingRequests.set(requestId, req)
    req.write(body)
    req.end()
  })
}

export async function sendAzureNonStreaming(
  apiKey: string,
  endpoint: string,
  deployment: string,
  messages: ProviderMessage[],
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<ProviderNonStreamResult> {
  const apiVersion = '2024-02-01'
  const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`
  const body = JSON.stringify({
    messages: toOpenAICompatibleMessages(messages),
    stream: false,
    max_tokens: options.maxTokens ?? 2000,
    temperature: options.temperature ?? 0.3
  })

  const { status, data } = await httpsRequest(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
        'Content-Length': String(Buffer.byteLength(body))
      }
    },
    body
  )

  if (status >= 400) {
    let message = `Azure API error (HTTP ${status})`
    try {
      const parsed = JSON.parse(data)
      if (parsed.error?.message) message = parsed.error.message
    } catch { /* use default */ }
    throw new Error(message)
  }

  const parsed = JSON.parse(data)
  const msg = parsed.choices?.[0]?.message
  return {
    content: typeof msg?.content === 'string' ? msg.content : null,
    toolCalls: []
  }
}

export async function sendAzureWithTools(
  apiKey: string,
  endpoint: string,
  deployment: string,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<ProviderNonStreamResult> {
  const apiVersion = '2024-02-01'
  const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`
  const bodyObj: Record<string, unknown> = {
    messages: toOpenAICompatibleMessages(messages),
    stream: false,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7
  }
  if (tools.length > 0) {
    bodyObj.tools = tools
    bodyObj.tool_choice = toolChoice
  }
  const body = JSON.stringify(bodyObj)

  const { status, data } = await httpsRequest(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
        'Content-Length': String(Buffer.byteLength(body))
      }
    },
    body
  )

  if (status >= 400) {
    let message = `Azure API error (HTTP ${status})`
    try {
      const parsed = JSON.parse(data)
      if (parsed.error?.message) message = parsed.error.message
    } catch { /* use default */ }
    throw new Error(message)
  }

  const parsed = JSON.parse(data)
  const msg = parsed.choices?.[0]?.message
  const toolCalls: ToolCallResult[] = (msg?.tool_calls ?? []).map(
    (tc: { id: string; function: { name: string; arguments: string } }) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: (() => { try { return JSON.parse(tc.function.arguments) } catch { return {} } })()
    })
  )
  return {
    content: typeof msg?.content === 'string' ? msg.content : null,
    toolCalls
  }
}
