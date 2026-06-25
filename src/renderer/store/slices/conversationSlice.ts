import type { StateCreator } from 'zustand'
import { isApiError } from '../../../shared/types'
import type { AppState } from '../app-store'
import type { Conversation } from '../types'

export interface ConversationSlice {
  conversations: Conversation[]
  currentConversationId: string | null
  conversationsLoading: boolean
  completedConversationIds: string[]
  loadConversations: () => Promise<void>
  selectConversation: (id: string | null) => void
  deleteConversation: (id: string) => Promise<void>
  conversationCreated: (id: string) => Promise<void>
  newChat: (opts?: { projectId?: string | null; agentId?: string | null }) => void
  markConversationComplete: (id: string) => Promise<void>
  markConversationIncomplete: (id: string) => Promise<void>
  handleConversationCompleted: (conversationId: string) => void
  handleConversationIncompleted: (conversationId: string) => void
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
  completedConversationIds: [],

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
          s.completedConversationIds = result
            .filter((c) => c.completed_at != null)
            .map((c) => c.id)
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

  markConversationComplete: async (id) => {
    try {
      await window.api.markConversationComplete(id)
      set((s) => {
        if (!s.completedConversationIds.includes(id)) {
          s.completedConversationIds.push(id)
        }
      })
    } catch {
      get().addToast('Failed to mark conversation complete', 'error')
    }
  },

  markConversationIncomplete: async (id) => {
    try {
      await window.api.markConversationIncomplete(id)
      set((s) => {
        s.completedConversationIds = s.completedConversationIds.filter((cid) => cid !== id)
      })
    } catch {
      get().addToast('Failed to mark conversation incomplete', 'error')
    }
  },

  handleConversationCompleted: (conversationId) => {
    set((s) => {
      if (!s.completedConversationIds.includes(conversationId)) {
        s.completedConversationIds.push(conversationId)
      }
    })
  },

  handleConversationIncompleted: (conversationId) => {
    set((s) => {
      s.completedConversationIds = s.completedConversationIds.filter((id) => id !== conversationId)
    })
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
    const projectId = opts?.projectId ?? null
    const agentId = opts?.agentId ?? null
    let resolvedAgentId = agentId
    if (projectId && !agentId) {
      const agents = get().projectAgents[projectId] ?? []
      const primary = agents.find((a) => a.isPrimary) ?? agents[0] ?? null
      resolvedAgentId = primary?.agentId ?? null
    }
    set((s) => {
      s.currentConversationId = null
      s.activeProjectId = projectId
      s.activeAgentId = resolvedAgentId
    })
  }
})