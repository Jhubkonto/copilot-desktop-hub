import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useChat } from '../../../renderer/hooks/useChat'
import { setupMockApi, type MockApi } from '../../../test/mocks/api'
import type { ChatTurnEvent } from '../../../shared/chat-turn-types'

let mockApi: MockApi
let remoteMessageCallback: ((data: { conversationId: string; content: string; images?: { id: string; name: string; dataUrl: string }[] }) => void) | null = null
// useChat.ts registers two independent onChatTurnEvent subscribers (the reducer via
// useChatLiveTurn, plus a raw background-bookkeeping listener) — a single captured
// callback would only see the second subscription and silently drop the first, so
// this fans events out to every subscriber like the real (multi-listener) IPC bridge.
let chatTurnEventCallbacks: ((event: ChatTurnEvent) => void)[] = []
function emitChatTurnEvent(event: ChatTurnEvent) {
  for (const cb of chatTurnEventCallbacks) cb(event)
}

beforeEach(() => {
  mockApi = setupMockApi()
  remoteMessageCallback = null
  chatTurnEventCallbacks = []
  // useStreamingQueue reveals text via requestAnimationFrame, which isn't reliably
  // driven in this test environment. Report prefers-reduced-motion so enqueue()
  // deposits content synchronously — this hook's tests care about the stream
  // lifecycle (message commit timing, isGenerating transitions), not the reveal
  // animation itself, which is covered separately in chat-animation.test.ts.
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  mockApi.onRemoteMessage.mockImplementation((cb: (data: { conversationId: string; content: string; images?: { id: string; name: string; dataUrl: string }[] }) => void) => {
    remoteMessageCallback = cb
    return () => {
      remoteMessageCallback = null
    }
  })
  mockApi.onChatTurnEvent.mockImplementation((cb: (event: ChatTurnEvent) => void) => {
    chatTurnEventCallbacks.push(cb)
    return () => {
      chatTurnEventCallbacks = chatTurnEventCallbacks.filter((c) => c !== cb)
    }
  })
  mockApi.onStreamError.mockImplementation(() => () => undefined)
  mockApi.onTeamActivity.mockImplementation(() => () => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useChat', () => {
  it('ignores tool-call events from a different conversation', () => {
    const addToast = vi.fn()
    const loadConversations = vi.fn().mockResolvedValue(undefined)
    const conversationCreated = vi.fn()

    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        activeAgentId: null,
        activeProjectId: null,
        effectiveModel: 'default',
        catalogModels: [],
        addToast,
        loadConversations,
        conversationCreated,
        markConversationGenerating: vi.fn(),
        markConversationDoneGenerating: vi.fn(),
      }),
    )

    act(() => {
      emitChatTurnEvent({
        type: 'tool_started', conversationId: 'conv-2', turnId: 'turn-x', sequence: 1, timestamp: 1,
        id: 'call-1', name: 'read_file', input: {},
      })
      emitChatTurnEvent({
        type: 'tool_finished', conversationId: 'conv-2', turnId: 'turn-x', sequence: 2, timestamp: 2,
        id: 'call-1', toolName: 'read_file', args: {}, result: 'other chat', success: true,
      })
    })

    expect(result.current.messages).toEqual([])

    act(() => {
      emitChatTurnEvent({ type: 'turn_started', conversationId: 'conv-1', turnId: 'turn-1', sequence: 1, timestamp: 1 })
      emitChatTurnEvent({
        type: 'tool_started', conversationId: 'conv-1', turnId: 'turn-1', sequence: 2, timestamp: 2,
        id: 'call-2', name: 'read_file', input: {},
      })
      emitChatTurnEvent({
        type: 'tool_finished', conversationId: 'conv-1', turnId: 'turn-1', sequence: 3, timestamp: 3,
        id: 'call-2', toolName: 'read_file', args: {}, result: 'real', success: true,
      })
    })

    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]).toEqual(expect.objectContaining({ role: 'tool-call', toolResult: 'real' }))
  })

  it('promotes a closed text segment into messages interleaved before the tool call that followed it (not stuck at the end)', () => {
    // Reproduces the reported bug: a lead-in sentence, closed by a tool call, used to stay
    // invisible in the live-only render area until the whole turn settled — because only
    // tool calls were eagerly promoted into `messages` mid-turn, never text segments, so
    // a tool call always visually "jumped the queue" ahead of text that actually preceded it.
    const addToast = vi.fn()
    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        activeAgentId: null,
        activeProjectId: null,
        effectiveModel: 'default',
        catalogModels: [],
        addToast,
        loadConversations: vi.fn().mockResolvedValue(undefined),
        conversationCreated: vi.fn(),
        markConversationGenerating: vi.fn(),
        markConversationDoneGenerating: vi.fn(),
      }),
    )

    act(() => {
      emitChatTurnEvent({ type: 'turn_started', conversationId: 'conv-1', turnId: 'turn-1', sequence: 1, timestamp: 1 })
      emitChatTurnEvent({
        type: 'assistant_text_delta', conversationId: 'conv-1', turnId: 'turn-1', sequence: 2, timestamp: 2,
        chunk: "I'll check that.", blockId: 'text-0',
      })
      emitChatTurnEvent({
        type: 'text_segment_done', conversationId: 'conv-1', turnId: 'turn-1', sequence: 3, timestamp: 3,
        blockId: 'text-0',
      })
      emitChatTurnEvent({
        type: 'tool_started', conversationId: 'conv-1', turnId: 'turn-1', sequence: 4, timestamp: 4,
        id: 'call-1', name: 'Read', input: {},
      })
      emitChatTurnEvent({
        type: 'tool_finished', conversationId: 'conv-1', turnId: 'turn-1', sequence: 5, timestamp: 5,
        id: 'call-1', toolName: 'Read', args: {}, result: 'contents', success: true,
      })
      // A second text segment starts — this is what actually demotes text-0 from "the
      // tail" (reserved for the live/final display) to "an earlier, now-promotable
      // segment", matching the real bug: only a turn with >1 segment ever exercises this.
      emitChatTurnEvent({
        type: 'assistant_text_delta', conversationId: 'conv-1', turnId: 'turn-1', sequence: 6, timestamp: 6,
        chunk: 'Confirmed.', blockId: 'text-1',
      })
    })

    expect(result.current.messages.map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: 'assistant', content: "I'll check that." },
      { role: 'tool-call', content: 'contents' },
    ])
    expect(result.current.messages[0]).toEqual(expect.objectContaining({ isFrozenMidTurn: true }))
  })

  it('promotes a closed lead-in segment the moment the FIRST tool call starts, without waiting for a second text segment', () => {
    // The actual residual bug found via the render-order log: when a lead-in segment
    // is the ONLY segment so far, it used to be treated as "the tail" purely because it
    // was the highest-sequence text block — even though a tool call with a HIGHER
    // sequence had already started. Since eagerly-promoted tool calls always render
    // before anything still only in the live area, that tool call would jump ahead of
    // this earlier segment and stay ahead of it for as long as no second segment
    // appeared (which, for a turn with several tool calls in a row before more text,
    // could be many tool calls). The fix: "is this promotable" must compare against the
    // newest known sequence across BOTH tool calls and text segments, not just other
    // text segments.
    const addToast = vi.fn()
    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        activeAgentId: null,
        activeProjectId: null,
        effectiveModel: 'default',
        catalogModels: [],
        addToast,
        loadConversations: vi.fn().mockResolvedValue(undefined),
        conversationCreated: vi.fn(),
        markConversationGenerating: vi.fn(),
        markConversationDoneGenerating: vi.fn(),
      }),
    )

    act(() => {
      emitChatTurnEvent({ type: 'turn_started', conversationId: 'conv-1', turnId: 'turn-1', sequence: 1, timestamp: 1 })
      emitChatTurnEvent({
        type: 'assistant_text_delta', conversationId: 'conv-1', turnId: 'turn-1', sequence: 2, timestamp: 2,
        chunk: "I'll run an actual web search.", blockId: 'text-0',
      })
      emitChatTurnEvent({
        type: 'text_segment_done', conversationId: 'conv-1', turnId: 'turn-1', sequence: 3, timestamp: 3,
        blockId: 'text-0',
      })
      // No second text segment yet — just the first tool call.
      emitChatTurnEvent({
        type: 'tool_started', conversationId: 'conv-1', turnId: 'turn-1', sequence: 4, timestamp: 4,
        id: 'call-1', name: 'ToolSearch', input: {},
      })
    })

    // text-0 must already be promoted (and therefore positioned ahead of the tool call
    // in `messages`) the instant the tool call starts — not stuck live until some later
    // segment happens to arrive.
    expect(result.current.messages.map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: 'assistant', content: "I'll run an actual web search." },
      { role: 'tool-call', content: '' },
    ])
    expect(result.current.messages[0]).toEqual(expect.objectContaining({ isFrozenMidTurn: true }))
  })

  it('starts with empty messages and not generating', () => {
    const addToast = vi.fn()
    const loadConversations = vi.fn().mockResolvedValue(undefined)
    const conversationCreated = vi.fn()

    const { result } = renderHook(() =>
      useChat({
        conversationId: null,
        activeAgentId: null,
        activeProjectId: null,
        effectiveModel: 'default',
        catalogModels: [],
        addToast,
        loadConversations,
        conversationCreated,
        markConversationGenerating: vi.fn(),
        markConversationDoneGenerating: vi.fn(),
      }),
    )

    expect(result.current.messages).toEqual([])
    expect(result.current.isGenerating).toBe(false)
    expect(result.current.streamingContent).toBe('')
  })

  it('tracks normalized chat turn events for the active conversation', () => {
    const addToast = vi.fn()
    const loadConversations = vi.fn().mockResolvedValue(undefined)
    const conversationCreated = vi.fn()

    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        activeAgentId: null,
        activeProjectId: null,
        effectiveModel: 'default',
        catalogModels: [],
        addToast,
        loadConversations,
        conversationCreated,
        markConversationGenerating: vi.fn(),
        markConversationDoneGenerating: vi.fn(),
      }),
    )

    act(() => {
      emitChatTurnEvent({
        type: 'turn_started',
        conversationId: 'conv-1',
        turnId: 'turn-1',
        sequence: 1,
        timestamp: 1000,
      })
      emitChatTurnEvent({
        type: 'assistant_text_delta',
        conversationId: 'conv-1',
        turnId: 'turn-1',
        sequence: 2,
        timestamp: 1001,
        chunk: 'Hello',
      })
      emitChatTurnEvent({
        type: 'assistant_text_delta',
        conversationId: 'conv-2',
        turnId: 'turn-other',
        sequence: 1,
        timestamp: 1002,
        chunk: ' leaked',
      })
    })

    expect(result.current.liveTurnState).toMatchObject({
      conversationId: 'conv-1',
      turnId: 'turn-1',
      status: 'streaming',
      text: 'Hello',
      lastSequence: 2,
    })
  })

  it('handleEdit truncates messages and cancelEdit restores them', async () => {
    const addToast = vi.fn()
    const loadConversations = vi.fn().mockResolvedValue(undefined)
    const conversationCreated = vi.fn()
    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        activeAgentId: null,
        activeProjectId: null,
        effectiveModel: 'default',
        catalogModels: [],
        addToast,
        loadConversations,
        conversationCreated,
        markConversationGenerating: vi.fn(),
        markConversationDoneGenerating: vi.fn(),
      }),
    )

    act(() => {
      result.current.setMessages([
        { id: 'u1', role: 'user', content: 'First', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: 'Reply', timestamp: 2 },
        { id: 'u2', role: 'user', content: 'Edit me', timestamp: 3 },
        { id: 'a2', role: 'assistant', content: 'Later', timestamp: 4 },
      ])
    })

    act(() => {
      result.current.handleEdit(2)
    })

    await waitFor(() => {
      expect(result.current.messages).toEqual([
        { id: 'u1', role: 'user', content: 'First', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: 'Reply', timestamp: 2 },
      ])
    })
    expect(result.current.isEditingMessage).toBe(true)
    expect(mockApi.deleteMessagesAfter).not.toHaveBeenCalled()
    expect(addToast).not.toHaveBeenCalled()

    act(() => {
      result.current.cancelEdit()
    })
    expect(result.current.messages).toEqual([
      { id: 'u1', role: 'user', content: 'First', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'Reply', timestamp: 2 },
      { id: 'u2', role: 'user', content: 'Edit me', timestamp: 3 },
      { id: 'a2', role: 'assistant', content: 'Later', timestamp: 4 },
    ])
    expect(result.current.isEditingMessage).toBe(false)
  })

  it('appends streamed chunks and finalizes the assistant message', async () => {
    const addToast = vi.fn()
    const loadConversations = vi.fn().mockResolvedValue(undefined)
    const conversationCreated = vi.fn()
    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        activeAgentId: null,
        activeProjectId: null,
        effectiveModel: 'default',
        catalogModels: [],
        addToast,
        loadConversations,
        conversationCreated,
        markConversationGenerating: vi.fn(),
        markConversationDoneGenerating: vi.fn(),
      }),
    )

    act(() => {
      result.current.setIsGenerating(true)
      emitChatTurnEvent({ type: 'turn_started', conversationId: 'conv-1', turnId: 'turn-1', sequence: 1, timestamp: 1 })
      emitChatTurnEvent({
        type: 'model_changed', conversationId: 'conv-1', turnId: 'turn-1', sequence: 2, timestamp: 2, model: 'gpt-4.1',
      })
    })

    act(() => {
      emitChatTurnEvent({
        type: 'assistant_text_delta', conversationId: 'conv-1', turnId: 'turn-1', sequence: 3, timestamp: 3, chunk: 'Hello',
      })
      emitChatTurnEvent({
        type: 'assistant_text_delta', conversationId: 'conv-1', turnId: 'turn-1', sequence: 4, timestamp: 4, chunk: ' world',
      })
    })

    expect(result.current.streamingContent).toBe('Hello world')

    act(() => {
      emitChatTurnEvent({ type: 'turn_completed', conversationId: 'conv-1', turnId: 'turn-1', sequence: 5, timestamp: 5 })
    })

    await waitFor(() => {
      expect(result.current.isGenerating).toBe(false)
      expect(result.current.streamingContent).toBe('')
      expect(result.current.messages).toHaveLength(1)
      expect(result.current.messages[0]).toMatchObject({
        role: 'assistant',
        content: 'Hello world',
        model: 'gpt-4.1',
      })
    })
    expect(loadConversations).toHaveBeenCalled()
  })

  it('preserves toolCallId when a tool-call message is reloaded from the DB after the turn completes', async () => {
    const addToast = vi.fn()
    const loadConversations = vi.fn().mockResolvedValue(undefined)
    // Simulates what chat-handlers.ts persists for a CLI tool call and what getMessages
    // returns back — the JSON content's toolCallId must round-trip onto the ChatMessage,
    // or buildChatRenderItems can't recognize this historical message as the same tool
    // call still sitting in liveTurnState.toolCalls (which is never reset until the
    // conversation changes), and renders a duplicate live-tool-call block on top of it.
    mockApi.getMessages.mockResolvedValue([
      {
        id: 'db-row-1',
        conversation_id: 'conv-1',
        role: 'tool-call',
        content: JSON.stringify({
          __type: 'tool-call',
          toolCallId: 'call-2',
          toolName: 'read_file',
          serverName: 'codex-cli',
          toolArgs: {},
          toolResult: 'contents',
          toolSuccess: true,
        }),
        timestamp: 2,
        model: 'codex-cli',
        is_edited: 0,
      },
    ])

    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        activeAgentId: null,
        activeProjectId: null,
        effectiveModel: 'default',
        catalogModels: [],
        addToast,
        loadConversations,
        conversationCreated: vi.fn(),
        markConversationGenerating: vi.fn(),
        markConversationDoneGenerating: vi.fn(),
      }),
    )

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1)
    })

    act(() => {
      emitChatTurnEvent({ type: 'turn_started', conversationId: 'conv-1', turnId: 'turn-1', sequence: 1, timestamp: 1 })
      emitChatTurnEvent({
        type: 'tool_started', conversationId: 'conv-1', turnId: 'turn-1', sequence: 2, timestamp: 2,
        id: 'call-2', name: 'read_file', input: {},
      })
      emitChatTurnEvent({
        type: 'tool_finished', conversationId: 'conv-1', turnId: 'turn-1', sequence: 3, timestamp: 3,
        id: 'call-2', toolName: 'read_file', args: {}, result: 'contents', success: true,
      })
    })

    act(() => {
      emitChatTurnEvent({ type: 'turn_completed', conversationId: 'conv-1', turnId: 'turn-1', sequence: 4, timestamp: 4 })
    })

    await waitFor(() => {
      expect(result.current.isGenerating).toBe(false)
    })

    const toolCallMessage = result.current.messages.find((m) => m.role === 'tool-call')
    expect(toolCallMessage?.toolCallId).toBe('call-2')
    // liveTurnState never auto-resets after a turn completes (only the conversationId
    // changing does that), so this must still be around for the dedup check to matter.
    expect(result.current.liveTurnState.toolCalls[0]?.id).toBe('call-2')
  })

  it('adds remote mobile images to the live user message', async () => {
    const addToast = vi.fn()
    const loadConversations = vi.fn().mockResolvedValue(undefined)
    const conversationCreated = vi.fn()
    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        activeAgentId: null,
        activeProjectId: null,
        effectiveModel: 'default',
        catalogModels: [],
        addToast,
        loadConversations,
        conversationCreated,
        markConversationGenerating: vi.fn(),
        markConversationDoneGenerating: vi.fn(),
      }),
    )

    const images = [{ id: 'img-1', name: 'photo.png', dataUrl: 'data:image/png;base64,abc123' }]
    act(() => {
      remoteMessageCallback?.({ conversationId: 'conv-1', content: '', images })
    })

    expect(result.current.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: '',
        images,
      }),
    ])
    expect(result.current.isGenerating).toBe(true)
  })

  it('does not replay the already-restored text when re-entering a chat mid-generation', async () => {
    // Reproduces the reported bug: leaving a chat mid-generation and coming back showed
    // the already-accumulated sentence twice, re-animated from scratch — because
    // liveTurnState.text got restored from the active-turn snapshot (see
    // useChatLiveTurn's restore action) while enqueuedTextLenRef still started at 0,
    // so the text-delta effect treated the whole restored string as brand-new and
    // enqueued it a second time on top of what the snapshot had already shown.
    const addToast = vi.fn()
    const loadConversations = vi.fn().mockResolvedValue(undefined)
    const conversationCreated = vi.fn()
    const restoredText = "I'll search for AliExpress desktop PC user feedback and reviews in 2026."
    mockApi.getActiveChatTurn.mockResolvedValue({
      conversationId: 'conv-1',
      turnId: 'turn-1',
      latestSequence: 5,
      assistantText: restoredText,
      status: 'active',
      toolCalls: [],
      activity: null,
    })

    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        activeAgentId: null,
        activeProjectId: null,
        effectiveModel: 'default',
        catalogModels: [],
        addToast,
        loadConversations,
        conversationCreated,
        markConversationGenerating: vi.fn(),
        markConversationDoneGenerating: vi.fn(),
      }),
    )

    await waitFor(() => expect(result.current.liveTurnState.turnId).toBe('turn-1'))
    expect(result.current.displayedContent).toBe(restoredText)

    act(() => {
      emitChatTurnEvent({
        type: 'assistant_text_delta',
        conversationId: 'conv-1',
        turnId: 'turn-1',
        sequence: 6,
        timestamp: 2000,
        chunk: ' More info.',
      })
    })

    expect(result.current.displayedContent).toBe(`${restoredText} More info.`)
  })

  it('shows tool calls that already ran before re-entering a chat mid-generation, not just ones started afterward', async () => {
    // Reproduces the reported follow-up: after the flat-text restore fix, re-entering a
    // chat mid-generation still showed only the lead-in sentence plus whatever tool call
    // happened to start *after* re-entry — every tool call that already ran before the
    // user left stayed invisible until the whole turn settled, since the eager tool-call
    // promotion effect only ever looked at liveTurnState.toolCalls going forward and the
    // restored snapshot never populated it (see useChatLiveTurn's restore action).
    const addToast = vi.fn()
    const loadConversations = vi.fn().mockResolvedValue(undefined)
    const conversationCreated = vi.fn()
    mockApi.getActiveChatTurn.mockResolvedValue({
      conversationId: 'conv-1',
      turnId: 'turn-1',
      latestSequence: 5,
      assistantText: "I'll search for AliExpress desktop PC user feedback.",
      status: 'active',
      toolCalls: [
        { id: 'call-1', toolName: 'WebSearch', args: { query: 'a' }, result: 'first results', success: true, inProgress: false },
      ],
      activity: { state: 'tool', label: 'Running WebSearch', toolName: 'WebSearch' },
    })

    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        activeAgentId: null,
        activeProjectId: null,
        effectiveModel: 'default',
        catalogModels: [],
        addToast,
        loadConversations,
        conversationCreated,
        markConversationGenerating: vi.fn(),
        markConversationDoneGenerating: vi.fn(),
      }),
    )

    await waitFor(() =>
      expect(result.current.messages.some((m) => m.role === 'tool-call' && m.toolCallId === 'call-1')).toBe(true),
    )
    expect(result.current.messages.find((m) => m.toolCallId === 'call-1')).toEqual(
      expect.objectContaining({ toolResult: 'first results', toolInProgress: false }),
    )

    // The restored lead-in text was written *before* the restored tool call — it must be
    // promoted ahead of it, not stuck at the end of the chat as if it were the newest
    // thing (see useChatLiveTurn's restore action: the restored text now gets its own
    // closed textBlocks entry with sequence 0, below every restored tool call's sequence,
    // instead of only living in flat liveTurnState.text where buildChatRenderItems always
    // renders it as the trailing item after every tool call regardless of when it was
    // actually written).
    await waitFor(() =>
      expect(result.current.messages.some((m) => m.role === 'assistant' && m.isFrozenMidTurn)).toBe(true),
    )
    const textIndex = result.current.messages.findIndex((m) => m.role === 'assistant' && m.isFrozenMidTurn)
    const toolIndex = result.current.messages.findIndex((m) => m.toolCallId === 'call-1')
    expect(textIndex).toBeGreaterThanOrEqual(0)
    expect(textIndex).toBeLessThan(toolIndex)
  })
})
