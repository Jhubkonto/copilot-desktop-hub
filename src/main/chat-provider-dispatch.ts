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
import type { ToolDefinition } from './provider-types'
import type { InlineHandler, MobileChatActivity } from './chat-context-builder'

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
  generationOptions: { temperature: number; maxTokens: number }
  conversationId: string
  webContents: WebContents
  sendChunk: (chunk: string) => void
  sendActivity: (a: MobileChatActivity) => void
  onModel?: (model: string) => void
  systemPrompt: string
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
  } = opts

  const hasToolLoop = toolDefs.length > 0
  const inlineHandlers = wikiInlineHandlers.size > 0 ? wikiInlineHandlers : undefined
  const agentId = effectiveAgentId ?? 'default'
  const onActivity = makeActivityHandler(sendActivity)

  if (providerName === 'anthropic') {
    if (hasToolLoop) {
      return runProviderMcpToolLoop(
        (msgs, tools, choice) =>
          sendAnthropicWithTools(byokKey, providerModel, msgs, tools ?? [], choice, generationOptions),
        chatMessages,
        toolDefs,
        toolMap,
        agentId,
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
      generationOptions,
    )
  }

  if (providerName === 'openai') {
    if (hasToolLoop) {
      return runProviderMcpToolLoop(
        (msgs, tools, choice) =>
          sendOpenAIWithTools(byokKey, providerModel, msgs, tools ?? [], choice, generationOptions),
        chatMessages,
        toolDefs,
        toolMap,
        agentId,
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
    return sendOpenAIMessage(conversationId, byokKey, providerModel, chatMessages, sendChunk, generationOptions)
  }

  // OpenAI-compatible providers (OpenRouter, Groq, Mistral, Gemini, xAI)
  const openAiCompatible = ['openrouter', 'groq', 'mistral', 'gemini', 'xai']
  if (openAiCompatible.includes(providerName)) {
    const providerCfg = PROVIDERS.find((p) => p.name === providerName)
    const baseUrl = providerCfg?.baseUrl
    if (hasToolLoop) {
      return runProviderMcpToolLoop(
        (msgs, tools, choice) =>
          sendOpenAIWithTools(byokKey, providerModel, msgs, tools ?? [], choice, generationOptions, baseUrl),
        chatMessages,
        toolDefs,
        toolMap,
        agentId,
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
    return sendOpenAIMessage(
      conversationId,
      byokKey,
      providerModel,
      chatMessages,
      sendChunk,
      generationOptions,
      baseUrl,
    )
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
      toolDefs,
      toolMap,
      agentId,
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
