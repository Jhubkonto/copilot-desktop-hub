import type { ChatMessage } from './chat-types'
import type { ChatTurnState, ChatTurnThinkingBlock, ChatTurnToolCall } from './chat-turn-reducer'

export type ChatRenderItem =
  | { type: 'historical-message'; id: string; message: ChatMessage; index: number }
  | { type: 'historical-tool-group'; id: string; message: ChatMessage; toolCalls: ChatMessage[]; index: number }
  | { type: 'live-thinking-block'; id: string; block: ChatTurnThinkingBlock }
  | { type: 'live-tool-call'; id: string; toolCall: ChatTurnToolCall }
  | { type: 'live-text-segment'; id: string; text: string }
  | { type: 'live-assistant-text'; id: string; text: string; model: string | null }
  | { type: 'live-activity'; id: string; label: string; state: string; toolName?: string; serverName?: string }

export function buildChatRenderItems(
  messages: ChatMessage[],
  liveTurnState: ChatTurnState,
  options: { includeLiveTurn?: boolean } = {},
): ChatRenderItem[] {
  const items: ChatRenderItem[] = []
  const includeLiveTurn = options.includeLiveTurn ?? true
  // blockId -> content. thinking-N / text-N blockIds reset to 0 for every new CLI
  // process — they're only unique WITHIN a turn, not across the whole conversation, so
  // a long conversation will often already have an unrelated older message with a
  // 'thinking-0'/'text-0' entry. Matching on blockId alone would make this fresh live
  // turn's own text-0 look already-committed (wrongly dropping it from the live render)
  // purely by numeric coincidence. Requiring the CONTENT to match too is what actually
  // distinguishes "this live block is the just-persisted version of itself" (content
  // identical) from "this is a same-numbered block from a completely different turn"
  // (content differs) — real tool-call ids don't need this since they're globally unique.
  const committedThinkingBlocks = new Map<string, string>()
  const committedTextSegments = new Map<string, string>()
  const committedToolCallIds = new Set<string>()
  let pendingToolCalls: ChatMessage[] = []

  messages.forEach((message, index) => {
    if (message.role === 'assistant' && message.thinkingBlocks) {
      for (const [blockId, block] of message.thinkingBlocks) committedThinkingBlocks.set(blockId, block.content)
    }
    if (message.role === 'assistant' && message.textSegments) {
      for (const [blockId, block] of message.textSegments) committedTextSegments.set(blockId, block.content)
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

  // Thinking blocks, text segments, and tool calls are separate collections in
  // ChatTurnState (two Maps and an array), each only ordered relative to its own type.
  // Interleave them by firstSeenSequence so a chronologically later tool call doesn't
  // get pushed below a block that actually happened first, or vice versa — ties (e.g.
  // state built by hand without sequence numbers) fall back to this push order via a
  // stable sort. The still-open segment (if any — found via `done`, NOT "whichever is
  // last in the map", since a lead-in segment that already closed can still be the only
  // entry so far and must not be mistaken for the one currently being written) is
  // excluded here and becomes the trailing live-assistant-text item below instead,
  // reveal-animated the same way the whole reply used to be before it was split.
  const textBlockValues = Array.from(liveTurnState.textBlocks.values())
  const openTextBlockId = textBlockValues.find((block) => !block.done)?.blockId ?? null

  const liveThinkingAndTools: Array<
    | { type: 'live-thinking-block'; id: string; block: ChatTurnThinkingBlock; seq: number }
    | { type: 'live-tool-call'; id: string; toolCall: ChatTurnToolCall; seq: number }
    | { type: 'live-text-segment'; id: string; block: ChatTurnThinkingBlock; seq: number }
  > = []

  for (const block of liveTurnState.thinkingBlocks.values()) {
    if (committedThinkingBlocks.get(block.blockId) !== block.content) {
      liveThinkingAndTools.push({
        type: 'live-thinking-block',
        id: `live-thinking-${block.blockId}`,
        block,
        seq: block.firstSeenSequence ?? 0,
      })
    }
  }

  for (const block of textBlockValues) {
    if (block.blockId === openTextBlockId) continue
    if (!block.content) continue
    if (committedTextSegments.get(block.blockId) === block.content) continue
    liveThinkingAndTools.push({
      type: 'live-text-segment',
      id: `live-text-segment-${block.blockId}`,
      block,
      seq: block.firstSeenSequence ?? 0,
    })
  }

  liveTurnState.toolCalls.forEach((toolCall, index) => {
    if (!toolCall.id || !committedToolCallIds.has(toolCall.id)) {
      liveThinkingAndTools.push({
        type: 'live-tool-call',
        id: toolCall.id ?? `live-tool-${index}`,
        toolCall,
        seq: toolCall.firstSeenSequence ?? 0,
      })
    }
  })

  liveThinkingAndTools.sort((a, b) => a.seq - b.seq)
  for (const item of liveThinkingAndTools) {
    if (item.type === 'live-thinking-block') {
      items.push({ type: 'live-thinking-block', id: item.id, block: item.block })
    } else if (item.type === 'live-text-segment') {
      items.push({ type: 'live-text-segment', id: item.id, text: item.block.content })
    } else {
      items.push({ type: 'live-tool-call', id: item.id, toolCall: item.toolCall })
    }
  }

  // The still-open trailing segment; for backends that don't tag chunks with a blockId
  // at all (textBlockValues empty), the whole flat cumulative text; if every segment
  // recorded so far has already closed (the model is between text and its next tool
  // call, nothing is currently being written), there's no trailing text at all — the
  // activity indicator below takes over instead.
  const trailingText = openTextBlockId
    ? liveTurnState.textBlocks.get(openTextBlockId)?.content ?? ''
    : textBlockValues.length === 0 ? liveTurnState.text : ''

  if (trailingText) {
    items.push({
      type: 'live-assistant-text',
      id: `live-text-${liveTurnState.turnId ?? 'unknown'}`,
      text: trailingText,
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

  // Only the live-turn call site is worth tracing here — msgGroups' includeLiveTurn:false
  // call recomputes on every message change too, and would drown this out.
  if (includeLiveTurn) logRenderOrderIfChanged(liveTurnState.turnId, items)
  return items
}

// Always-on (no debug toggle needed), throttled to only fire when the item TYPE
// sequence actually changes — token-by-token content growth doesn't re-log. Exists so a
// misordering can be diagnosed straight from the DevTools console (`[render-order]`)
// without needing to enable Settings > Developer > Debug logging and correlate raw
// [chat-turn] events by hand.
const lastLoggedOrderByTurn = new Map<string, string>()
function logRenderOrderIfChanged(turnId: string | null, items: ChatRenderItem[]): void {
  const key = turnId ?? 'unknown'
  const summary = items.map(describeRenderItemForLog).join(' -> ')
  if (lastLoggedOrderByTurn.get(key) === summary) return
  lastLoggedOrderByTurn.set(key, summary)
  console.debug(`[render-order] turn=${key}\n  ${summary}`)
}

function describeRenderItemForLog(item: ChatRenderItem): string {
  const preview = (text: string, max = 24) => {
    const flat = text.replace(/\s+/g, ' ').trim()
    return flat.length > max ? `${flat.slice(0, max)}…` : flat
  }
  switch (item.type) {
    case 'historical-message':
      return `hist(${item.message.role}:"${preview(item.message.content)}")`
    case 'historical-tool-group':
      return `hist-group(${item.toolCalls.length} tools + ${item.message.role}:"${preview(item.message.content)}")`
    case 'live-thinking-block':
      return `thinking("${preview(item.block.content)}")`
    case 'live-text-segment':
      return `text-seg("${preview(item.text)}")`
    case 'live-tool-call':
      return `tool(${item.toolCall.toolName}${item.toolCall.inProgress ? '…' : ''})`
    case 'live-assistant-text':
      return `live-text("${preview(item.text)}")`
    case 'live-activity':
      return `activity(${item.label})`
  }
}
