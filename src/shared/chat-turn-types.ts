export type ChatTurnEventType =
  | 'turn_started'
  | 'user_message_committed'
  | 'assistant_text_delta'
  | 'text_segment_done'
  | 'thinking_delta'
  | 'thinking_done'
  | 'tool_started'
  | 'tool_finished'
  | 'user_input_requested'
  | 'user_input_resolved'
  | 'user_input_cancelled'
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
  // Identifies which contiguous text burst this chunk belongs to — a turn that says
  // something, calls a tool, then says more, produces two different blockIds so the
  // two bursts can be positioned on either side of the tool call instead of merged
  // into one blob at the end. Omitted by backends that don't segment text yet, in
  // which case the whole turn's text is treated as a single legacy block.
  blockId?: string
}

export interface ChatTextSegmentDoneEvent extends ChatTurnEventBase {
  type: 'text_segment_done'
  blockId: string
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

export type UserInputSource = 'codex' | 'claude' | 'byok'
export type UserInputSelection = 'single' | 'multiple'

export interface UserInputOption {
  id: string
  label: string
  description?: string
}

export interface UserInputQuestion {
  id: string
  header?: string
  prompt: string
  options?: UserInputOption[]
  selection: UserInputSelection
  allowFreeText: boolean
}

export interface UserInputAnswer {
  questionId: string
  selectedOptionIds: string[]
  text?: string
}

export interface UserInputRequest {
  requestId: string
  conversationId: string
  turnId: string
  source: UserInputSource
  questions: UserInputQuestion[]
}

export interface ResolvedUserInput {
  request: UserInputRequest
  answers: UserInputAnswer[]
}

export interface ChatUserInputRequestedEvent extends ChatTurnEventBase {
  type: 'user_input_requested'
  request: UserInputRequest
}

export interface ChatUserInputResolvedEvent extends ChatTurnEventBase {
  type: 'user_input_resolved'
  requestId: string
  answers: UserInputAnswer[]
}

export interface ChatUserInputCancelledEvent extends ChatTurnEventBase {
  type: 'user_input_cancelled'
  requestId: string
  reason: string
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
  | ChatTextSegmentDoneEvent
  | ChatThinkingDeltaEvent
  | ChatThinkingDoneEvent
  | ChatToolStartedEvent
  | ChatToolFinishedEvent
  | ChatUserInputRequestedEvent
  | ChatUserInputResolvedEvent
  | ChatUserInputCancelledEvent
  | ChatActivityChangedEvent
  | ChatCostUpdatedEvent
  | ChatModelChangedEvent
  | ChatTurnCompletedEvent
  | ChatTurnFailedEvent
  | ChatHistorySnapshotReceivedEvent

export interface ActiveChatTurnToolCallSnapshot {
  id?: string
  toolName: string
  serverName?: string
  args?: Record<string, unknown>
  result: string
  success: boolean
  inProgress: boolean
}

export interface ActiveChatTurnActivitySnapshot {
  state: string
  label: string
  toolName?: string
  serverName?: string
}

export interface ActiveChatTurnSnapshot {
  conversationId: string
  turnId: string
  latestSequence: number
  assistantText: string
  status: 'active' | 'completed' | 'failed'
  // Tool calls that have started (and possibly finished) so far this turn — lets a client
  // that re-fetches this snapshot after missing the live events (e.g. re-entering a chat
  // mid-generation) restore ones that already ran, not just whatever's still in flight.
  toolCalls: ActiveChatTurnToolCallSnapshot[]
  // The most recent activity_changed/tool_started label, so a re-fetching client can show
  // "Running X" / "Thinking" instead of a bare status with no explanation.
  activity: ActiveChatTurnActivitySnapshot | null
  /** Sequence-ordered replay used to restore through the live event reducer. */
  events: ChatTurnEvent[]
}
