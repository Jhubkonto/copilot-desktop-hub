import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../hooks/chat-types'
import { createEmptyChatTurnState, type ChatTurnState } from '../hooks/chat-turn-reducer'
import { buildChatRenderItems } from '../hooks/chat-render-items'

function message(overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role' | 'content'>): ChatMessage {
  return {
    timestamp: 1,
    ...overrides,
  } as ChatMessage
}

function liveTurn(overrides: Partial<ChatTurnState>): ChatTurnState {
  return {
    ...createEmptyChatTurnState('conv-1'),
    turnId: 'turn-1',
    status: 'streaming',
    ...overrides,
  }
}

describe('buildChatRenderItems', () => {
  it('groups historical tool calls with the following assistant message', () => {
    const items = buildChatRenderItems([
      message({ id: 'u1', role: 'user', content: 'Search', timestamp: 1 }),
      message({
        id: 't1',
        role: 'tool-call',
        content: '',
        timestamp: 2,
        toolName: 'browser_search',
        toolResult: 'result',
      }),
      message({ id: 'a1', role: 'assistant', content: 'Found it', timestamp: 3 }),
    ], createEmptyChatTurnState('conv-1'))

    expect(items.map((item) => item.type)).toEqual(['historical-message', 'historical-tool-group'])
    expect(items[1]).toMatchObject({
      type: 'historical-tool-group',
      message: { id: 'a1' },
      toolCalls: [{ id: 't1' }],
    })
  })

  it('keeps out-of-order historical tool calls standalone', () => {
    const items = buildChatRenderItems([
      message({
        id: 't1',
        role: 'tool-call',
        content: '',
        timestamp: 4,
        toolName: 'late_tool',
      }),
      message({ id: 'a1', role: 'assistant', content: 'Already answered', timestamp: 3 }),
    ], createEmptyChatTurnState('conv-1'))

    expect(items.map((item) => item.id)).toEqual(['a1', 't1'])
    expect(items.map((item) => item.type)).toEqual(['historical-message', 'historical-message'])
  })

  it('appends live thinking, tool calls, and assistant text after history', () => {
    const state = liveTurn({
      text: 'Live answer',
      thinkingBlocks: new Map([['reasoning-1', { blockId: 'reasoning-1', content: 'Plan', done: false }]]),
      toolCalls: [{
        id: 'tool-1',
        toolName: 'read_file',
        result: 'contents',
        success: true,
      }],
      model: 'gpt-5-mini',
    })

    const items = buildChatRenderItems([
      message({ id: 'u1', role: 'user', content: 'Read file', timestamp: 1 }),
    ], state)

    expect(items.map((item) => item.type)).toEqual([
      'historical-message',
      'live-thinking-block',
      'live-tool-call',
      'live-assistant-text',
    ])
    expect(items[3]).toMatchObject({ text: 'Live answer', model: 'gpt-5-mini' })
  })

  it('deduplicates live thinking blocks and live tool calls that are already committed', () => {
    const committedThinking = new Map([['reasoning-1', { blockId: 'reasoning-1', content: 'Done', done: true }]])
    const state = liveTurn({
      thinkingBlocks: new Map([
        ['reasoning-1', { blockId: 'reasoning-1', content: 'Done', done: true }],
        ['reasoning-2', { blockId: 'reasoning-2', content: 'New', done: false }],
      ]),
      toolCalls: [
        { id: 'tool-1', toolName: 'read_file', result: 'old', success: true },
        { id: 'tool-2', toolName: 'list_dir', result: 'new', success: true },
      ],
    })

    const items = buildChatRenderItems([
      message({ id: 'a1', role: 'assistant', content: 'Answer', timestamp: 3, thinkingBlocks: committedThinking }),
      message({ id: 't1', role: 'tool-call', content: '', timestamp: 4, toolCallId: 'tool-1' }),
    ], state)

    expect(items.filter((item) => item.type === 'live-thinking-block').map((item) => item.id)).toEqual(['live-thinking-reasoning-2'])
    expect(items.filter((item) => item.type === 'live-tool-call').map((item) => item.id)).toEqual(['tool-2'])
  })

  it('uses live activity when no text has arrived yet', () => {
    const state = liveTurn({
      status: 'active',
      activity: {
        state: 'tool',
        label: 'Running browser_snapshot',
        toolName: 'browser_snapshot',
        serverName: 'Browser',
      },
    })

    const items = buildChatRenderItems([], state)

    expect(items).toEqual([{
      type: 'live-activity',
      id: 'live-activity-turn-1',
      label: 'Running browser_snapshot',
      state: 'tool',
      toolName: 'browser_snapshot',
      serverName: 'Browser',
    }])
  })
})
