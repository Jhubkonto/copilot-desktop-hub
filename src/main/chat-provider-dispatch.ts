import type { WebContents } from 'electron'
import {
  PROVIDERS,
  sendOpenAIMessage,
  sendOpenAIWithTools,
  sendAnthropicMessage,
  sendAnthropicWithTools,
  sendAzureMessage,
  sendAzureWithTools,
  getAzureEndpoint,
  type ProviderMessage,
} from './providers'
import { runProviderMcpToolLoop } from './tool-loop'
import type { ToolDefinition, ToolChoice, ProviderNonStreamResult } from './provider-types'
import type { InlineHandler, MobileChatActivity } from './chat-context-builder'
import type { MessageContentPart } from './provider-core-types'
import { modelIdSupportsTools } from '../shared/models'
import { getCachedCatalog } from './model-catalog'

function stripImageParts(msgs: ProviderMessage[]): ProviderMessage[] {
  return msgs.map((msg) => {
    if (msg.role === 'tool' || !Array.isArray(msg.content)) return msg
    const textOnly = (msg.content as MessageContentPart[]).filter((p) => p.type !== 'image_url')
    return { ...msg, content: textOnly.length > 0 ? textOnly : '' } as ProviderMessage
  })
}

export type ProviderDispatchOptions = {
  providerName: string
  providerModel: string
  byokKey: string
  chatMessages: ProviderMessage[]
  toolDefs: ToolDefinition[]
  toolMap: Map<string, { serverId: string; toolName: string }>
  effectiveAgentId: string | null
  agenticMode: boolean
  wikiInlineHandlers: Map<string, InlineHandler>
  toolDirective: string
  generationOptions: { temperature: number; maxTokens: number; thinkingEffort?: string }
  conversationId: string
  webContents: WebContents
  sendChunk: (chunk: string) => void
  sendActivity: (a: MobileChatActivity) => void
  onModel?: (model: string) => void
  systemPrompt: string
  onThinkingChunk?: (blockId: string, chunk: string) => void
  onThinkingEnd?: (blockId: string) => void
}

function makeActivityHandler(sendActivity: (a: MobileChatActivity) => void) {
  return (event: { type: 'thinking' } | { type: 'tool'; name: string; server: string }) => {
    if (event.type === 'tool') {
      sendActivity({ state: 'tool', label: `Running ${event.name}`, toolName: event.name, serverName: event.server })
    } else {
      sendActivity({ state: 'thinking', label: 'Thinking' })
    }
  }
}

