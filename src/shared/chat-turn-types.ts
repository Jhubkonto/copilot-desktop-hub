export type ChatTurnEventType =
  | 'turn_started'
  | 'user_message_committed'
  | 'assistant_text_delta'
  | 'thinking_delta'
  | 'thinking_done'
  | 'tool_started'
  | 'tool_finished'
  | 'activity_changed'
  | 'cost_updated'
  | 'model_changed'
  | 'turn_completed'
  | 'turn_failed'
  | 'history_snapshot_received'

export type ChatActivityState = 'active' | 'thinking' | 'tool' | 'approval' | 'complete' | 'error'

export interface ChatTurnEventBase {
  type: ChatTurnEventType
  conversationId: string
  turnId: string
  sequence: number
  timestamp: number
}

export interface ChatTurnStartedEvent extends ChatTurnEventBase {
  type: 'turn_started'
}

export interface ChatUserMessageCommittedEvent extends ChatTurnEventBase {
  type: 'user_message_committed'
  messageId: string
}

export interface ChatAssistantTextDeltaEvent extends ChatTurnEventBase {
  type: 'assistant_text_delta'
  chunk: string
}

export interface ChatThinkingDeltaEvent extends ChatTurnEventBase {
  type: 'thinking_delta'
  blockId: string
  chunk: string
}

export interface ChatThinkingDoneEvent extends ChatTurnEventBase {
  type: 'thinking_done'
  blockId: string
}

export interface ChatToolStartedEvent extends ChatTurnEventBase {
  type: 'tool_started'
  id: string
  name: string
  input?: Record<string, unknown>
  serverName?: string
}

export interface ChatToolFinishedEvent extends ChatTurnEventBase {
  type: 'tool_finished'
  id?: string
  toolName: string
  serverName?: string
  args?: Record<string, unknown>
  result: string
  success: boolean
  resultImages?: { dataUrl: string }[]
}

export interface ChatActivityChangedEvent extends ChatTurnEventBase {
  type: 'activity_changed'
  state: ChatActivityState
  label: string
  toolName?: string
  serverName?: string
}

export interface ChatCostUpdatedEvent extends ChatTurnEventBase {
  type: 'cost_updated'
  inputTokens: number
  outputTokens: number
  totalCostUsd: number
}

export interface ChatModelChangedEvent extends ChatTurnEventBase {
  type: 'model_changed'
  model: string
}

export interface ChatTurnCompletedEvent extends ChatTurnEventBase {
  type: 'turn_completed'
}

export interface ChatTurnFailedEvent extends ChatTurnEventBase {
  type: 'turn_failed'
  errorType: string
  message: string
  retryable: boolean
  retryAfterSeconds?: number
}

export interface ChatHistorySnapshotReceivedEvent extends ChatTurnEventBase {
  type: 'history_snapshot_received'
  messageCount: number
}

export type ChatTurnEvent =
  | ChatTurnStartedEvent
  | ChatUserMessageCommittedEvent
  | ChatAssistantTextDeltaEvent
  | ChatThinkingDeltaEvent
  | ChatThinkingDoneEvent
  | ChatToolStartedEvent
  | ChatToolFinishedEvent
  | ChatActivityChangedEvent
  | ChatCostUpdatedEvent
  | ChatModelChangedEvent
  | ChatTurnCompletedEvent
  | ChatTurnFailedEvent
  | ChatHistorySnapshotReceivedEvent

