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
})
