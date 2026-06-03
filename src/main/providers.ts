import { safeStorage } from 'electron'
import { getDatabase } from './database'
import https from 'https'
import { safeHandle } from './safe-handle'
import http from 'http'
import { parseSseStream, httpsRequestWithResponse } from './http-client'
import type { ProviderNonStreamResult, ToolCallResult, ToolChoice, ToolDefinition } from './provider-types'

export type ProviderName = 'openai' | 'anthropic' | 'azure' | 'gemini' | 'mistral' | 'groq' | 'xai'

export const DEFAULT_PROVIDER_MODEL = 'gpt-5-mini'
export const NO_PROVIDER_CONFIGURED_MESSAGE = 'No provider configured. Add an API key in Settings.'

export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type MessageContent = string | MessageContentPart[]

export interface ToolCallMessage {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ProviderMessage =
  | { role: 'system' | 'user'; content: MessageContent }
  | { role: 'assistant'; content: MessageContent | null; tool_calls?: ToolCallMessage[] }
  | { role: 'tool'; tool_call_id: string; content: string; images?: { dataUrl: string }[] }

// Track active streaming requests so they can be aborted per conversation
export const activeStreamingRequests = new Map<string, http.ClientRequest>()
let fallbackStreamingRequestCounter = 0

export function abortActiveStream(conversationId?: string): void {
  if (conversationId) {
    const req = activeStreamingRequests.get(conversationId)
    if (req) {
      req.destroy()
      activeStreamingRequests.delete(conversationId)
    }
    return
  }

  for (const req of activeStreamingRequests.values()) req.destroy()
  activeStreamingRequests.clear()
}

interface ProviderConfig {
  name: ProviderName
  label: string
  apiKeySettingKey: string
  models: string[]
  baseUrl?: string
}

export const PROVIDERS: ProviderConfig[] = [
  {
    name: 'openai',
    label: 'OpenAI',
    apiKeySettingKey: 'byok_openai_key',
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-preview', 'o1-mini']
  },
  {
    name: 'anthropic',
    label: 'Anthropic',
    apiKeySettingKey: 'byok_anthropic_key',
    models: ['claude-opus-4.8', 'claude-opus-4.7', 'claude-opus-4.6', 'claude-opus-4.5', 'claude-sonnet-4.6', 'claude-sonnet-4.5', 'claude-sonnet-4', 'claude-haiku-4.5', 'claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229']
  },
  {
    name: 'azure',
    label: 'Azure OpenAI',
    apiKeySettingKey: 'byok_azure_key',
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']
  },
  {
    name: 'gemini',
    label: 'Google Gemini',
    apiKeySettingKey: 'byok_gemini_key',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash']
  },
  {
    name: 'mistral',
    label: 'Mistral',
    apiKeySettingKey: 'byok_mistral_key',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest', 'open-mistral-7b']
  },
  {
    name: 'groq',
    label: 'Groq',
    apiKeySettingKey: 'byok_groq_key',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it']
  },
  {
    name: 'xai',
    label: 'xAI (Grok)',
    apiKeySettingKey: 'byok_xai_key',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-3', 'grok-3-mini', 'grok-2-1212']
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

async function httpsRequest(
  url: string,
  options: https.RequestOptions,
  body: string
): Promise<{ status: number; data: string }> {
  const urlObj = new URL(url)
  return httpsRequestWithResponse(
    {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      ...options
    },
    body
  )
}

export async function sendOpenAIMessage(
  conversationId: string,
  apiKey: string,
  model: string,
  messages: ProviderMessage[],
  onChunk: (chunk: string) => void,
  options: { maxTokens?: number; temperature?: number } = {},
  baseUrl?: string
): Promise<string> {
  const body = JSON.stringify({
    model,
    messages,
    stream: true,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7
  })

  return new Promise((resolve, reject) => {
    const requestId = conversationId || `__provider_request__:${fallbackStreamingRequestCounter++}`
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

        parseSseStream(res, (data) => {
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
        })
          .then(() => {
            cleanupActiveRequest(req)
            resolve(fullContent)
          })
          .catch((err: Error) => {
            cleanupActiveRequest(req)
            reject(err)
          })
      }
    )
    req.on('error', (err) => {
      cleanupActiveRequest(req)
      reject(err)
    })
    activeStreamingRequests.set(requestId, req)
    req.write(body)
    req.end()
  })
}

interface AnthropicTextBlock { type: 'text'; text: string }
interface AnthropicImageBlock { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
interface AnthropicToolUseBlock { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
interface AnthropicToolResultBlock { type: 'tool_result'; tool_use_id: string; content: (AnthropicTextBlock | AnthropicImageBlock)[] }
type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock | AnthropicToolUseBlock | AnthropicToolResultBlock

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

interface AnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

function toAnthropicContent(content: MessageContent): string | AnthropicContentBlock[] {
  if (typeof content === 'string') return content
  return content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type === 'image_url') {
      const url = part.image_url.url
      const match = url.match(/^data:([^;]+);base64,(.+)$/)
      if (match) {
        return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
      }
      return { type: 'text', text: `[Image: ${url}]` }
    }
    return { type: 'text', text: '' }
  })
}

