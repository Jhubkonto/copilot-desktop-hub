import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useChatLiveTurn } from '../../../renderer/hooks/useChatLiveTurn'
import { setupMockApi, type MockApi } from '../../../test/mocks/api'
import type { ChatTurnEvent } from '../../../shared/chat-turn-types'

let mockApi: MockApi
let chatTurnEventCallbacks: ((event: ChatTurnEvent) => void)[] = []
function emitChatTurnEvent(event: ChatTurnEvent) {
  for (const cb of chatTurnEventCallbacks) cb(event)
}

beforeEach(() => {
  mockApi = setupMockApi()
  chatTurnEventCallbacks = []
  mockApi.onChatTurnEvent.mockImplementation((cb: (event: ChatTurnEvent) => void) => {
    chatTurnEventCallbacks.push(cb)
    return () => {
      chatTurnEventCallbacks = chatTurnEventCallbacks.filter((c) => c !== cb)
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useChatLiveTurn', () => {
  it('restores accumulated text from an active-turn snapshot on mount, instead of starting blank', async () => {
    // Reproduces leaving a chat mid-generation and re-entering: the component remounts
    // with no memory of any live events that already fired, so without a catch-up fetch
    // it would render a bare "Thinking…" indicator until the turn completes, even though
    // the backend already has real partial content for this turn.
    mockApi.getActiveChatTurn.mockResolvedValue({
      conversationId: 'conv-1',
      turnId: 'turn-1',
      latestSequence: 5,
      assistantText: "I'll run an actual web search on this topic",
      status: 'active',
      toolCalls: [],
      activity: null,
    })

    const { result } = renderHook(() => useChatLiveTurn('conv-1'))

    await waitFor(() => expect(result.current.turnId).toBe('turn-1'))
    expect(result.current.text).toBe("I'll run an actual web search on this topic")
    expect(result.current.status).toBe('streaming')
  })

  it('restores tool calls that already ran and the current activity, not just the trailing text', async () => {
    // Reproduces the reported follow-up: after the flat-text restore, re-entering a chat
    // mid-generation still showed only the lead-in sentence plus whatever tool call
    // started *after* re-entry — every tool call that had already run before the user
    // left was invisible until the whole turn settled, because the snapshot only ever
    // carried assistantText. active-chat-turns.ts now also tracks toolCalls/activity.
    mockApi.getActiveChatTurn.mockResolvedValue({
      conversationId: 'conv-1',
      turnId: 'turn-1',
      latestSequence: 5,
      assistantText: "I'll search for AliExpress desktop PC user feedback.",
      status: 'active',
      toolCalls: [
        { id: 'call-1', toolName: 'WebSearch', args: { query: 'a' }, result: 'first results', success: true, inProgress: false },
        { id: 'call-2', toolName: 'WebSearch', args: { query: 'b' }, result: '', success: true, inProgress: true },
      ],
      activity: { state: 'tool', label: 'Running WebSearch', toolName: 'WebSearch' },
    })

    const { result } = renderHook(() => useChatLiveTurn('conv-1'))

    await waitFor(() => expect(result.current.turnId).toBe('turn-1'))
    expect(result.current.toolCalls).toEqual([
      expect.objectContaining({ id: 'call-1', result: 'first results', inProgress: false }),
      expect.objectContaining({ id: 'call-2', inProgress: true }),
    ])
    expect(result.current.activity).toEqual({ state: 'tool', label: 'Running WebSearch', toolName: 'WebSearch' })
  })

  it('does not let a stale snapshot clobber a newer turn that already started live', async () => {
    let resolveSnapshot: (value: unknown) => void = () => {}
    mockApi.getActiveChatTurn.mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve
      }),
    )

    const { result } = renderHook(() => useChatLiveTurn('conv-1'))

    act(() => {
      emitChatTurnEvent({
        type: 'turn_started',
        conversationId: 'conv-1',
        turnId: 'turn-new',
        sequence: 1,
        timestamp: Date.now(),
      })
    })
    expect(result.current.turnId).toBe('turn-new')

    act(() => {
      resolveSnapshot({
        conversationId: 'conv-1',
        turnId: 'turn-old',
        latestSequence: 99,
        assistantText: 'stale text from a previous turn',
        status: 'active',
        toolCalls: [],
        activity: null,
      })
    })
    await Promise.resolve()

    expect(result.current.turnId).toBe('turn-new')
    expect(result.current.text).toBe('')
  })

  it('ignores a completed/failed snapshot — settled turns are restored via history, not the live reducer', async () => {
    mockApi.getActiveChatTurn.mockResolvedValue({
      conversationId: 'conv-1',
      turnId: 'turn-1',
      latestSequence: 5,
      assistantText: 'final answer',
      status: 'completed',
      toolCalls: [],
      activity: null,
    })

    const { result } = renderHook(() => useChatLiveTurn('conv-1'))
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.turnId).toBeNull()
    expect(result.current.status).toBe('idle')
  })
})
