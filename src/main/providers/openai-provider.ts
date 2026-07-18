import { parseSseStream, httpsRequestUrl, providerHttpError } from '../http-client'
import type { ProviderNonStreamResult, ToolCallResult, ToolChoice, ToolDefinition } from '../provider-types'
import type { ProviderMessage } from '../provider-core-types'
import { toOpenAICompatibleMessages } from '../provider-messages'
import { runStreamingRequest, rejectHttpError } from './streaming'
import { debugLog } from '../debug-mode'

// Returns true for OpenAI o-series and compatible reasoning models.
function supportsReasoningEffort(model: string): boolean {
  return /^o\d|\/o\d|[/-]o1[^a-z]|[/-]o3[^a-z]|[/-]o4[^a-z]/i.test(model)
}

const REASONING_EFFORT_MAP: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', max: 'high' }

function applyReasoningEffort(bodyObj: Record<string, unknown>, model: string, thinkingEffort?: string): void {
  if (!thinkingEffort || thinkingEffort === 'disabled' || !supportsReasoningEffort(model)) return
  const effort = REASONING_EFFORT_MAP[thinkingEffort]
  if (effort) bodyObj.reasoning_effort = effort
}

/** One OpenAI-compatible chat-completions endpoint: OpenAI itself, a baseUrl-compatible provider, or Azure. */
interface ChatEndpoint {
  label: string
  url: string
  headers: Record<string, string>
}

const AZURE_API_VERSION = '2024-02-01'

