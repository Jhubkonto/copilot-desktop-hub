import { useEffect, useReducer } from 'react'
import type { ChatTurnEvent } from '../../shared/chat-turn-types'
import { chatTurnReducer, createEmptyChatTurnState, type ChatTurnState } from './chat-turn-reducer'

type ChatLiveTurnAction =
  | { type: 'reset'; conversationId: string | null }
  | { type: 'event'; event: ChatTurnEvent }

function liveTurnReducer(state: ChatTurnState, action: ChatLiveTurnAction): ChatTurnState {
  if (action.type === 'reset') return createEmptyChatTurnState(action.conversationId)
  return chatTurnReducer(state, action.event)
}

export function useChatLiveTurn(conversationId: string | null): ChatTurnState {
  const [state, dispatch] = useReducer(liveTurnReducer, conversationId, createEmptyChatTurnState)

  useEffect(() => {
    dispatch({ type: 'reset', conversationId })
  }, [conversationId])

  useEffect(() => {
    if (!conversationId) return

    return window.api.onChatTurnEvent((event) => {
      if (event.conversationId !== conversationId) return
      dispatch({ type: 'event', event })
    })
  }, [conversationId])

  return state
}
