import { httpsRequestUrl, providerHttpError, parseSseStream } from '../http-client'
import type { ProviderNonStreamResult, ToolCallResult, ToolChoice, ToolDefinition } from '../provider-types'
import type { ProviderMessage } from '../provider-core-types'
import { toAnthropicContent, toAnthropicMessages } from '../provider-messages'
import type { AnthropicContentBlock } from '../provider-messages'
import { runStreamingRequest, rejectHttpError } from './streaming'
import { debugLog } from '../debug-mode'

interface AnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'

const THINKING_BUDGET_MAP: Record<string, number> = { low: 2000, medium: 8000, high: 16000, max: 32000 }

function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }
}

/** Enables extended thinking on the request body when the effort + model support it. */
function applyThinkingBudget(bodyObj: Record<string, unknown>, model: string, thinkingEffort?: string): void {
  if (!thinkingEffort || thinkingEffort === 'disabled' || !supportsExtendedThinking(model)) return
  const budget = THINKING_BUDGET_MAP[thinkingEffort]
  if (budget) {
    bodyObj.thinking = { type: 'enabled', budget_tokens: budget }
    bodyObj.temperature = 1
  }
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
    onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
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
  applyThinkingBudget(bodyObj, model, options.thinkingEffort)

  const body = JSON.stringify(bodyObj)
  const thinkingEnabled = !!(bodyObj.thinking)
  const thinkingBudget = thinkingEnabled ? (bodyObj.thinking as { budget_tokens?: number })?.budget_tokens : undefined
  debugLog('anthropic', `withTools: model=${model} tools=${tools.length} thinking=${thinkingEnabled}${thinkingBudget ? ` budget=${thinkingBudget}` : ''} keyLen=${apiKey.length}`)
  const { status, data } = await httpsRequestUrl(
    ANTHROPIC_MESSAGES_URL,
    {
      method: 'POST',
      headers: { ...anthropicHeaders(apiKey), 'Content-Length': String(Buffer.byteLength(body)) }
    },
    body
  )

  if (status >= 400) {
    const err = providerHttpError('Anthropic', status, data)
    debugLog('anthropic', `withTools error: HTTP ${status} model=${model} message="${err.message}"`)
    throw err
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

  const rawUsage = parsed.usage as { input_tokens?: number; output_tokens?: number } | undefined
  const usage = rawUsage && typeof rawUsage.input_tokens === 'number' && typeof rawUsage.output_tokens === 'number'
    ? { inputTokens: rawUsage.input_tokens, outputTokens: rawUsage.output_tokens }
    : undefined
  if (usage) options.onUsage?.(usage)

  return {
    content,
    toolCalls,
    ...(typeof parsed.model === 'string' ? { model: parsed.model } : {}),
    ...(usage ? { usage } : {}),
  }
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
  applyThinkingBudget(bodyObj, model, options.thinkingEffort)
  const body = JSON.stringify(bodyObj)
  const streamThinkingEnabled = !!(bodyObj.thinking)
  const streamThinkingBudget = streamThinkingEnabled ? (bodyObj.thinking as { budget_tokens?: number })?.budget_tokens : undefined
  debugLog('anthropic', `stream: model=${model} thinking=${streamThinkingEnabled}${streamThinkingBudget ? ` budget=${streamThinkingBudget}` : ''} msgs=${messages.length} keyLen=${apiKey.length}`)

  return runStreamingRequest(conversationId, ANTHROPIC_MESSAGES_URL, anthropicHeaders(apiKey), body, (res, finish) => {
    if (res.statusCode && res.statusCode >= 400) {
      rejectHttpError(res, finish, (errBody) => {
        const err = providerHttpError('Anthropic', res.statusCode, errBody)
        debugLog('anthropic', `stream error: HTTP ${res.statusCode} model=${model} message="${err.message}"`)
        return err
      })
      return
    }
    debugLog('anthropic', `stream: HTTP ${res.statusCode} model=${model} — receiving chunks`)

    let fullContent = ''
    let activeThinkingBlockId: string | null = null

    parseSseStream(res, (data) => {
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
    })
      .then(() => finish.resolve(fullContent))
      .catch((err: Error) => finish.reject(err))
  })
}
