import { parseSseStream, httpsRequestUrl, providerHttpError } from '../http-client'
import type { ProviderNonStreamResult, ToolCallResult, ToolChoice, ToolDefinition } from '../provider-types'
import type { ProviderMessage } from '../provider-core-types'
import { toOpenAICompatibleMessages } from '../provider-messages'
import { runStreamingRequest, rejectHttpError } from './streaming'
import { debugLog } from '../debug-mode'
import { resolveProviderCredentialInput, type ProviderCredentialInput } from '../credential-vault'

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

/** POSTs a non-streaming chat-completions body and returns the parsed JSON, throwing on HTTP errors.
 *  `abortKey` (a conversation id) makes the in-flight request cancellable via abortActiveStream. */
async function chatCompletionsRequest(endpoint: ChatEndpoint, body: string, abortKey?: string): Promise<Record<string, unknown>> {
  const { status, data } = await httpsRequestUrl(
    endpoint.url,
    {
      method: 'POST',
      headers: { ...endpoint.headers, 'Content-Length': String(Buffer.byteLength(body)) },
    },
    body,
    abortKey,
  )
  if (status >= 400) {
    const err = providerHttpError(endpoint.label, status, data)
    debugLog('openai', `request error: HTTP ${status} url=${endpoint.url} message="${err.message}"`)
    throw err
  }
  return JSON.parse(data)
}

/**
 * Best-effort repair of tool-call argument strings that aren't quite valid JSON. Smaller/OSS
 * models (common on OpenRouter) frequently emit trailing commas, unquoted output, or concatenated
 * fragments. We attempt a few tolerant fixes before giving up. Returns the parsed object, or an
 * `error` string describing why it could not be parsed so the caller can feed it back to the model.
 */
export function parseToolArguments(raw: string): { args: Record<string, unknown>; error?: string } {
  const text = (raw ?? '').trim()
  if (text === '' || text === '{}') return { args: {} }
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { args: parsed as Record<string, unknown> }
      : { args: {}, error: `arguments were valid JSON but not an object: ${text.slice(0, 200)}` }
  } catch {
    // Tolerant repair pass: strip trailing commas, and if the model concatenated multiple JSON
    // objects, keep only the first balanced one.
    const repaired = repairJsonObject(text)
    if (repaired) {
      try {
        const parsed = JSON.parse(repaired)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return { args: parsed as Record<string, unknown> }
        }
      } catch { /* fall through to error */ }
    }
    return { args: {}, error: `could not parse arguments as JSON: ${text.slice(0, 200)}` }
  }
}

/** Strips trailing commas and extracts the first balanced top-level object, if any. */
function repairJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const candidate = text.slice(start, i + 1)
        return candidate.replace(/,(\s*[}\]])/g, '$1')
      }
    }
  }
  return null
}

function extractToolCalls(msg: Record<string, unknown> | undefined): ToolCallResult[] {
  const rawCalls = (msg?.tool_calls ?? []) as Array<{ id: string; function: { name: string; arguments: string } }>
  return rawCalls.map((tc) => {
    const { args, error } = parseToolArguments(tc.function.arguments)
    if (error) debugLog('openai', `tool-call arg parse failed: name=${tc.function.name} ${error}`)
    return {
      id: tc.id,
      name: tc.function.name,
      arguments: args,
      ...(error ? { argsError: error } : {}),
    }
  })
}

