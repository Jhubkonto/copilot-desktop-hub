import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useChat } from '../../../renderer/hooks/useChat'
import { setupMockApi, type MockApi } from '../../../test/mocks/api'

let mockApi: MockApi
let streamCallback: ((chunk: string | null) => void) | null = null

beforeEach(() => {
  mockApi = setupMockApi()
  streamCallback = null
  mockApi.onStreamResponse.mockImplementation((cb: (chunk: string | null) => void) => {
    streamCallback = cb
    return () => {
      streamCallback = null
    }
  })
  mockApi.onStreamError.mockImplementation(() => () => undefined)
  mockApi.onTeamActivity.mockImplementation(() => () => undefined)
})

describe('useChat', () => {
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
        addToast,
        loadConversations,
        conversationCreated,
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
        addToast,
        loadConversations,
        conversationCreated,
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
        addToast,
        loadConversations,
        conversationCreated,
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
})