export function toAnthropicMessages(
  messages: ProviderMessage[]
): { system: string | undefined; messages: AnthropicMessage[] } {
  let system: string | undefined
  const result: AnthropicMessage[] = []
  let i = 0

  while (i < messages.length) {
    const msg = messages[i]

    if (msg.role === 'system') {
      if (!system) system = typeof msg.content === 'string' ? msg.content : ''
      i++
      continue
    }

    if (msg.role === 'user') {
      result.push({ role: 'user', content: toAnthropicContent(msg.content) })
      i++
      continue
    }

    if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const blocks: AnthropicContentBlock[] = []
        if (msg.content) {
          const textStr = typeof msg.content === 'string' ? msg.content : null
          if (textStr && textStr.trim()) blocks.push({ type: 'text', text: textStr })
        }
        for (const tc of msg.tool_calls) {
          let parsedArgs: Record<string, unknown>
          try { parsedArgs = JSON.parse(tc.function.arguments) } catch { parsedArgs = {} }
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: parsedArgs })
        }
        result.push({ role: 'assistant', content: blocks })
      } else {
        result.push({ role: 'assistant', content: toAnthropicContent(msg.content ?? '') })
      }
      i++
      continue
    }

    if (msg.role === 'tool') {
      const toolResultBlocks: AnthropicToolResultBlock[] = []
      while (i < messages.length && messages[i].role === 'tool') {
        const toolMsg = messages[i] as { role: 'tool'; tool_call_id: string; content: string; images?: { dataUrl: string }[] }
        const content: (AnthropicTextBlock | AnthropicImageBlock)[] = [{ type: 'text', text: toolMsg.content }]
        if (toolMsg.images?.length) {
          for (const img of toolMsg.images) {
            const match = img.dataUrl.match(/^data:([^;]+);base64,(.+)$/)
            if (match) {
              content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } })
            }
          }
        }
        toolResultBlocks.push({ type: 'tool_result', tool_use_id: toolMsg.tool_call_id, content })
        i++
      }

      // Legacy fallback: consume a synthetic screenshot user message produced by old-format
      // message arrays (sentinel text '[Browser screenshots from current step]').
      if (i < messages.length && messages[i].role === 'user') {
        const nextMsg = messages[i]
        const isLegacyScreenshotMsg = Array.isArray(nextMsg.content) &&
          nextMsg.content.length > 0 &&
          nextMsg.content[0].type === 'text' &&
          (nextMsg.content[0] as { type: 'text'; text: string }).text === '[Browser screenshots from current step]'
        if (isLegacyScreenshotMsg && toolResultBlocks.length > 0) {
          const legacyImages: AnthropicImageBlock[] = []
          for (const part of nextMsg.content as MessageContentPart[]) {
            if (part.type === 'image_url') {
              const url = part.image_url.url
              const match = url.match(/^data:([^;]+);base64,(.+)$/)
              if (match) {
                legacyImages.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } })
              }
            }
          }
          if (legacyImages.length > 0) {
            toolResultBlocks[toolResultBlocks.length - 1].content.push(...legacyImages)
          }
          i++
        }
      }

      result.push({ role: 'user', content: toolResultBlocks as AnthropicContentBlock[] })
      continue
    }

    i++
  }

  return { system, messages: result }
}

export function toAnthropicTools(
  tools: ToolDefinition[]
): { tools: AnthropicTool[]; nameMap: Map<string, string> } {
  const nameMap = new Map<string, string>()
  const usedNames = new Set<string>()

  const anthropicTools: AnthropicTool[] = tools.map((tool) => {
    const originalName = tool.function.name
    let normalized = originalName.replace(/[^a-zA-Z0-9_-]/g, '_')
    if (normalized.length > 64) normalized = normalized.slice(0, 64)
    if (usedNames.has(normalized)) {
      let suffix = 2
      while (usedNames.has(`${normalized.slice(0, 62)}_${suffix}`)) suffix++
      normalized = `${normalized.slice(0, 62)}_${suffix}`
    }
    usedNames.add(normalized)
    nameMap.set(normalized, originalName)

    return {
      name: normalized,
      description: tool.function.description,
      input_schema: tool.function.parameters
    }
  })

  return { tools: anthropicTools, nameMap }
}

