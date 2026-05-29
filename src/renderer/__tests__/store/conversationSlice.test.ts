import { beforeEach, describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { StateCreator } from 'zustand'
import {
  createConversationSlice,
  type ConversationSlice
} from '../../store/slices/conversationSlice'
import type { UiSlice } from '../../store/slices/uiSlice'
import { setupMockApi, type MockApi } from '../../../test/mocks/api'

let mockApi: MockApi

type TestState = ConversationSlice & Pick<UiSlice, 'toasts' | 'addToast'>

function createConversationStore() {
  return create<TestState>()(
    immer((set, get, store) => ({
      toasts: [],
      addToast: (message, type = 'info') => {
        const id = `toast-${get().toasts.length + 1}`
        set((s) => {
          s.toasts.push({ id, message, type })
        })
      },
      ...(
        createConversationSlice as unknown as StateCreator<
          TestState,
          [['zustand/immer', never]],
          [],
          ConversationSlice
        >
      )(set, get, store)
    }))
  )
}

beforeEach(() => {
  mockApi = setupMockApi()
})

describe('conversationSlice', () => {
  it('loadConversations populates conversations and clears loading', async () => {
    const store = createConversationStore()
    mockApi.listConversations.mockResolvedValue([
      { id: 'c1', agent_id: null, title: 'Chat 1', created_at: 1, updated_at: 1 }
    ])

    await store.getState().loadConversations()

    expect(store.getState().conversations).toEqual([
      { id: 'c1', agent_id: null, title: 'Chat 1', created_at: 1, updated_at: 1 }
    ])
    expect(store.getState().conversationsLoading).toBe(false)
  })

  it('selectConversation updates the current conversation id', () => {
    const store = createConversationStore()

    store.getState().selectConversation('c1')

    expect(store.getState().currentConversationId).toBe('c1')
  })

  it('newChat clears the current conversation selection', () => {
    const store = createConversationStore()
    store.setState({ currentConversationId: 'c1' })

    store.getState().newChat()

    expect(store.getState().currentConversationId).toBeNull()
  })
})
