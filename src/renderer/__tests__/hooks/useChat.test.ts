import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useChat } from '../../../renderer/hooks/useChat'
import { setupMockApi, type MockApi } from '../../../test/mocks/api'

let mockApi: MockApi
let streamCallback: ((chunk: string | null) => void) | null = null
let remoteMessageCallback: ((data: { conversationId: string; content: string; images?: { id: string; name: string; dataUrl: string }[] }) => void) | null = null

beforeEach(() => {
  mockApi = setupMockApi()
  streamCallback = null
  remoteMessageCallback = null
  mockApi.onStreamResponse.mockImplementation((cb: (chunk: string | null) => void) => {
    streamCallback = cb
    return () => {
      streamCallback = null
    }
  })
  mockApi.onRemoteMessage.mockImplementation((cb: (data: { conversationId: string; content: string; images?: { id: string; name: string; dataUrl: string }[] }) => void) => {
    remoteMessageCallback = cb
    return () => {
      remoteMessageCallback = null
    }
  })
  mockApi.onStreamError.mockImplementation(() => () => undefined)
  mockApi.onTeamActivity.mockImplementation(() => () => undefined)
})

describe('useChat', () => {
  it('ignores tool-call events from a different or background (null) conversationId', () => {
    const addToast = vi.fn()
    const loadConversations = vi.fn().mockResolvedValue(undefined)
    const conversationCreated = vi.fn()
    let toolCallCallback: ((data: {
      toolName: string
      serverName: string
      args: Record<string, unknown>
      result: string
      success: boolean
      conversationId: string | null
    }) => void) | null = null
    mockApi.onToolCallEvent.mockImplementation((cb: typeof toolCallCallback extends null ? never : NonNullable<typeof toolCallCallback>) => {
      toolCallCallback = cb
      return () => { toolCallCallback = null }
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

    act(() => {
      toolCallCallback?.({
        toolName: 'read_file', serverName: 'Project Wiki', args: {}, result: 'leaked', success: true, conversationId: null,
      })
      toolCallCallback?.({
        toolName: 'read_file', serverName: 'Project Wiki', args: {}, result: 'other chat', success: true, conversationId: 'conv-2',
      })
    })

    expect(result.current.messages).toEqual([])

    act(() => {
      toolCallCallback?.({
        toolName: 'read_file', serverName: 'Project Wiki', args: {}, result: 'real', success: true, conversationId: 'conv-1',
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
      result.current.streamModelRef.current = 'gpt-4.1'
    })

    act(() => {
      streamCallback?.('Hello')
      streamCallback?.(' world')
    })

    expect(result.current.streamingContent).toBe('Hello world')

    act(() => {
      streamCallback?.(null)
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