/** Extracts token usage from a non-streaming chat-completions response, if present. */
function extractUsage(parsed: Record<string, unknown>): { inputTokens: number; outputTokens: number } | undefined {
  const usage = parsed.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
  if (usage && typeof usage.prompt_tokens === 'number' && typeof usage.completion_tokens === 'number') {
    return { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }
  }
  return undefined
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

interface OpenAIStreamToolDelta {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

interface OpenAIStreamPayload {
  model?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  choices?: Array<{
    delta?: {
      content?: string
      reasoning?: string
      reasoning_content?: string
      tool_calls?: OpenAIStreamToolDelta[]
      function_call?: { name?: string; arguments?: string }
    }
    message?: { content?: string }
    finish_reason?: string | null
  }>
}

/**
 * Streams an OpenAI-compatible tool round. Function names and argument JSON
 * arrive in separate SSE deltas, so they are assembled here and exposed to the
 * tool loop only after the response has ended.
 */
function streamChatCompletionsWithTools(
  conversationId: string,
  endpoint: ChatEndpoint,
  body: string,
  onChunk: (chunk: string) => void,
  options: StreamOptions = {},
): Promise<ProviderNonStreamResult> {
  let streamedResult: ProviderNonStreamResult = { content: null, toolCalls: [] }
  return runStreamingRequest(conversationId, endpoint.url, endpoint.headers, body, (res, finish) => {
    const contentType = res.headers['content-type'] ?? ''
    if (res.statusCode && res.statusCode >= 400) {
      rejectHttpError(res, finish, (errBody) => providerHttpError(endpoint.label, res.statusCode, errBody))
      return
    }

    if (!contentType.includes('text/event-stream')) {
      let rawBody = ''
      res.on('data', (chunk: Buffer) => { rawBody += chunk.toString() })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawBody) as Record<string, unknown>
          const msg = extractMessage(parsed)
          const content = typeof msg?.content === 'string' ? msg.content : null
          if (content) onChunk(content)
          const usage = extractUsage(parsed)
          if (usage) options.onUsage?.(usage)
          streamedResult = {
            content,
            toolCalls: extractToolCalls(msg),
            ...(typeof parsed.model === 'string' ? { model: parsed.model } : {}),
            ...(usage ? { usage } : {}),
          }
        } catch {
          // Keep the empty result; the normal tool-loop recovery handles it.
        }
        finish.resolve(streamedResult.content ?? '')
      })
      res.on('error', (err: Error) => finish.reject(err))
      return
    }

    let fullContent = ''
    let model: string | undefined
    let usage: { inputTokens: number; outputTokens: number } | undefined
    let sawEmptyStop = false
    let reasoningBlockOpen = false
    const calls = new Map<number, { id: string; name: string; arguments: string }>()

    parseSseStream(res, (data) => {
      try {
        const parsed = JSON.parse(data) as OpenAIStreamPayload
        if (typeof parsed.model === 'string') model = parsed.model
        const parsedUsage = parsed.usage
        if (parsedUsage && typeof parsedUsage.prompt_tokens === 'number' && typeof parsedUsage.completion_tokens === 'number') {
          usage = { inputTokens: parsedUsage.prompt_tokens, outputTokens: parsedUsage.completion_tokens }
          options.onUsage?.(usage)
        }
        const choice = parsed.choices?.[0]
        const delta = choice?.delta ?? {}
        const textContent = delta.content ?? choice?.message?.content
        const reasoning = delta.reasoning ?? delta.reasoning_content
        if (typeof reasoning === 'string' && reasoning) {
          reasoningBlockOpen = true
          options.onThinkingChunk?.('reasoning-0', reasoning)
        }
        if (typeof textContent === 'string' && textContent) {
          if (reasoningBlockOpen) {
            options.onThinkingEnd?.('reasoning-0')
            reasoningBlockOpen = false
          }
          fullContent += textContent
          onChunk(textContent)
        }

        const streamedCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
        streamedCalls.forEach((toolCall, position) => {
          const index = typeof toolCall.index === 'number' ? toolCall.index : position
          const existing = calls.get(index) ?? {
            id: typeof toolCall.id === 'string' ? toolCall.id : `tool-call-${index}`,
            name: '',
            arguments: '',
          }
          if (typeof toolCall.id === 'string' && toolCall.id) existing.id = toolCall.id
          if (typeof toolCall.function?.name === 'string') existing.name += toolCall.function.name
          if (typeof toolCall.function?.arguments === 'string') existing.arguments += toolCall.function.arguments
          calls.set(index, existing)
        })

        // Older OpenAI-compatible endpoints sometimes use the legacy single
        // function_call delta instead of tool_calls[].
        if (delta.function_call) {
          const existing = calls.get(0) ?? { id: 'tool-call-0', name: '', arguments: '' }
          if (typeof delta.function_call.name === 'string') existing.name += delta.function_call.name
          if (typeof delta.function_call.arguments === 'string') existing.arguments += delta.function_call.arguments
          calls.set(0, existing)
        }
        if (!textContent && choice?.finish_reason === 'stop') sawEmptyStop = true
      } catch {
        // Skip malformed chunks; the provider stream parser continues.
      }
    })
      .then(() => {
        if (reasoningBlockOpen) options.onThinkingEnd?.('reasoning-0')
        const rawCalls = [...calls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, call]) => ({ id: call.id, function: { name: call.name, arguments: call.arguments } }))
        const toolCalls = extractToolCalls({ tool_calls: rawCalls })
        if (sawEmptyStop && fullContent === '' && toolCalls.length === 0) {
          finish.reject(new Error('The model returned an empty response. The conversation may be too long for this model — try starting a new conversation.'))
          return
        }
        streamedResult = {
          content: fullContent || null,
          toolCalls,
          ...(model ? { model } : {}),
          ...(usage ? { usage } : {}),
        }
        finish.resolve(fullContent)
      })
      .catch((err: Error) => finish.reject(err))
  }).then(() => streamedResult)
}