export async function sendAnthropicWithTools(
  apiKey: string,
  model: string,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<ProviderNonStreamResult> {
  const { system, messages: anthropicMsgs } = toAnthropicMessages(messages)
  const { tools: anthropicTools, nameMap } = toAnthropicTools(tools)

  const toolChoiceParam =
    toolChoice === 'required' ? { type: 'any' } :
    toolChoice === 'none' ? { type: 'auto' } :
    { type: 'auto' }

  const bodyObj: Record<string, unknown> = {
    model,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    stream: false,
    messages: anthropicMsgs
  }
  if (system) bodyObj.system = system
  if (toolChoice !== 'none' && anthropicTools.length > 0) {
    bodyObj.tools = anthropicTools
    bodyObj.tool_choice = toolChoiceParam
  }

  const body = JSON.stringify(bodyObj)
  const { status, data } = await httpsRequest(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': String(Buffer.byteLength(body))
      }
    },
    body
  )

  if (status >= 400) {
    let message = `Anthropic API error (HTTP ${status})`
    try {
      const parsed = JSON.parse(data)
      if (parsed.error?.message) message = parsed.error.message
    } catch {
      // use default message
    }
    throw new Error(message)
  }

  const parsed = JSON.parse(data)
  const contentBlocks: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> =
    parsed.content ?? []

  let content: string | null = null
  const toolCalls: ToolCallResult[] = []

  for (const block of contentBlocks) {
    if (block.type === 'text' && block.text) {
      content = (content ?? '') + block.text
    } else if (block.type === 'tool_use' && block.id && block.name) {
      const originalName = nameMap.get(block.name) ?? block.name
      const args = block.input && typeof block.input === 'object'
        ? block.input as Record<string, unknown>
        : {}
      toolCalls.push({ id: block.id, name: originalName, arguments: args })
    }
  }

  return { content, toolCalls }
}

/**
 * Converts ProviderMessages for OpenAI-compatible APIs.
 * Tool messages with `images` are represented as synthetic user messages
 * appended after each group of tool results. Images are attributed per tool.
 */
export function toOpenAICompatibleMessages(messages: ProviderMessage[]): ProviderMessage[] {
  const result: ProviderMessage[] = []
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]
    if (msg.role !== 'tool') {
      // Strip images field if somehow present on non-tool messages
      result.push(msg)
      i++
      continue
    }

    // Collect a consecutive run of tool messages
    const toolGroup: { role: 'tool'; tool_call_id: string; content: string; images?: { dataUrl: string }[] }[] = []
    while (i < messages.length && messages[i].role === 'tool') {
      toolGroup.push(messages[i] as { role: 'tool'; tool_call_id: string; content: string; images?: { dataUrl: string }[] })
      i++
    }

    // Emit tool messages without the images field (API doesn't understand it)
    for (const t of toolGroup) {
      result.push({ role: 'tool', tool_call_id: t.tool_call_id, content: t.content })
    }

    // Build synthetic user message for any tool images, grouped per tool
    const imageParts: MessageContentPart[] = []
    for (const t of toolGroup) {
      if (!t.images?.length) continue
      const toolLabel = `[Screenshots from tool: ${t.tool_call_id}]`
      imageParts.push({ type: 'text', text: toolLabel })
      for (const img of t.images) {
        imageParts.push({ type: 'image_url', image_url: { url: img.dataUrl } })
      }
    }
    if (imageParts.length > 0) {
      result.push({ role: 'user', content: imageParts })
    }
  }
  return result
}

