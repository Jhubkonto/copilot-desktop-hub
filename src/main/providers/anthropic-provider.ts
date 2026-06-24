import https from 'https'
import http from 'http'
import { httpsRequestWithResponse } from '../http-client'
import type { ProviderNonStreamResult, ToolCallResult, ToolChoice, ToolDefinition } from '../provider-types'
import type { ProviderMessage } from '../provider-core-types'
import { activeStreamingRequests, incrementFallbackCounter } from '../provider-stream-state'
import { toAnthropicContent, toAnthropicMessages } from '../provider-messages'
import type { AnthropicContentBlock } from '../provider-messages'
import { debugLog } from '../debug-mode'

interface AnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

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

function supportsExtendedThinking(model: string): boolean {
  return /claude-3[-.]?[57]|claude-3[-.]?7|claude-4/.test(model)
}

export async function sendAnthropicWithTools(
  apiKey: string,
  model: string,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  options: {
    maxTokens?: number
    temperature?: number
    thinkingEffort?: string
    onThinkingChunk?: (blockId: string, chunk: string) => void
    onThinkingEnd?: (blockId: string) => void
  } = {}
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
  if (options.thinkingEffort && options.thinkingEffort !== 'disabled' && supportsExtendedThinking(model)) {
    const budgetMap: Record<string, number> = { low: 2000, medium: 8000, high: 16000, max: 32000 }
    const budget = budgetMap[options.thinkingEffort]
    if (budget) {
      bodyObj.thinking = { type: 'enabled', budget_tokens: budget }
      bodyObj.temperature = 1
    }
  }

  const body = JSON.stringify(bodyObj)
  const thinkingEnabled = !!(bodyObj.thinking)
  const thinkingBudget = thinkingEnabled ? (bodyObj.thinking as { budget_tokens?: number })?.budget_tokens : undefined
  debugLog('anthropic', `withTools: model=${model} tools=${tools.length} thinking=${thinkingEnabled}${thinkingBudget ? ` budget=${thinkingBudget}` : ''} keyLen=${apiKey.length}`)
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
    } catch { /* use default */ }
    debugLog('anthropic', `withTools error: HTTP ${status} model=${model} message="${message}"`)
    throw new Error(message)
  }
  debugLog('anthropic', `withTools: HTTP ${status} model=${model}`)

  const parsed = JSON.parse(data)
  const contentBlocks: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }> =
    parsed.content ?? []

  let content: string | null = null
  const toolCalls: ToolCallResult[] = []

  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i]
    if (block.type === 'thinking' && (block.thinking || block.text)) {
      const blockId = `thinking-${i}`
      const thinkingText = block.thinking ?? block.text ?? ''
      options.onThinkingChunk?.(blockId, thinkingText)
      options.onThinkingEnd?.(blockId)
    } else if (block.type === 'text' && block.text) {
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

export async function sendAnthropicMessage(
  conversationId: string,
  apiKey: string,
  model: string,
  messages: ProviderMessage[],
  systemPrompt: string | undefined,
  onChunk: (chunk: string) => void,
  options: {
    maxTokens?: number
    temperature?: number
    thinkingEffort?: string
    onThinkingChunk?: (blockId: string, chunk: string) => void
    onThinkingEnd?: (blockId: string) => void
  } = {}
): Promise<string> {
  const anthropicMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: toAnthropicContent(m.content ?? '') as string | AnthropicContentBlock[] }))
  const bodyObj: Record<string, unknown> = {
    model,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    stream: true,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: anthropicMessages
  }
  if (options.thinkingEffort && options.thinkingEffort !== 'disabled' && supportsExtendedThinking(model)) {
    const budgetMap: Record<string, number> = { low: 2000, medium: 8000, high: 16000, max: 32000 }
    const budget = budgetMap[options.thinkingEffort]
    if (budget) {
      bodyObj.thinking = { type: 'enabled', budget_tokens: budget }
      bodyObj.temperature = 1
    }
  }
  const body = JSON.stringify(bodyObj)
  const streamThinkingEnabled = !!(bodyObj.thinking)
  const streamThinkingBudget = streamThinkingEnabled ? (bodyObj.thinking as { budget_tokens?: number })?.budget_tokens : undefined
  debugLog('anthropic', `stream: model=${model} thinking=${streamThinkingEnabled}${streamThinkingBudget ? ` budget=${streamThinkingBudget}` : ''} msgs=${messages.length} keyLen=${apiKey.length}`)

  return new Promise((resolve, reject) => {
    const requestId = conversationId || `__provider_request__:${incrementFallbackCounter()}`
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
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = ''
          res.on('data', (chunk: Buffer) => { errBody += chunk.toString() })
          res.on('end', () => {
            cleanupActiveRequest(req)
            let message = `Anthropic API error (HTTP ${res.statusCode})`
            try {
              const parsed = JSON.parse(errBody)
              if (parsed.error?.message) message = parsed.error.message
            } catch { /* use default */ }
            debugLog('anthropic', `stream error: HTTP ${res.statusCode} model=${model} message="${message}"`)
            reject(new Error(message))
          })
          return
        }
        debugLog('anthropic', `stream: HTTP ${res.statusCode} model=${model} — receiving chunks`)

        let fullContent = ''
        let buffer = ''
        let activeThinkingBlockId: string | null = null

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data: ')) continue
            const data = trimmed.slice(6)

            try {
              const parsed = JSON.parse(data) as Record<string, unknown>
              if (
                parsed.type === 'content_block_start' &&
                (parsed.content_block as Record<string, unknown> | undefined)?.type === 'thinking'
              ) {
                activeThinkingBlockId = `thinking-${parsed.index as number ?? 0}`
              }
              if (parsed.type === 'content_block_stop' && activeThinkingBlockId) {
                options.onThinkingEnd?.(activeThinkingBlockId)
                activeThinkingBlockId = null
              }
              if (parsed.type === 'content_block_delta') {
                const delta = parsed.delta as Record<string, unknown> | undefined
                if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string' && activeThinkingBlockId) {
                  options.onThinkingChunk?.(activeThinkingBlockId, delta.thinking)
                } else if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
                  fullContent += delta.text
                  onChunk(delta.text)
                } else if (typeof (parsed.delta as Record<string, unknown> | undefined)?.text === 'string') {
                  // fallback: older delta format without explicit type
                  const text = (parsed.delta as { text: string }).text
                  fullContent += text
                  onChunk(text)
                }
              }
            } catch {
              // Skip malformed chunks
            }
          }
        })

        res.on('end', () => { cleanupActiveRequest(req); resolve(fullContent) })
        res.on('error', (err) => { cleanupActiveRequest(req); reject(err) })
      }
    )
    req.on('error', (err) => { cleanupActiveRequest(req); reject(err) })
    activeStreamingRequests.set(requestId, req)
    req.write(body)
    req.end()
  })
}
