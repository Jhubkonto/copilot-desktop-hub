import { describe, expect, it } from 'vitest'
import type { Conversation } from '../store/types'
import { withLivePinState } from '../components/section-pane/shared'

function conversation(id: string, pinned: number): Conversation {
  return {
    id,
    agent_id: null,
    project_id: null,
    title: id,
    pinned,
    created_at: 1,
    updated_at: 1,
  }
}

describe('withLivePinState', () => {
  it('uses the optimistic store value when a paginated row has stale pin state', () => {
    const stalePage = [conversation('chat-1', 0)]
    const liveStore = [conversation('chat-1', 1)]

    expect(withLivePinState(stalePage, liveStore)[0].pinned).toBe(1)
  })

  it('also reflects an optimistic unpin and preserves rows absent from the live store', () => {
    const stalePage = [conversation('chat-1', 1), conversation('older-chat', 1)]
    const liveStore = [conversation('chat-1', 0)]

    const reconciled = withLivePinState(stalePage, liveStore)
    expect(reconciled.map((item) => item.pinned)).toEqual([0, 1])
  })
})