export async function sendAnthropicMessage(
  conversationId: string,
  apiKey: string,
  model: string,
  messages: ProviderMessage[],
  systemPrompt: string | undefined,
  onChunk: (chunk: string) => void,
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const anthropicMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: toAnthropicContent(m.content ?? '') }))
  const body = JSON.stringify({
    model,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    stream: true,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: anthropicMessages
  })

  return new Promise((resolve, reject) => {
    const requestId = conversationId || `__provider_request__:${fallbackStreamingRequestCounter++}`
    const cleanupActiveRequest = (req: http.ClientRequest) => {
      if (activeStreamingRequests.get(requestId) === req) {
        activeStreamingRequests.delete(requestId)
      }
    }
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
          cleanupActiveRequest(req)
          resolve(fullContent)
        })

        res.on('error', (err) => {
          cleanupActiveRequest(req)
          reject(err)
        })
      }
    )
    req.on('error', (err) => {
      cleanupActiveRequest(req)
      reject(err)
    })
    activeStreamingRequests.set(requestId, req)
    req.write(body)
    req.end()
  })
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
    const requestId = conversationId || `__provider_request__:${fallbackStreamingRequestCounter++}`
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
            resolve(fullContent)
          })
          .catch((err: Error) => {
            cleanupActiveRequest(req)
            reject(err)
          })
      }
    )
    req.on('error', (err) => {
      cleanupActiveRequest(req)
      reject(err)
    })
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
    } catch {
      // use default message
    }
    throw new Error(message)
  }

  const parsed = JSON.parse(data)
  const msg = parsed.choices?.[0]?.message
  return {
    content: typeof msg?.content === 'string' ? msg.content : null,
    toolCalls: []
  }
}

/**
 * Non-streaming OpenAI-compatible completion. Used for background tasks like wiki extraction.
 */
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
    } catch {
      // use default message
    }
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

/**
 * Non-streaming OpenAI completion with tool calling support.
 */
export async function sendOpenAIWithTools(
  apiKey: string,
  model: string,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  options: { maxTokens?: number; temperature?: number } = {}
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
  const body = JSON.stringify(bodyObj)
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

/**
 * Provider-agnostic non-streaming completion with tool calling support.
 * Routes to the appropriate backend. Throws for Azure (not yet supported as orchestration leader).
 */
export async function sendProviderWithTools(
  provider: ProviderName,
  apiKey: string | null,
  model: string,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<ProviderNonStreamResult> {
  if (!apiKey) {
    throw new Error(NO_PROVIDER_CONFIGURED_MESSAGE)
  }
  if (provider === 'anthropic') {
    return sendAnthropicWithTools(apiKey, model, messages, tools, toolChoice, options)
  }
  if (provider === 'openai') {
    return sendOpenAIWithTools(apiKey, model, messages, tools, toolChoice, options)
  }
  throw new Error(
    'Azure OpenAI does not support the multi-agent orchestration leader role. ' +
    'Please select an OpenAI or Anthropic model as the team leader.'
  )
}

/**
 * Provider-agnostic non-streaming completion. Routes to the correct backend based on provider.
 */
export async function sendProviderNonStreaming(
  provider: ProviderName,
  apiKey: string | null,
  model: string,
  messages: ProviderMessage[],
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<ProviderNonStreamResult> {
  if (!apiKey) {
    throw new Error(NO_PROVIDER_CONFIGURED_MESSAGE)
  }
  if (provider === 'anthropic') {
    return sendAnthropicWithTools(apiKey, model, messages, [], 'none', options)
  }
  if (provider === 'openai') {
    return sendOpenAINonStreaming(apiKey, model, messages, options)
  }
  const endpoint = getAzureEndpoint()
  if (!endpoint) {
    throw new Error('Azure endpoint not configured')
  }
  return sendAzureNonStreaming(apiKey, endpoint, model, messages, options)
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
  const normalizedModel = !agentModel || agentModel === 'default' ? DEFAULT_PROVIDER_MODEL : agentModel

  if (normalizedModel.includes(':')) {
    const [prefix, model] = normalizedModel.split(':', 2)
    const provider = PROVIDERS.find((p) => p.name === prefix)
    if (provider) return { provider: provider.name, model }
  }

  for (const p of PROVIDERS) {
    for (const m of p.models) {
      if (normalizedModel === m) {
        return { provider: p.name, model: m }
      }
    }
  }

  if (normalizedModel.startsWith('claude')) {
    return { provider: 'anthropic', model: normalizedModel }
  }

  return { provider: 'openai', model: normalizedModel }
}

export function isProviderConfigured(provider: ProviderName): boolean {
  return !!retrieveApiKey(provider)
}

export function getApiKey(provider: ProviderName): string | null {
  return retrieveApiKey(provider)
}

export function registerProviderHandlers(): void {
  safeHandle('provider:list', () => {
    return PROVIDERS.map((p) => ({
      ...p,
      configured: !!retrieveApiKey(p.name)
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
      const providerCfg = PROVIDERS.find((p) => p.name === provider)
      if (providerCfg?.baseUrl) {
        const result = await httpsRequest(
          `${providerCfg.baseUrl}/models`,
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
