import { randomUUID } from 'crypto'
import type { ChatTurnEvent, ChatActivityState } from '../shared/chat-turn-types'
import type { WsPushEvent } from './ws-server'
import { debugLog } from './debug-mode'

export interface ChatTurnEmitterSinks {
  sendDesktop?: (channel: string, ...args: unknown[]) => void
  broadcastMobile?: (event: WsPushEvent) => void
}

export interface StreamErrorPayload {
  type: string
  message: string
  retryable: boolean
  retryAfterSeconds?: number
}

export interface MobileChatActivityPayload {
  state: ChatActivityState
  label: string
  toolName?: string
  serverName?: string
}

export interface ToolFinishedPayload {
  id?: string
  toolName: string
  serverName?: string
  args?: Record<string, unknown>
  result: string
  success: boolean
  resultImages?: { dataUrl: string }[]
}

export class ChatTurnEmitter {
  readonly conversationId: string
  readonly turnId: string
  private sequence = 0
  private readonly sinks: ChatTurnEmitterSinks

  constructor(conversationId: string, sinks: ChatTurnEmitterSinks, turnId: string = randomUUID()) {
    this.conversationId = conversationId
    this.turnId = turnId
    this.sinks = sinks
  }

  started(): ChatTurnEvent {
    return this.emit({ type: 'turn_started' })
  }

  userMessageCommitted(messageId: string): ChatTurnEvent {
    return this.emit({ type: 'user_message_committed', messageId })
  }

  assistantTextDelta(chunk: string): ChatTurnEvent {
    const event = this.emit({ type: 'assistant_text_delta', chunk })
    this.sinks.sendDesktop?.('chat:stream-response', chunk)
    this.sinks.broadcastMobile?.({
      event: 'chat:stream-chunk',
      data: this.withMeta({ conversationId: this.conversationId, chunk }, event),
    })
    return event
  }

  activity(activity: MobileChatActivityPayload): ChatTurnEvent {
    const event = this.emit({ type: 'activity_changed', ...activity })
    const data = this.withMeta({ conversationId: this.conversationId, ...activity }, event)
    this.sinks.broadcastMobile?.({ event: 'chat:activity', data })
    this.sinks.sendDesktop?.('chat:activity-global', data)
    return event
  }

  streamEnd(): ChatTurnEvent {
    const event = this.emit({ type: 'turn_completed' })
    this.sinks.sendDesktop?.('chat:stream-response', null)
    this.sinks.broadcastMobile?.({
      event: 'chat:stream-end',
      data: this.withMeta({ conversationId: this.conversationId }, event),
    })
    return event
  }

  closeStream(): void {
    this.sinks.sendDesktop?.('chat:stream-response', null)
    this.sinks.broadcastMobile?.({
      event: 'chat:stream-end',
      data: {
        conversationId: this.conversationId,
        turnId: this.turnId,
        sequence: this.sequence,
      },
    })
  }

  streamError(error: StreamErrorPayload): ChatTurnEvent {
    const event = this.emit({
      type: 'turn_failed',
      errorType: error.type,
      message: error.message,
      retryable: error.retryable,
      ...(error.retryAfterSeconds != null ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    })
    this.sinks.sendDesktop?.('chat:stream-error', error)
    return event
  }

  thinkingDelta(blockId: string, chunk: string): ChatTurnEvent {
    const event = this.emit({ type: 'thinking_delta', blockId, chunk })
    this.sinks.sendDesktop?.('chat:thinking-delta', { blockId, chunk })
    this.sinks.broadcastMobile?.({
      event: 'chat:thinking-delta',
      data: this.withMeta({ conversationId: this.conversationId, blockId, chunk }, event),
    })
    return event
  }

  thinkingEnd(blockId: string): ChatTurnEvent {
    const event = this.emit({ type: 'thinking_done', blockId })
    this.sinks.sendDesktop?.('chat:thinking-end', { blockId })
    this.sinks.broadcastMobile?.({
      event: 'chat:thinking-end',
      data: this.withMeta({ conversationId: this.conversationId, blockId }, event),
    })
    return event
  }

  cliToolStart(id: string, name: string, input: Record<string, unknown>): ChatTurnEvent {
    const event = this.emit({ type: 'tool_started', id, name, input })
    this.sinks.sendDesktop?.('chat:cli-tool-start', { id, name, input })
    return event
  }

  cliToolEnd(id: string, content: string, isError: boolean, pending?: { name: string; input: Record<string, unknown>; serverName?: string }): ChatTurnEvent {
    const event = this.emit({
      type: 'tool_finished',
      id,
      toolName: pending?.name ?? id,
      serverName: pending?.serverName,
      args: pending?.input,
      result: content,
      success: !isError,
    })
    this.sinks.sendDesktop?.('chat:cli-tool-end', { id, content, isError })
    if (pending) {
      this.sinks.broadcastMobile?.({
        event: 'chat:tool-call-event',
        data: this.withMeta({
          conversationId: this.conversationId,
          id,
          toolName: pending.name,
          serverName: pending.serverName,
          args: pending.input,
          result: content,
          success: !isError,
        }, event),
      })
    }
    return event
  }

  toolFinished(payload: ToolFinishedPayload, options: { desktop?: boolean; mobile?: boolean } = {}): ChatTurnEvent {
    const event = this.emit({ type: 'tool_finished', ...payload })
    const data = this.withMeta({ conversationId: this.conversationId, ...payload }, event)
    if (options.desktop !== false) this.sinks.sendDesktop?.('chat:tool-call-event', data)
    if (options.mobile !== false) this.sinks.broadcastMobile?.({ event: 'chat:tool-call-event', data })
    return event
  }

  cost(inputTokens: number, outputTokens: number, totalCostUsd: number): ChatTurnEvent {
    const event = this.emit({ type: 'cost_updated', inputTokens, outputTokens, totalCostUsd })
    const data = this.withMeta({ conversationId: this.conversationId, inputTokens, outputTokens, totalCostUsd }, event)
    this.sinks.sendDesktop?.('chat:cli-cost', { inputTokens, outputTokens, totalCostUsd })
    this.sinks.broadcastMobile?.({ event: 'chat:cost', data })
    return event
  }

  model(model: string): ChatTurnEvent {
    const event = this.emit({ type: 'model_changed', model })
    this.sinks.sendDesktop?.('chat:stream-model', model)
    return event
  }

  private emit(data: Record<string, unknown> & { type: ChatTurnEvent['type'] }): ChatTurnEvent {
    const event = {
      ...data,
      conversationId: this.conversationId,
      turnId: this.turnId,
      sequence: ++this.sequence,
      timestamp: Date.now(),
    } as ChatTurnEvent
    this.sinks.sendDesktop?.('chat:turn-event', event)
    this.sinks.broadcastMobile?.({ event: 'chat:turn-event', data: event })
    debugLog('chat-turn', `${event.conversationId} ${event.turnId} #${event.sequence} ${event.type}`)
    return event
  }

  private withMeta<T extends Record<string, unknown>>(data: T, event: ChatTurnEvent): T & { turnId: string; sequence: number } {
    return {
      ...data,
      turnId: event.turnId,
      sequence: event.sequence,
    }
  }
}