function openAiEndpoint(apiKey: string, baseUrl?: string): ChatEndpoint {
  return {
    label: baseUrl ? 'OpenAI-compatible' : 'OpenAI',
    url: `${baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  }
}

function azureEndpoint(apiKey: string, endpoint: string, deployment: string): ChatEndpoint {
  return {
    label: 'Azure',
    url: `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${AZURE_API_VERSION}`,
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
  }
}

/** POSTs a non-streaming chat-completions body and returns the parsed JSON, throwing on HTTP errors. */
async function chatCompletionsRequest(endpoint: ChatEndpoint, body: string): Promise<Record<string, unknown>> {
  const { status, data } = await httpsRequestUrl(
    endpoint.url,
    {
      method: 'POST',
      headers: { ...endpoint.headers, 'Content-Length': String(Buffer.byteLength(body)) },
    },
    body,
  )
  if (status >= 400) {
    const err = providerHttpError(endpoint.label, status, data)
    debugLog('openai', `request error: HTTP ${status} url=${endpoint.url} message="${err.message}"`)
    throw err
  }
  return JSON.parse(data)
}

function extractToolCalls(msg: Record<string, unknown> | undefined): ToolCallResult[] {
  const rawCalls = (msg?.tool_calls ?? []) as Array<{ id: string; function: { name: string; arguments: string } }>
  return rawCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: (() => { try { return JSON.parse(tc.function.arguments) } catch { return {} } })(),
  }))
}

function extractMessage(parsed: Record<string, unknown>): Record<string, unknown> | undefined {
  const choices = parsed.choices as Array<{ message?: Record<string, unknown> }> | undefined
  return choices?.[0]?.message
}

interface StreamOptions {
  onThinkingChunk?: (blockId: string, chunk: string) => void
  onThinkingEnd?: (blockId: string) => void
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
}

/**
 * Shared streaming response handler for every OpenAI-compatible endpoint:
 * HTTP-error rejection, non-SSE fallback (some providers ignore stream:true),
 * reasoning deltas, usage reporting, and empty-stop detection.
 */
function streamChatCompletions(
  conversationId: string,
  endpoint: ChatEndpoint,
  body: string,
  onChunk: (chunk: string) => void,
  options: StreamOptions = {},
): Promise<string> {
  return runStreamingRequest(conversationId, endpoint.url, endpoint.headers, body, (res, finish) => {
    let fullContent = ''
    const contentType = res.headers['content-type'] ?? ''
    debugLog('openai', `stream: HTTP ${res.statusCode} url=${endpoint.url} contentType="${contentType.split(';')[0]}"`)

    if (res.statusCode && res.statusCode >= 400) {
      rejectHttpError(res, finish, (errBody) => {
        const err = providerHttpError(endpoint.label, res.statusCode, errBody)
        debugLog('openai', `stream error: HTTP ${res.statusCode} url=${endpoint.url} message="${err.message}"`)
        return err
      })
      return
    }

    if (!contentType.includes('text/event-stream')) {
      // Non-streaming response (some providers ignore stream:true).
      // Collect the full body and extract content normally.
      let rawBody = ''
      res.on('data', (chunk: Buffer) => { rawBody += chunk.toString() })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawBody)
          const content = parsed.choices?.[0]?.message?.content
          if (content) { fullContent = content; onChunk(content) }
        } catch { /* malformed */ }
        finish.resolve(fullContent)
      })
      res.on('error', (err: Error) => finish.reject(err))
      return
    }

    let sawEmptyStop = false
    let reasoningBlockOpen = false
    parseSseStream(res, (data) => {
      try {
        const parsed = JSON.parse(data)
        const usage = parsed.usage
        if (usage && typeof usage.prompt_tokens === 'number' && typeof usage.completion_tokens === 'number') {
          options.onUsage?.({ inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens })
        }
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
        if (fullContent === '' && sawEmptyStop) {
          finish.reject(new Error('The model returned an empty response. The conversation may be too long for this model — try starting a new conversation.'))
          return
        }
        finish.resolve(fullContent)
      })
      .catch((err: Error) => finish.reject(err))
  })
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
    onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
  } = {},
  baseUrl?: string
): Promise<string> {
  const bodyObj: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
  }
  applyReasoningEffort(bodyObj, model, options.thinkingEffort)
  const body = JSON.stringify(bodyObj)
  debugLog('openai', `stream: model=${model} baseUrl=${baseUrl ?? 'openai-default'} reasoningEffort=${bodyObj.reasoning_effort ?? 'none'} msgs=${messages.length} keyLen=${apiKey.length}`)

  return streamChatCompletions(conversationId, openAiEndpoint(apiKey, baseUrl), body, onChunk, options)
}

export async function sendOpenAINonStreaming(
  apiKey: string,
  model: string,
  messages: ProviderMessage[],
  options: { maxTokens?: number; temperature?: number } = {},
  baseUrl?: string,
): Promise<ProviderNonStreamResult> {
  const body = JSON.stringify({
    model,
    messages: toOpenAICompatibleMessages(messages),
    stream: false,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.3
  })

  const parsed = await chatCompletionsRequest(openAiEndpoint(apiKey, baseUrl), body)
  const msg = extractMessage(parsed)
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
  applyReasoningEffort(bodyObj, model, options.thinkingEffort)
  const body = JSON.stringify(bodyObj)
  debugLog('openai', `withTools: model=${model} baseUrl=${baseUrl ?? 'openai-default'} tools=${tools.length} toolChoice=${toolChoice} keyLen=${apiKey.length}`)

  const parsed = await chatCompletionsRequest(openAiEndpoint(apiKey, baseUrl), body)
  const msg = extractMessage(parsed)
  return {
    content: typeof msg?.content === 'string' ? msg.content : null,
    toolCalls: extractToolCalls(msg)
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
  const body = JSON.stringify({
    messages,
    stream: true,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7
  })
  return streamChatCompletions(conversationId, azureEndpoint(apiKey, endpoint, deployment), body, onChunk)
}

export async function sendAzureNonStreaming(
  apiKey: string,
  endpoint: string,
  deployment: string,
  messages: ProviderMessage[],
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<ProviderNonStreamResult> {
  const body = JSON.stringify({
    messages: toOpenAICompatibleMessages(messages),
    stream: false,
    max_tokens: options.maxTokens ?? 2000,
    temperature: options.temperature ?? 0.3
  })

  const parsed = await chatCompletionsRequest(azureEndpoint(apiKey, endpoint, deployment), body)
  const msg = extractMessage(parsed)
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

  const parsed = await chatCompletionsRequest(azureEndpoint(apiKey, endpoint, deployment), body)
  const msg = extractMessage(parsed)
  return {
    content: typeof msg?.content === 'string' ? msg.content : null,
    toolCalls: extractToolCalls(msg)
  }
}