export async function sendOpenAIMessage(
  conversationId: string,
  apiKey: ProviderCredentialInput,
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
  apiKey = resolveProviderCredentialInput(apiKey)
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
  apiKey: ProviderCredentialInput,
  model: string,
  messages: ProviderMessage[],
  options: { maxTokens?: number; temperature?: number } = {},
  baseUrl?: string,
): Promise<ProviderNonStreamResult> {
  apiKey = resolveProviderCredentialInput(apiKey)
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
  apiKey: ProviderCredentialInput,
  model: string,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  options: {
    maxTokens?: number
    temperature?: number
    thinkingEffort?: string
    conversationId?: string
    onThinkingChunk?: (blockId: string, chunk: string) => void
    onThinkingEnd?: (blockId: string) => void
    onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
  } = {},
  baseUrl?: string
): Promise<ProviderNonStreamResult> {
  apiKey = resolveProviderCredentialInput(apiKey)
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

  const parsed = await chatCompletionsRequest(openAiEndpoint(apiKey, baseUrl), body, options.conversationId)
  const msg = extractMessage(parsed)
  const usage = extractUsage(parsed)
  if (usage) options.onUsage?.(usage)
  // Some OpenAI-compatible endpoints (OpenRouter, etc.) surface non-streamed reasoning as
  // `message.reasoning` / `message.reasoning_content`. Forward it so reasoning models still show
  // thinking during agentic tool loops (parity with the streaming path).
  const reasoning = (msg?.reasoning ?? msg?.reasoning_content)
  if (typeof reasoning === 'string' && reasoning.trim() && options.onThinkingChunk) {
    options.onThinkingChunk('reasoning-0', reasoning)
    options.onThinkingEnd?.('reasoning-0')
  }
  return {
    content: typeof msg?.content === 'string' ? msg.content : null,
    toolCalls: extractToolCalls(msg),
    ...(typeof parsed.model === 'string' ? { model: parsed.model } : {}),
    ...(usage ? { usage } : {}),
  }
}

export function sendOpenAIWithToolsStream(
  apiKey: ProviderCredentialInput,
  model: string,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  onChunk: (chunk: string) => void,
  options: {
    maxTokens?: number
    temperature?: number
    thinkingEffort?: string
    conversationId?: string
    onThinkingChunk?: (blockId: string, chunk: string) => void
    onThinkingEnd?: (blockId: string) => void
    onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
  } = {},
  baseUrl?: string,
): Promise<ProviderNonStreamResult> {
  apiKey = resolveProviderCredentialInput(apiKey)
  const bodyObj: Record<string, unknown> = {
    model,
    messages: toOpenAICompatibleMessages(messages),
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
  }
  if (tools.length > 0) {
    bodyObj.tools = tools
    bodyObj.tool_choice = toolChoice
  }
  applyReasoningEffort(bodyObj, model, options.thinkingEffort)
  return streamChatCompletionsWithTools(
    options.conversationId ?? '',
    openAiEndpoint(apiKey, baseUrl),
    JSON.stringify(bodyObj),
    onChunk,
    options,
  )
}

export async function sendAzureMessage(
  conversationId: string,
  apiKey: ProviderCredentialInput,
  endpoint: string,
  deployment: string,
  messages: ProviderMessage[],
  onChunk: (chunk: string) => void,
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  apiKey = resolveProviderCredentialInput(apiKey)
  const body = JSON.stringify({
    messages,
    stream: true,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7
  })
  return streamChatCompletions(conversationId, azureEndpoint(apiKey, endpoint, deployment), body, onChunk)
}

export async function sendAzureNonStreaming(
  apiKey: ProviderCredentialInput,
  endpoint: string,
  deployment: string,
  messages: ProviderMessage[],
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<ProviderNonStreamResult> {
  apiKey = resolveProviderCredentialInput(apiKey)
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
  apiKey: ProviderCredentialInput,
  endpoint: string,
  deployment: string,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  options: {
    maxTokens?: number
    temperature?: number
    conversationId?: string
    onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
  } = {}
): Promise<ProviderNonStreamResult> {
  apiKey = resolveProviderCredentialInput(apiKey)
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

  const parsed = await chatCompletionsRequest(azureEndpoint(apiKey, endpoint, deployment), body, options.conversationId)
  const msg = extractMessage(parsed)
  const usage = extractUsage(parsed)
  if (usage) options.onUsage?.(usage)
  return {
    content: typeof msg?.content === 'string' ? msg.content : null,
    toolCalls: extractToolCalls(msg),
    ...(typeof parsed.model === 'string' ? { model: parsed.model } : {}),
    ...(usage ? { usage } : {}),
  }
}

export function sendAzureWithToolsStream(
  apiKey: ProviderCredentialInput,
  endpoint: string,
  deployment: string,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  onChunk: (chunk: string) => void,
  options: {
    maxTokens?: number
    temperature?: number
    conversationId?: string
    onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
  } = {},
): Promise<ProviderNonStreamResult> {
  apiKey = resolveProviderCredentialInput(apiKey)
  const bodyObj: Record<string, unknown> = {
    messages: toOpenAICompatibleMessages(messages),
    stream: true,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
  }
  if (tools.length > 0) {
    bodyObj.tools = tools
    bodyObj.tool_choice = toolChoice
  }
  return streamChatCompletionsWithTools(
    options.conversationId ?? '',
    azureEndpoint(apiKey, endpoint, deployment),
    JSON.stringify(bodyObj),
    onChunk,
    options,
  )
}
