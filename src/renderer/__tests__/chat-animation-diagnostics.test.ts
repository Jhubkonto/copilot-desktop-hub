import { describe, expect, it } from 'vitest'
import { ChatAnimationDiagnostics } from '../../shared/chat-animation-diagnostics'
import { shouldFollowAnimatedGrowth } from '../chat-scroll-policy'

describe('chat animation diagnostics and scroll policy', () => {
  it('tracks backlog lag, duplicates, gaps, and snapshot recovery', () => {
    const diagnostics = new ChatAnimationDiagnostics()
    diagnostics.recordBacklog(20, 100, 175)
    diagnostics.recordSequence(4, 4)
    diagnostics.recordSequence(4, 7)
    diagnostics.recordSnapshotRecovery()
    expect(diagnostics.read()).toEqual({
      backlogLength: 20,
      revealLagMs: 75,
      droppedDuplicateEvents: 1,
      sequenceGaps: 1,
      snapshotRecoveries: 1,
    })
  })

  it('follows animated growth only while the user remains at the bottom', () => {
    expect(shouldFollowAnimatedGrowth(false)).toBe(true)
    expect(shouldFollowAnimatedGrowth(true)).toBe(false)
  })
})