export async function dispatchToProvider(opts: ProviderDispatchOptions): Promise<string> {
  const {
    providerName,
    providerModel,
    byokKey,
    chatMessages,
    toolDefs,
    toolMap,
    effectiveAgentId,
    agenticMode,
    wikiInlineHandlers,
    toolDirective,
    generationOptions,
    conversationId,
    webContents,
    sendChunk,
    sendActivity,
    onModel,
    systemPrompt,
    onThinkingChunk: callerOnThinkingChunk,
    onThinkingEnd: callerOnThinkingEnd,
  } = opts

  const catalog = getCachedCatalog()
  const catalogEntry = catalog.find((m) => m.id === providerModel)
  let toolsSupported: boolean
  if (providerName !== 'openrouter') {
    toolsSupported = modelIdSupportsTools(providerModel, catalog)
  } else if (catalogEntry) {
    toolsSupported = catalogEntry.capabilities.length === 0 || catalogEntry.capabilities.includes('tool_calls')
  } else {
    // No catalog hit: strip ~ routing prefix and check known-capable families.
    // hermes, nous, etc. won't match → conservative (no tools).
    // claude, gpt-4, gemini, etc. will match → optimistic (tools enabled).
    const id = providerModel.toLowerCase().replace(/^~/, '')
    const TOOL_CAPABLE_FAMILIES = ['claude', 'gpt-4', 'gpt-4o', 'gemini', 'mistral-large', 'llama-3', 'qwen']
    toolsSupported = TOOL_CAPABLE_FAMILIES.some((family) => id.includes(family))
  }
  const effectiveToolDefs = toolsSupported ? toolDefs : []
  const hasToolLoop = effectiveToolDefs.length > 0
  const inlineHandlers = wikiInlineHandlers.size > 0 ? wikiInlineHandlers : undefined
  const agentId = effectiveAgentId ?? 'default'
  const onActivity = makeActivityHandler(sendActivity)

  const thinkingCallbacks = {
    onThinkingChunk: (blockId: string, chunk: string) => {
      webContents.send('chat:thinking-delta', { blockId, chunk })
      callerOnThinkingChunk?.(blockId, chunk)
    },
    onThinkingEnd: (blockId: string) => {
      webContents.send('chat:thinking-end', { blockId })
      callerOnThinkingEnd?.(blockId)
    },
  }

  if (providerName === 'anthropic') {
    if (hasToolLoop) {
      return runProviderMcpToolLoop(
        (msgs, tools, choice) =>
          sendAnthropicWithTools(byokKey, providerModel, msgs, tools ?? [], choice, { ...generationOptions, ...thinkingCallbacks }),
        chatMessages,
        effectiveToolDefs,
        toolMap,
        agentId,
        conversationId,
        webContents,
        sendChunk,
        undefined,
        agenticMode,
        inlineHandlers,
        toolDirective,
        onActivity,
      )
    }
    sendActivity({ state: 'thinking', label: 'Generating response' })
    return sendAnthropicMessage(
      conversationId,
      byokKey,
      providerModel,
      chatMessages.slice(1),
      systemPrompt,
      sendChunk,
      { ...generationOptions, ...thinkingCallbacks },
    )
  }

  if (providerName === 'openai') {
    if (hasToolLoop) {
      return runProviderMcpToolLoop(
        (msgs, tools, choice) =>
          sendOpenAIWithTools(byokKey, providerModel, msgs, tools ?? [], choice, generationOptions),
        chatMessages,
        effectiveToolDefs,
        toolMap,
        agentId,
        conversationId,
        webContents,
        sendChunk,
        onModel,
        agenticMode,
        inlineHandlers,
        toolDirective,
        onActivity,
      )
    }
    sendActivity({ state: 'thinking', label: 'Generating response' })
    return sendOpenAIMessage(conversationId, byokKey, providerModel, chatMessages, sendChunk, {
      ...generationOptions,
      ...thinkingCallbacks,
    })
  }

  // OpenAI-compatible providers (OpenRouter, Groq, Mistral, Gemini, xAI)
  const openAiCompatible = ['openrouter', 'groq', 'mistral', 'gemini', 'xai']
  if (openAiCompatible.includes(providerName)) {
    const providerCfg = PROVIDERS.find((p) => p.name === providerName)
    const baseUrl = providerCfg?.baseUrl
    if (hasToolLoop) {
      // Some OpenRouter models don't support tool use or image input. If the
      // first call fails with those specific errors, retry gracefully so the
      // user gets a response instead of a hard failure.
      const caller = async (msgs: ProviderMessage[], tools: ToolDefinition[] | undefined, choice: ToolChoice): Promise<ProviderNonStreamResult> => {
        try {
          return await sendOpenAIWithTools(byokKey, providerModel, msgs, tools ?? [], choice, generationOptions, baseUrl)
        } catch (err) {
          if (!(err instanceof Error)) throw err
          if (err.message.includes('No endpoints found that support tool use')) {
            const text = await sendOpenAIMessage(conversationId, byokKey, providerModel, msgs, sendChunk, generationOptions, baseUrl)
            return { content: text, toolCalls: [] }
          }
          if (err.message.includes('No endpoints found that support image input')) {
            const text = await sendOpenAIMessage(conversationId, byokKey, providerModel, stripImageParts(msgs), sendChunk, generationOptions, baseUrl)
            return { content: text, toolCalls: [] }
          }
          throw err
        }
      }
      return runProviderMcpToolLoop(
        caller,
        chatMessages,
        effectiveToolDefs,
        toolMap,
        agentId,
        conversationId,
        webContents,
        sendChunk,
        onModel,
        agenticMode,
        inlineHandlers,
        toolDirective,
        onActivity,
      )
    }
    sendActivity({ state: 'thinking', label: 'Generating response' })
    try {
      return await sendOpenAIMessage(conversationId, byokKey, providerModel, chatMessages, sendChunk, {
        ...generationOptions,
        ...thinkingCallbacks,
      }, baseUrl)
    } catch (err) {
      if (err instanceof Error && err.message.includes('No endpoints found that support image input')) {
        return sendOpenAIMessage(conversationId, byokKey, providerModel, stripImageParts(chatMessages), sendChunk, generationOptions, baseUrl)
      }
      throw err
    }
  }

  // Azure
  const azureEndpoint = getAzureEndpoint()
  if (!azureEndpoint) {
    throw new Error('Azure endpoint not configured')
  }
  if (hasToolLoop) {
    return runProviderMcpToolLoop(
      (msgs, tools, choice) =>
        sendAzureWithTools(byokKey, azureEndpoint, providerModel, msgs, tools ?? [], choice, generationOptions),
      chatMessages,
      effectiveToolDefs,
      toolMap,
      agentId,
      conversationId,
      webContents,
      sendChunk,
      onModel,
      agenticMode,
      inlineHandlers,
      toolDirective,
      onActivity,
    )
  }
  sendActivity({ state: 'thinking', label: 'Generating response' })
  return sendAzureMessage(
    conversationId,
    byokKey,
    azureEndpoint,
    providerModel,
    chatMessages,
    sendChunk,
    generationOptions,
  )
}
