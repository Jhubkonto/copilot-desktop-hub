import { randomUUID } from 'crypto'
import type { ProviderName, ProviderMessage } from '../provider-core-types'
import type { ToolDefinition } from '../provider-types'
import type { ModelToolCaller } from '../tool-loop'
import { sendProviderWithTools } from '../providers'

const ADDENDUM_MARKER = 'You do not have native function-calling'

export interface ParsedToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface ParsedToolResponse {
  toolCalls: ParsedToolCall[]
  remainingText: string
}

const FENCE_RE = /```(?:json)?\s*\n?([\s\S]*?)```/gi

function isParsedToolCall(value: unknown): value is ParsedToolCall {
  if (typeof value !== 'object' || value === null) return false
  const name = (value as { name?: unknown }).name
  return typeof name === 'string' && name.trim().length > 0
}

function normalizeToolCall(value: { name: string; arguments?: unknown }): ParsedToolCall {
  const args = value.arguments
  return {
    name: value.name,
    arguments: typeof args === 'object' && args !== null ? args as Record<string, unknown> : {},
  }
}

function extractToolCallsFromParsed(parsed: unknown): ParsedToolCall[] | null {
  if (Array.isArray(parsed)) {
    const calls = parsed.filter(isParsedToolCall)
    return calls.length > 0 ? calls.map(normalizeToolCall) : null
  }
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as { tool_calls?: unknown; name?: unknown; arguments?: unknown }
    if (Array.isArray(obj.tool_calls)) {
      const calls = obj.tool_calls.filter(isParsedToolCall)
      return calls.length > 0 ? calls.map(normalizeToolCall) : null
    }
    if (isParsedToolCall(obj)) {
      return [normalizeToolCall(obj)]
    }
  }
  return null
}

export function parsePromptedToolCalls(text: string): ParsedToolResponse {
  const allCalls: ParsedToolCall[] = []
  let remainingText = text
  let matchedAnyFence = false

  for (const match of text.matchAll(FENCE_RE)) {
    try {
      const parsed = JSON.parse(match[1].trim())
      // Any fence containing valid JSON is treated as machine-directed output and
      // stripped from the text shown to the reader, even if it doesn't match the
      // tool-call shape (e.g. an unrelated example/sample JSON block).
      remainingText = remainingText.replace(match[0], '')
      matchedAnyFence = true
      const calls = extractToolCallsFromParsed(parsed)
      if (calls) {
        allCalls.push(...calls)
      }
    } catch {
      // Not valid JSON — ignore this fence, leave it in remainingText.
    }
  }

  if (!matchedAnyFence) {
    try {
      const parsed = JSON.parse(text.trim())
      const calls = extractToolCallsFromParsed(parsed)
      if (calls) {
        return { toolCalls: calls, remainingText: '' }
      }
    } catch {
      // Not raw JSON either — fall through, treat as plain text.
    }
  }

  return { toolCalls: allCalls, remainingText: remainingText.trim() }
}

function describeToolDefinition(tool: ToolDefinition): string {
  const params = tool.function.parameters as { properties?: Record<string, unknown>; required?: string[] } | undefined
  const propNames = params?.properties ? Object.keys(params.properties) : []
  const required = new Set(params?.required ?? [])
  const argList = propNames.map((name) => (required.has(name) ? name : `${name}?`)).join(', ')
  return `- ${tool.function.name}(${argList}) — ${tool.function.description}`
}

export function buildPromptedToolSystemAddendum(tools: ToolDefinition[]): string {
  const toolLines = tools.map(describeToolDefinition).join('\n')
  return [
    `${ADDENDUM_MARKER}. Instead, when you need to use a tool, respond with ONLY a single fenced`,
    'JSON code block tagged json in this exact format and nothing else (no prose before or after):',
    '',
    '```json',
    '{ "tool_calls": [ { "name": "<tool_name>", "arguments": { ... } } ] }',
    '```',
    '',
    'Available tools:',
    toolLines,
    '',
    'Rules:',
    '- Emit at most one JSON tool-call block per response. Wait for the result before calling another tool.',
    '- If you do NOT need a tool, answer normally in plain Markdown text — do not emit a JSON block.',
    '- Never invent tool results. Never wrap the JSON block in extra prose.',
    '- If you have enough information, stop calling tools and write the final Markdown investigation report directly.',
    '- If a tool keeps failing or is unavailable, stop calling it and say so in your final report — do not try alternative tools that were not offered to you, and do not treat a failed tool call as license to invent findings.',
    '- Your final answer (the plain Markdown report) must start with exactly one `---`-delimited YAML front matter block as the very first thing in the response — never prefixed by prose, never repeated later in the response, and never additionally restated inside a ```yaml fenced block.',
  ].join('\n')
}

export function injectPromptedToolSystemPrompt(messages: ProviderMessage[], tools: ToolDefinition[]): ProviderMessage[] {
  const addendum = buildPromptedToolSystemAddendum(tools)
  if (messages.length > 0 && messages[0].role === 'system') {
    const existing = messages[0].content as string
    if (existing.includes(ADDENDUM_MARKER)) return messages
    messages[0] = { role: 'system', content: `${existing}\n\n${addendum}` }
    return messages
  }
  return [{ role: 'system', content: addendum }, ...messages]
}

export function createPromptedToolCaller(
  provider: ProviderName,
  apiKey: string | null,
  model: string,
  options: { maxTokens?: number; temperature?: number } = {},
): ModelToolCaller {
  return async (messages) => {
    const result = await sendProviderWithTools(provider, apiKey, model, messages, [], 'none', options)
    const text = result.content ?? ''
    const parsed = parsePromptedToolCalls(text)
    if (parsed.toolCalls.length === 0) {
      return { content: parsed.remainingText, toolCalls: [], model: result.model }
    }
    return {
      content: parsed.remainingText || null,
      toolCalls: parsed.toolCalls.map((call) => ({
        id: randomUUID(),
        name: call.name,
        arguments: call.arguments,
      })),
      model: result.model,
    }
  }
}
