import { describe, expect, it } from 'vitest'
import {
  appendChatDelta,
  createChatAnimationState,
  revealFrameSize,
  snapChatAnimation,
} from '../../shared/chat-animation'

describe('chat animation model', () => {
  it('keeps authoritative text separate from the reveal cursor', () => {
    const next = appendChatDelta(createChatAnimationState(), { turnId: 'turn-1', sequence: 2, chunk: 'hello' })
    expect(next.authoritativeText).toBe('hello')
    expect(next.displayedOffset).toBe(0)
  })

  it('ignores duplicate and stale-turn deltas', () => {
    const current = appendChatDelta(createChatAnimationState(), { turnId: 'turn-1', sequence: 2, chunk: 'a' })
    expect(appendChatDelta(current, { turnId: 'turn-1', sequence: 2, chunk: 'duplicate' })).toBe(current)
    expect(appendChatDelta(current, { turnId: 'turn-old', sequence: 3, chunk: 'stale' })).toBe(current)
  })

  it('snaps restored text and adapts frame work to backlog', () => {
    expect(snapChatAnimation('turn-1', 'restored', 8).displayedOffset).toBe(8)
    expect(revealFrameSize(2)).toBe(2)
    expect(revealFrameSize(10_000)).toBeGreaterThan(revealFrameSize(100))
    expect(revealFrameSize(10_000)).toBeLessThanOrEqual(64)
  })
})
