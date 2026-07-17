import { useEffect, useReducer } from 'react'
import type { ActiveChatTurnSnapshot, ChatTurnEvent } from '../../shared/chat-turn-types'
import { chatTurnReducer, createEmptyChatTurnState, type ChatTurnState, type ChatTurnThinkingBlock, type ChatTurnToolCall } from './chat-turn-reducer'

type ChatLiveTurnAction =
  | { type: 'reset'; conversationId: string | null }
  | { type: 'event'; event: ChatTurnEvent }
  | { type: 'restore'; conversationId: string; snapshot: ActiveChatTurnSnapshot }

function liveTurnReducer(state: ChatTurnState, action: ChatLiveTurnAction): ChatTurnState {
  if (action.type === 'reset') return createEmptyChatTurnState(action.conversationId)
  if (action.type === 'restore') {
    // Only seed from the snapshot while this conversation still has no turn of its own —
    // a live event may have already raced ahead of the async fetch (e.g. a brand-new
    // turn_started arrived first), in which case the snapshot is stale and must not
    // clobber it. Coarser than live state (no thinking/text-segment structure —
    // active-chat-turns.ts doesn't track those), but restoring the tool calls that
    // already ran plus the accumulated reply text beats showing a bare "Thinking…"
    // indicator with everything already generated invisible until the turn finishes,
    // which is what leaving mid-generation and coming back used to look like.
    if (action.conversationId !== state.conversationId || state.turnId) return state
    // Restored calls have no meaningful sequence of their own (active-chat-turns.ts
    // doesn't record one per call) — index order is still their real chronological
    // order (upserted in first-seen order). Start at 1, reserving 0 for the restored
    // text block below, so it always sorts before every restored tool call — matching
    // the fact that it was written before any of them, not after.
    const toolCalls: ChatTurnToolCall[] = action.snapshot.toolCalls.map((tc, index) => ({
      id: tc.id,
      toolName: tc.toolName,
      serverName: tc.serverName,
      args: tc.args,
      result: tc.result,
      success: tc.success,
      inProgress: tc.inProgress,
      firstSeenSequence: index + 1,
    }))
    // Without this, the restored text has no textBlocks entry at all, so
    // buildChatRenderItems' "nothing open → fall back to flat text" branch treats it as
    // the segment CURRENTLY being typed and renders it as the trailing live-assistant-text
    // item — which is always positioned after every tool call, regardless of sequence.
    // That's right for a segment that's genuinely still open, but wrong for one that (per
    // the restored tool calls) was already interrupted before the snapshot was taken: it
    // needs its own closed, sequence-0 textBlocks entry instead, so it renders as a
    // properly-ordered live-text-segment ahead of the tool calls that came after it — the
    // same path a live turn's own already-closed lead-in segment takes. If no tool calls
    // happened yet, the text is presumably still open (mid-sentence) and stays the trailing
    // item exactly as before.
    const textBlocks = new Map<string, ChatTurnThinkingBlock>()
    if (action.snapshot.assistantText) {
      textBlocks.set('restored-text', {
        blockId: 'restored-text',
        content: action.snapshot.assistantText,
        done: toolCalls.length > 0,
        firstSeenSequence: 0,
      })
    }
    return {
      ...state,
      turnId: action.snapshot.turnId,
      lastSequence: action.snapshot.latestSequence,
      status: action.snapshot.status === 'active' ? 'streaming' : action.snapshot.status,
      text: action.snapshot.assistantText,
      textBlocks,
      toolCalls,
      activity: action.snapshot.activity,
    }
  }
  return chatTurnReducer(state, action.event)
}

export function useChatLiveTurn(conversationId: string | null): ChatTurnState {
  const [state, dispatch] = useReducer(liveTurnReducer, conversationId, createEmptyChatTurnState)

  useEffect(() => {
    dispatch({ type: 'reset', conversationId })
    if (!conversationId) return
    let cancelled = false
    window.api.getActiveChatTurn(conversationId).then((snapshot) => {
      if (cancelled || !snapshot || snapshot.status !== 'active') return
      dispatch({ type: 'restore', conversationId, snapshot })
    })
    return () => {
      cancelled = true
    }
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
