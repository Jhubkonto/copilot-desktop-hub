import { describe, expect, it } from 'vitest'
import type { ChatTurnEvent } from '../../shared/chat-turn-types'
import { chatTurnReducer, createEmptyChatTurnState } from '../hooks/chat-turn-reducer'

function event(overrides: Partial<ChatTurnEvent> & { type: ChatTurnEvent['type']; sequence: number }): ChatTurnEvent {
  return {
    conversationId: 'conv-1',
    turnId: 'turn-1',
    timestamp: 1000 + overrides.sequence,
    ...overrides,
  } as ChatTurnEvent
}

describe('chatTurnReducer', () => {
  it('starts a turn and accumulates assistant text deltas in sequence order', () => {
    let state = createEmptyChatTurnState('conv-1')
    state = chatTurnReducer(state, event({ type: 'turn_started', sequence: 1 }))
    state = chatTurnReducer(state, event({ type: 'assistant_text_delta', sequence: 2, chunk: 'Hello' }))
    state = chatTurnReducer(state, event({ type: 'assistant_text_delta', sequence: 3, chunk: ' world' }))

    expect(state.status).toBe('streaming')
    expect(state.text).toBe('Hello world')
    expect(state.lastSequence).toBe(3)
  })

  it('ignores stale sequence numbers and events for other conversations', () => {
    let state = createEmptyChatTurnState('conv-1')
    state = chatTurnReducer(state, event({ type: 'turn_started', sequence: 1 }))
    state = chatTurnReducer(state, event({ type: 'assistant_text_delta', sequence: 3, chunk: 'new' }))
    state = chatTurnReducer(state, event({ type: 'assistant_text_delta', sequence: 2, chunk: ' stale' }))
    state = chatTurnReducer(state, event({
      type: 'assistant_text_delta',
      sequence: 4,
      conversationId: 'conv-2',
      chunk: ' other',
    }))

    expect(state.text).toBe('new')
    expect(state.lastSequence).toBe(3)
  })

  it('queues thinking_done before the matching delta and replays it', () => {
    let state = createEmptyChatTurnState('conv-1')
    state = chatTurnReducer(state, event({ type: 'turn_started', sequence: 1 }))
    state = chatTurnReducer(state, event({ type: 'thinking_done', sequence: 2, blockId: 'reasoning-1' }))
    expect(state.thinkingBlocks.get('reasoning-1')).toBeUndefined()
    expect(state.pendingThinkingEnds.has('reasoning-1')).toBe(true)

    state = chatTurnReducer(state, event({
      type: 'thinking_delta',
      sequence: 3,
      blockId: 'reasoning-1',
      chunk: 'Planned steps',
    }))

    expect(state.thinkingBlocks.get('reasoning-1')).toEqual({
      blockId: 'reasoning-1',
      content: 'Planned steps',
      done: true,
      firstSeenSequence: 3,
    })
    expect(state.pendingThinkingEnds.size).toBe(0)
  })

  it('marks all thinking blocks done on completion and failure', () => {
    let completed = createEmptyChatTurnState('conv-1')
    completed = chatTurnReducer(completed, event({ type: 'turn_started', sequence: 1 }))
    completed = chatTurnReducer(completed, event({
      type: 'thinking_delta',
      sequence: 2,
      blockId: 'reasoning-1',
      chunk: 'Still thinking',
    }))
    completed = chatTurnReducer(completed, event({ type: 'turn_completed', sequence: 3 }))

    expect(completed.status).toBe('completed')
    expect(completed.thinkingBlocks.get('reasoning-1')?.done).toBe(true)

    let failed = createEmptyChatTurnState('conv-1')
    failed = chatTurnReducer(failed, event({ type: 'turn_started', sequence: 1 }))
    failed = chatTurnReducer(failed, event({
      type: 'thinking_delta',
      sequence: 2,
      blockId: 'reasoning-1',
      chunk: 'Still thinking',
    }))
    failed = chatTurnReducer(failed, event({
      type: 'turn_failed',
      sequence: 3,
      errorType: 'api',
      message: 'Provider failed',
      retryable: true,
    }))

    expect(failed.status).toBe('failed')
    expect(failed.error?.message).toBe('Provider failed')
    expect(failed.thinkingBlocks.get('reasoning-1')?.done).toBe(true)
  })

  it('records tool calls, model, activity, and cost', () => {
    let state = createEmptyChatTurnState('conv-1')
    state = chatTurnReducer(state, event({ type: 'turn_started', sequence: 1 }))
    state = chatTurnReducer(state, event({ type: 'model_changed', sequence: 2, model: 'gpt-5-mini' }))
    state = chatTurnReducer(state, event({
      type: 'activity_changed',
      sequence: 3,
      state: 'tool',
      label: 'Running browser_snapshot',
      toolName: 'browser_snapshot',
      serverName: 'Browser',
    }))
    state = chatTurnReducer(state, event({
      type: 'tool_finished',
      sequence: 4,
      toolName: 'browser_snapshot',
      serverName: 'Browser',
      args: { tab: 'active' },
      result: 'Snapshot captured',
      success: true,
    }))
    state = chatTurnReducer(state, event({
      type: 'cost_updated',
      sequence: 5,
      inputTokens: 100,
      outputTokens: 25,
      totalCostUsd: 0.01,
    }))

    expect(state.model).toBe('gpt-5-mini')
    expect(state.activity).toEqual({
      state: 'tool',
      label: 'Running browser_snapshot',
      toolName: 'browser_snapshot',
      serverName: 'Browser',
    })
    expect(state.toolCalls).toEqual([{
      id: undefined,
      toolName: 'browser_snapshot',
      serverName: 'Browser',
      args: { tab: 'active' },
      result: 'Snapshot captured',
      success: true,
      resultImages: undefined,
      inProgress: false,
      firstSeenSequence: 4,
    }])
    expect(state.cost).toEqual({
      inputTokens: 100,
      outputTokens: 25,
      totalCostUsd: 0.01,
    })
  })

  it('inserts an in-progress placeholder on tool_started and resolves it on tool_finished', () => {
    let state = createEmptyChatTurnState('conv-1')
    state = chatTurnReducer(state, event({ type: 'turn_started', sequence: 1 }))
    state = chatTurnReducer(state, event({
      type: 'tool_started',
      sequence: 2,
      id: 'call-1',
      name: 'read_file',
      input: { path: 'a.ts' },
      serverName: 'claude-cli',
    }))

    expect(state.toolCalls).toEqual([{
      id: 'call-1',
      toolName: 'read_file',
      serverName: 'claude-cli',
      args: { path: 'a.ts' },
      result: '',
      success: true,
      inProgress: true,
      firstSeenSequence: 2,
    }])

    state = chatTurnReducer(state, event({
      type: 'tool_finished',
      sequence: 3,
      id: 'call-1',
      toolName: 'read_file',
      serverName: 'claude-cli',
      result: 'file contents',
      success: true,
    }))

    expect(state.toolCalls).toEqual([{
      id: 'call-1',
      toolName: 'read_file',
      serverName: 'claude-cli',
      args: undefined,
      result: 'file contents',
      success: true,
      resultImages: undefined,
      inProgress: false,
      firstSeenSequence: 2,
    }])
  })

  it('updates duplicate tool_finished events with the same id', () => {
    let state = createEmptyChatTurnState('conv-1')
    state = chatTurnReducer(state, event({ type: 'turn_started', sequence: 1 }))
    state = chatTurnReducer(state, event({
      type: 'tool_finished',
      sequence: 2,
      id: 'tool-1',
      toolName: 'read_file',
      result: 'old',
      success: true,
    }))
    state = chatTurnReducer(state, event({
      type: 'tool_finished',
      sequence: 3,
      id: 'tool-1',
      toolName: 'read_file',
      result: 'new',
      success: false,
    }))

    expect(state.toolCalls).toEqual([{
      id: 'tool-1',
      toolName: 'read_file',
      serverName: undefined,
      args: undefined,
      result: 'new',
      success: false,
      resultImages: undefined,
      inProgress: false,
      firstSeenSequence: 2,
    }])
  })
})
