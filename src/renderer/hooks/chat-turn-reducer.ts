import type { ChatTurnEvent, UserInputAnswer, UserInputRequest } from '../../shared/chat-turn-types'
import type { CliCostSummary, StreamError } from './chat-types'

export type ChatTurnStatus = 'idle' | 'active' | 'streaming' | 'completed' | 'failed'

export interface ChatTurnThinkingBlock {
  blockId: string
  content: string
  done: boolean
  // The sequence number of the event that first created this block — lets render
  // code interleave thinking blocks and tool calls in true chronological order
  // instead of grouping all of one type before the other. Optional so state built
  // by hand (e.g. tests) doesn't need to supply it; ties fall back to insertion order.
  firstSeenSequence?: number
}

export interface ChatTurnToolCall {
  id?: string
  toolName: string
  serverName?: string
  args?: Record<string, unknown>
  result: string
  success: boolean
  resultImages?: { dataUrl: string }[]
  inProgress?: boolean
  firstSeenSequence?: number
}

export interface ChatTurnActivity {
  state: string
  label: string
  toolName?: string
  serverName?: string
}

export interface ChatTurnUserInput {
  request: UserInputRequest
  status: 'pending' | 'resolved' | 'cancelled'
  answers?: UserInputAnswer[]
  reason?: string
  firstSeenSequence: number
}

export interface ChatTurnState {
  conversationId: string | null
  turnId: string | null
  lastSequence: number
  status: ChatTurnStatus
  text: string
  thinkingBlocks: Map<string, ChatTurnThinkingBlock>
  pendingThinkingEnds: Set<string>
  // Ordered response-text bursts, keyed by blockId — populated only when the backend
  // tags assistant_text_delta chunks with one (currently claude-cli). Empty for
  // backends that don't segment text; `text` (the flat cumulative string) always
  // reflects the full reply either way.
  textBlocks: Map<string, ChatTurnThinkingBlock>
  toolCalls: ChatTurnToolCall[]
  userInputs: Map<string, ChatTurnUserInput>
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
    textBlocks: new Map(),
    toolCalls: [],
    userInputs: new Map(),
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

    case 'assistant_text_delta': {
      if (!event.blockId) return { ...base, status: 'streaming', text: state.text + event.chunk }
      const existing = state.textBlocks.get(event.blockId) ?? {
        blockId: event.blockId,
        content: '',
        done: false,
        firstSeenSequence: event.sequence,
      }
      const textBlocks = new Map(state.textBlocks).set(event.blockId, {
        ...existing,
        content: existing.content + event.chunk,
      })
      return { ...base, status: 'streaming', text: state.text + event.chunk, textBlocks }
    }

    case 'text_segment_done': {
      const existing = state.textBlocks.get(event.blockId)
      if (!existing) return base
      return {
        ...base,
        textBlocks: new Map(state.textBlocks).set(event.blockId, { ...existing, done: true }),
      }
    }

    case 'thinking_delta': {
      const existing = state.thinkingBlocks.get(event.blockId) ?? {
        blockId: event.blockId,
        content: '',
        done: false,
        firstSeenSequence: event.sequence,
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
        toolCalls: upsertToolCall(state.toolCalls, {
          id: event.id,
          toolName: event.name,
          serverName: event.serverName,
          args: event.input,
          result: '',
          success: true,
          inProgress: true,
          firstSeenSequence: event.sequence,
        }),
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
          inProgress: false,
          firstSeenSequence: event.sequence,
        }),
      }

    case 'user_input_requested':
      return {
        ...base,
        status: 'active',
        userInputs: new Map(state.userInputs).set(event.request.requestId, {
          request: event.request,
          status: 'pending',
          firstSeenSequence: event.sequence,
        }),
        activity: { state: 'approval', label: 'Waiting for your answer' },
      }

    case 'user_input_resolved': {
      const existing = state.userInputs.get(event.requestId)
      if (!existing) return base
      return {
        ...base,
        userInputs: new Map(state.userInputs).set(event.requestId, {
          ...existing,
          status: 'resolved',
          answers: event.answers,
        }),
        activity: { state: 'thinking', label: 'Processing your answer' },
      }
    }

    case 'user_input_cancelled': {
      const existing = state.userInputs.get(event.requestId)
      if (!existing) return base
      return {
        ...base,
        userInputs: new Map(state.userInputs).set(event.requestId, {
          ...existing,
          status: 'cancelled',
          reason: event.reason,
        }),
      }
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
        textBlocks: markThinkingDone(state.textBlocks),
      }

    case 'turn_failed':
      return {
        ...base,
        status: 'failed',
        thinkingBlocks: markThinkingDone(state.thinkingBlocks),
        pendingThinkingEnds: new Set(),
        textBlocks: markThinkingDone(state.textBlocks),
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
  // Preserve the original firstSeenSequence (from tool_started) rather than
  // overwriting it with tool_finished's later sequence — it anchors this tool
  // call's position in the interleaved render order.
  updated[index] = { ...next, firstSeenSequence: toolCalls[index].firstSeenSequence }
  return updated
}
