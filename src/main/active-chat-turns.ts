import type { ActiveChatTurnSnapshot, ActiveChatTurnToolCallSnapshot, ChatTurnEvent } from '../shared/chat-turn-types'
import { ChatAnimationDiagnostics } from '../shared/chat-animation-diagnostics'

const TERMINAL_TTL_MS = 30_000

interface StoredTurn extends ActiveChatTurnSnapshot {
  terminalAt?: number
}

const turns = new Map<string, StoredTurn>()
export const activeChatTurnDiagnostics = new ChatAnimationDiagnostics()

export function recordActiveChatTurnEvent(event: ChatTurnEvent): void {
  pruneActiveChatTurns()
  if (event.type === 'turn_started') {
    turns.set(event.conversationId, {
      conversationId: event.conversationId,
      turnId: event.turnId,
      latestSequence: event.sequence,
      assistantText: '',
      status: 'active',
      toolCalls: [],
      activity: null,
      events: [event],
    })
    return
  }
  const current = turns.get(event.conversationId)
  if (!current || current.turnId !== event.turnId) return
  activeChatTurnDiagnostics.recordSequence(current.latestSequence, event.sequence)
  if (event.sequence <= current.latestSequence) return
  current.latestSequence = event.sequence
  current.events.push(event)
  if (event.type === 'assistant_text_delta') current.assistantText += event.chunk
  if (event.type === 'tool_started') {
    upsertToolCall(current.toolCalls, {
      id: event.id,
      toolName: event.name,
      serverName: event.serverName,
      args: event.input,
      result: '',
      success: true,
      inProgress: true,
    })
    current.activity = { state: 'tool', label: `Running ${event.name}`, toolName: event.name, serverName: event.serverName }
  }
  if (event.type === 'tool_finished') {
    upsertToolCall(current.toolCalls, {
      id: event.id,
      toolName: event.toolName,
      serverName: event.serverName,
      args: event.args,
      result: event.result,
      success: event.success,
      inProgress: false,
    })
  }
  if (event.type === 'activity_changed') {
    current.activity = { state: event.state, label: event.label, toolName: event.toolName, serverName: event.serverName }
  }
  if (event.type === 'turn_completed' || event.type === 'turn_failed') {
    current.status = event.type === 'turn_completed' ? 'completed' : 'failed'
    current.terminalAt = Date.now()
  }
}

function upsertToolCall(toolCalls: ActiveChatTurnToolCallSnapshot[], next: ActiveChatTurnToolCallSnapshot): void {
  const index = next.id ? toolCalls.findIndex((tc) => tc.id === next.id) : -1
  if (index === -1) {
    toolCalls.push(next)
  } else {
    toolCalls[index] = next
  }
}

export function getActiveChatTurnSnapshot(conversationId: string): ActiveChatTurnSnapshot | null {
  pruneActiveChatTurns()
  const turn = turns.get(conversationId)
  return turn ? structuredClone({
    conversationId: turn.conversationId,
    turnId: turn.turnId,
    latestSequence: turn.latestSequence,
    assistantText: turn.assistantText,
    status: turn.status,
    toolCalls: turn.toolCalls,
    activity: turn.activity,
    events: turn.events,
  }) : null
}

export function clearActiveChatTurn(conversationId: string, turnId?: string): void {
  const current = turns.get(conversationId)
  if (current && (!turnId || current.turnId === turnId)) turns.delete(conversationId)
}

export function clearAllActiveChatTurns(): void {
  turns.clear()
}

export function pruneActiveChatTurns(now = Date.now()): void {
  for (const [conversationId, turn] of turns) {
    if (turn.terminalAt && now - turn.terminalAt >= TERMINAL_TTL_MS) turns.delete(conversationId)
  }
}

export function resetActiveChatTurnsForTest(): void {
  turns.clear()
  activeChatTurnDiagnostics.reset()
}
