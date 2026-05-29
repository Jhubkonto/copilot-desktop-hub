import type { StateCreator } from 'zustand'
import { isApiError } from '../../../shared/types'
import type { AppState } from '../app-store'
import type { Conversation } from '../types'

export interface ConversationSlice {
  conversations: Conversation[]
  currentConversationId: string | null
  conversationsLoading: boolean
  loadConversations: () => Promise<void>
  selectConversation: (id: string | null) => void
  deleteConversation: (id: string) => Promise<void>
  conversationCreated: (id: string) => Promise<void>
  newChat: (opts?: { projectId?: string | null; agentId?: string | null }) => void
}

export const createConversationSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  ConversationSlice
> = (set, get) => ({
  conversations: [],
  currentConversationId: null,
  conversationsLoading: false,

  loadConversations: async () => {
    set((s) => {
      s.conversationsLoading = true
    })
    try {
      const result = await window.api.listConversations()
      if (isApiError(result)) {
        get().addToast('Failed to load conversations', 'error')
      } else {
        set((s) => {
          s.conversations = result
        })
      }
    } catch {
      get().addToast('Failed to load conversations', 'error')
    } finally {
      set((s) => {
        s.conversationsLoading = false
      })
    }
  },

  selectConversation: (id) => {
    set((s) => {
      s.currentConversationId = id
    })
  },

  deleteConversation: async (id) => {
    try {
      const result = await window.api.deleteConversation(id)
      if (isApiError(result)) {
        get().addToast('Failed to delete conversation', 'error')
        return
      }
      set((s) => {
        if (s.currentConversationId === id) s.currentConversationId = null
      })
      await get().loadConversations()
    } catch {
      get().addToast('Failed to delete conversation', 'error')
    }
  },

  conversationCreated: async (id) => {
    set((s) => {
      s.currentConversationId = id
    })
    await get().loadConversations()
  },

  newChat: (opts) => {
    set((s) => {
      s.currentConversationId = null
      s.activeProjectId = opts?.projectId ?? null
      s.activeAgentId = opts?.agentId ?? null
    })
  }
})