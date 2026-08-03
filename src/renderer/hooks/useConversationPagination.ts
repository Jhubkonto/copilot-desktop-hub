import { isApiError, type ConversationPageScope } from '../../shared/types'
import type { Conversation } from '../store/types'
import { useCursorPagination } from './useCursorPagination'

export function useConversationPagination(scope: ConversationPageScope, query = '') {
  const resetKey = JSON.stringify([scope, query.trim()])
  return useCursorPagination<Conversation>({
    resetKey,
    loadPage: async (cursor, requestId) => {
      const result = await window.api.listConversationPage({
        requestId,
        scope,
        query: query.trim() || undefined,
        cursor,
        limit: 30,
      })
      if (isApiError(result)) throw new Error(result.error)
      return result
    },
  })
}
