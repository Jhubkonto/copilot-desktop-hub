import { httpsRequestUrl, providerHttpError } from './http-client'
import { resolveProviderCredentialInput, type ProviderCredentialInput } from './credential-vault'
import type { ProviderMessage } from './provider-core-types'
import type { ToolDefinition } from './provider-types'
import { toAnthropicMessages, toOpenAICompatibleMessages } from './provider-messages'
import { toAnthropicTools } from './providers/anthropic-provider'
import type { TokenCount } from '../shared/token-usage'
import { abortActiveStream } from './provider-stream-state'

export interface CountOptions {
  providerName: string
  model: string
  credential: ProviderCredentialInput
  messages: ProviderMessage[]
  tools: ToolDefinition[]
  conversationId?: string
}

function jsonHeaders(headers: Record<string, string>, body: string): Record<string, string> {
  return { ...headers, 'Content-Length': String(Buffer.byteLength(body)) }
}

async function countAnthropic(opts: CountOptions): Promise<TokenCount | null> {
  const key = resolveProviderCredentialInput(opts.credential)
  const { system, messages } = toAnthropicMessages(opts.messages)
  const { tools } = toAnthropicTools(opts.tools)
  const body = JSON.stringify({ model: opts.model, ...(system ? { system } : {}), messages, ...(tools.length ? { tools } : {}) })
  const response = await httpsRequestUrl('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: jsonHeaders({ 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body),
  }, body, opts.conversationId)
  if (response.status >= 400) throw providerHttpError('Anthropic token count', response.status, response.data)
  const parsed = JSON.parse(response.data) as { input_tokens?: number }
  return typeof parsed.input_tokens === 'number' ? { inputTokens: parsed.input_tokens, quality: 'provider', source: 'anthropic', model: opts.model } : null
}

async function countOpenAI(opts: CountOptions): Promise<TokenCount | null> {
  const key = resolveProviderCredentialInput(opts.credential)
  const body = JSON.stringify({ model: opts.model, input: toOpenAICompatibleMessages(opts.messages), ...(opts.tools.length ? { tools: opts.tools } : {}) })
  const response = await httpsRequestUrl('https://api.openai.com/v1/responses/input_tokens', {
    method: 'POST',
    headers: jsonHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body),
  }, body, opts.conversationId)
  if (response.status >= 400) throw providerHttpError('OpenAI token count', response.status, response.data)
  const parsed = JSON.parse(response.data) as { input_tokens?: number }
  return typeof parsed.input_tokens === 'number' ? { inputTokens: parsed.input_tokens, quality: 'provider', source: 'openai', model: opts.model } : null
}

async function countGemini(opts: CountOptions): Promise<TokenCount | null> {
  const key = resolveProviderCredentialInput(opts.credential)
  const system = opts.messages.find((message) => message.role === 'system')
  const contents = opts.messages.filter((message) => message.role !== 'system').map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) }],
  }))
  const body = JSON.stringify({
    ...(system ? { systemInstruction: { parts: [{ text: typeof system.content === 'string' ? system.content : JSON.stringify(system.content) }] } } : {}),
    contents,
    ...(opts.tools.length ? { tools: [{ functionDeclarations: opts.tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters })) }] } : {}),
  })
  const response = await httpsRequestUrl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:countTokens?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: jsonHeaders({ 'Content-Type': 'application/json' }, body),
  }, body, opts.conversationId)
  if (response.status >= 400) throw providerHttpError('Gemini token count', response.status, response.data)
  const parsed = JSON.parse(response.data) as { totalTokens?: number }
  return typeof parsed.totalTokens === 'number' ? { inputTokens: parsed.totalTokens, quality: 'provider', source: 'gemini', model: opts.model } : null
}

/** Best-effort preflight count. Unsupported/failed endpoints intentionally return null. */
export async function countProviderInputTokens(opts: CountOptions): Promise<TokenCount | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const task = opts.providerName === 'anthropic' ? countAnthropic(opts) : opts.providerName === 'openai' ? countOpenAI(opts) : opts.providerName === 'gemini' ? countGemini(opts) : Promise.resolve(null)
    return await Promise.race([task, new Promise<null>((_, reject) => { timer = setTimeout(() => reject(new Error('token preflight timed out')), 1_500) })])
  } catch {
    if (opts.conversationId) abortActiveStream(opts.conversationId)
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}
