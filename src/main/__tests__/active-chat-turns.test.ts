import { beforeEach, describe, expect, it } from 'vitest'
import {
  activeChatTurnDiagnostics,
  clearActiveChatTurn,
  getActiveChatTurnSnapshot,
  pruneActiveChatTurns,
  recordActiveChatTurnEvent,
  resetActiveChatTurnsForTest,
} from '../active-chat-turns'
import type { ChatTurnEvent } from '../../shared/chat-turn-types'

function event(type: ChatTurnEvent['type'], sequence: number, extra: Record<string, unknown> = {}): ChatTurnEvent {
  return {
    type,
    conversationId: 'conv-1',
    turnId: 'turn-1',
    sequence,
    timestamp: sequence,
    ...extra,
  } as ChatTurnEvent
}

describe('active chat turns', () => {
  beforeEach(resetActiveChatTurnsForTest)

  it('builds an ordered authoritative snapshot and drops duplicates', () => {
    recordActiveChatTurnEvent(event('turn_started', 1))
    recordActiveChatTurnEvent(event('assistant_text_delta', 2, { chunk: 'hello' }))
    recordActiveChatTurnEvent(event('assistant_text_delta', 2, { chunk: 'duplicate' }))
    recordActiveChatTurnEvent(event('assistant_text_delta', 3, { chunk: ' world' }))
    expect(getActiveChatTurnSnapshot('conv-1')).toMatchObject({
      turnId: 'turn-1',
      latestSequence: 3,
      assistantText: 'hello world',
      status: 'active',
    })
  })

  it('marks terminal snapshots for reconnect recovery', () => {
    recordActiveChatTurnEvent(event('turn_started', 1))
    recordActiveChatTurnEvent(event('turn_completed', 2))
    expect(getActiveChatTurnSnapshot('conv-1')?.status).toBe('completed')
  })

  it('records sequence gaps while preserving ordered replay', () => {
    recordActiveChatTurnEvent(event('turn_started', 1))
    recordActiveChatTurnEvent(event('assistant_text_delta', 3, { chunk: 'after gap' }))
    expect(activeChatTurnDiagnostics.read().sequenceGaps).toBe(1)
    expect(getActiveChatTurnSnapshot('conv-1')?.assistantText).toBe('after gap')
  })

  it('serves immutable snapshots to simultaneous consumers', () => {
    recordActiveChatTurnEvent(event('turn_started', 1))
    recordActiveChatTurnEvent(event('assistant_text_delta', 2, { chunk: 'shared' }))
    const desktop = getActiveChatTurnSnapshot('conv-1')
    const android = getActiveChatTurnSnapshot('conv-1')
    expect(desktop).toEqual(android)
    if (desktop) desktop.assistantText = 'mutated consumer copy'
    expect(getActiveChatTurnSnapshot('conv-1')?.assistantText).toBe('shared')
  })

  it('cleans persisted and expired terminal turns', () => {
    recordActiveChatTurnEvent(event('turn_started', 1))
    clearActiveChatTurn('conv-1', 'other-turn')
    expect(getActiveChatTurnSnapshot('conv-1')).not.toBeNull()
    clearActiveChatTurn('conv-1', 'turn-1')
    expect(getActiveChatTurnSnapshot('conv-1')).toBeNull()

    recordActiveChatTurnEvent(event('turn_started', 1))
    recordActiveChatTurnEvent(event('turn_completed', 2))
    pruneActiveChatTurns(Date.now() + 30_001)
    expect(getActiveChatTurnSnapshot('conv-1')).toBeNull()
  })
})
