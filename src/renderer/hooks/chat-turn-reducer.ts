import type { ChatTurnEvent } from '../../shared/chat-turn-types'
import type { CliCostSummary, StreamError } from './chat-types'

export type ChatTurnStatus = 'idle' | 'active' | 'streaming' | 'completed' | 'failed'

export interface ChatTurnThinkingBlock {
  blockId: string
  content: string
  done: boolean
}

export interface ChatTurnToolCall {
  id?: string
  toolName: string
  serverName?: string
  args?: Record<string, unknown>
  result: string
  success: boolean
  resultImages?: { dataUrl: string }[]
}

export interface ChatTurnActivity {
  state: string
  label: string
  toolName?: string
  serverName?: string
}

export interface ChatTurnState {
  conversationId: string | null
  turnId: string | null
  lastSequence: number
  status: ChatTurnStatus
  text: string
  thinkingBlocks: Map<string, ChatTurnThinkingBlock>
  pendingThinkingEnds: Set<string>
  toolCalls: ChatTurnToolCall[]
  activity: ChatTurnActivity | null
  cost: CliCostSummary | null
  model: string | null
  error: StreamError | null
}

export function createEmptyChatTurnState(conversationId: string | null = null): ChatTurnState {
  return {
    conversationId,
    turnId: null,
    lastSequence: 0,
    status: 'idle',
    text: '',
    thinkingBlocks: new Map(),
    pendingThinkingEnds: new Set(),
    toolCalls: [],
    activity: null,
    cost: null,
    model: null,
    error: null,
  }
}

export function chatTurnReducer(state: ChatTurnState, event: ChatTurnEvent): ChatTurnState {
  if (state.conversationId && event.conversationId !== state.conversationId) return state

  if (event.type === 'turn_started') {
    return {
      ...createEmptyChatTurnState(event.conversationId),
      turnId: event.turnId,
      lastSequence: event.sequence,
      status: 'active',
    }
  }

  if (state.turnId && event.turnId !== state.turnId) return state
  if (event.sequence <= state.lastSequence) return state

  const base = {
    ...state,
    conversationId: event.conversationId,
    turnId: event.turnId,
    lastSequence: event.sequence,
  }

  switch (event.type) {
    case 'user_message_committed':
      return { ...base, status: 'active' }

    case 'assistant_text_delta':
      return { ...base, status: 'streaming', text: state.text + event.chunk }

    case 'thinking_delta': {
      const existing = state.thinkingBlocks.get(event.blockId) ?? {
        blockId: event.blockId,
        content: '',
        done: false,
      }
      const pendingThinkingEnds = new Set(state.pendingThinkingEnds)
      const done = existing.done || pendingThinkingEnds.delete(event.blockId)
      const thinkingBlocks = new Map(state.thinkingBlocks).set(event.blockId, {
        ...existing,
        content: existing.content + event.chunk,
        done,
      })
      return { ...base, thinkingBlocks, pendingThinkingEnds }
    }

    case 'thinking_done': {
      const existing = state.thinkingBlocks.get(event.blockId)
      if (!existing) {
        return {
          ...base,
          pendingThinkingEnds: new Set(state.pendingThinkingEnds).add(event.blockId),
        }
      }
      return {
        ...base,
        thinkingBlocks: new Map(state.thinkingBlocks).set(event.blockId, { ...existing, done: true }),
      }
    }

    case 'tool_started':
      return {
        ...base,
        status: 'active',
        activity: {
          state: 'tool',
          label: `Running ${event.name}`,
          toolName: event.name,
          serverName: event.serverName,
        },
      }

    case 'tool_finished':
      return {
        ...base,
        status: 'active',
        toolCalls: upsertToolCall(state.toolCalls, {
          id: event.id,
          toolName: event.toolName,
          serverName: event.serverName,
          args: event.args,
          result: event.result,
          success: event.success,
          resultImages: event.resultImages,
        }),
      }

    case 'activity_changed':
      return {
        ...base,
        activity: {
          state: event.state,
          label: event.label,
          toolName: event.toolName,
          serverName: event.serverName,
        },
      }

    case 'cost_updated':
      return {
        ...base,
        cost: {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          totalCostUsd: event.totalCostUsd,
        },
      }

    case 'model_changed':
      return { ...base, model: event.model }

    case 'turn_completed':
      return {
        ...base,
        status: 'completed',
        thinkingBlocks: markThinkingDone(state.thinkingBlocks),
        pendingThinkingEnds: new Set(),
      }

    case 'turn_failed':
      return {
        ...base,
        status: 'failed',
        thinkingBlocks: markThinkingDone(state.thinkingBlocks),
        pendingThinkingEnds: new Set(),
        error: {
          type: event.errorType,
          message: event.message,
          retryable: event.retryable,
          retryAfterSeconds: event.retryAfterSeconds,
        },
      }

    case 'history_snapshot_received':
      return base
  }
}

function markThinkingDone(blocks: Map<string, ChatTurnThinkingBlock>): Map<string, ChatTurnThinkingBlock> {
  if (blocks.size === 0) return blocks
  return new Map(Array.from(blocks.entries()).map(([id, block]) => [id, { ...block, done: true }]))
}

function upsertToolCall(toolCalls: ChatTurnToolCall[], next: ChatTurnToolCall): ChatTurnToolCall[] {
  if (!next.id) return [...toolCalls, next]
  const index = toolCalls.findIndex((toolCall) => toolCall.id === next.id)
  if (index === -1) return [...toolCalls, next]
  const updated = [...toolCalls]
  updated[index] = next
  return updated
}
