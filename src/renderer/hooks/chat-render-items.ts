import type { ChatMessage } from './chat-types'
import type { ChatTurnState, ChatTurnThinkingBlock, ChatTurnToolCall } from './chat-turn-reducer'

export type ChatRenderItem =
  | { type: 'historical-message'; id: string; message: ChatMessage; index: number }
  | { type: 'historical-tool-group'; id: string; message: ChatMessage; toolCalls: ChatMessage[]; index: number }
  | { type: 'live-thinking-block'; id: string; block: ChatTurnThinkingBlock }
  | { type: 'live-tool-call'; id: string; toolCall: ChatTurnToolCall }
  | { type: 'live-assistant-text'; id: string; text: string; model: string | null }
  | { type: 'live-activity'; id: string; label: string; state: string; toolName?: string; serverName?: string }

export function buildChatRenderItems(
  messages: ChatMessage[],
  liveTurnState: ChatTurnState,
  options: { includeLiveTurn?: boolean } = {},
): ChatRenderItem[] {
  const items: ChatRenderItem[] = []
  const includeLiveTurn = options.includeLiveTurn ?? true
  const committedThinkingBlockIds = new Set<string>()
  const committedToolCallIds = new Set<string>()
  let pendingToolCalls: ChatMessage[] = []

  messages.forEach((message, index) => {
    if (message.role === 'assistant' && message.thinkingBlocks) {
      for (const blockId of message.thinkingBlocks.keys()) committedThinkingBlockIds.add(blockId)
    }
    if (message.role === 'tool-call') {
      pendingToolCalls.push(message)
      if (message.toolCallId) committedToolCallIds.add(message.toolCallId)
      return
    }

    const orderedToolCalls = pendingToolCalls.filter(
      (toolCall) => message.role !== 'assistant' || toolCall.timestamp <= message.timestamp,
    )
    const unorderedToolCalls = pendingToolCalls.filter(
      (toolCall) => message.role === 'assistant' && toolCall.timestamp > message.timestamp,
    )

    if (orderedToolCalls.length > 0) {
      items.push({
        type: 'historical-tool-group',
        id: message.id,
        message,
        toolCalls: orderedToolCalls,
        index,
      })
    } else {
      items.push({ type: 'historical-message', id: message.id, message, index })
    }

    for (const toolCall of unorderedToolCalls) {
      items.push({ type: 'historical-message', id: toolCall.id, message: toolCall, index })
    }
    pendingToolCalls = []
  })

  for (const toolCall of pendingToolCalls) {
    items.push({ type: 'historical-message', id: toolCall.id, message: toolCall, index: messages.length })
    if (toolCall.toolCallId) committedToolCallIds.add(toolCall.toolCallId)
  }

  if (!includeLiveTurn || liveTurnState.status === 'idle') return items

  for (const block of liveTurnState.thinkingBlocks.values()) {
    if (!committedThinkingBlockIds.has(block.blockId)) {
      items.push({ type: 'live-thinking-block', id: `live-thinking-${block.blockId}`, block })
    }
  }

  liveTurnState.toolCalls.forEach((toolCall, index) => {
    if (!toolCall.id || !committedToolCallIds.has(toolCall.id)) {
      items.push({ type: 'live-tool-call', id: toolCall.id ?? `live-tool-${index}`, toolCall })
    }
  })

  if (liveTurnState.text) {
    items.push({
      type: 'live-assistant-text',
      id: `live-text-${liveTurnState.turnId ?? 'unknown'}`,
      text: liveTurnState.text,
      model: liveTurnState.model,
    })
  } else if (liveTurnState.activity && liveTurnState.status !== 'completed' && liveTurnState.status !== 'failed') {
    items.push({
      type: 'live-activity',
      id: `live-activity-${liveTurnState.turnId ?? 'unknown'}`,
      label: liveTurnState.activity.label,
      state: liveTurnState.activity.state,
      toolName: liveTurnState.activity.toolName,
      serverName: liveTurnState.activity.serverName,
    })
  }

  return items
}
