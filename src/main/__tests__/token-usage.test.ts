import { describe, expect, it } from 'vitest'
import { TurnUsageAccumulator } from '../../shared/token-usage'

describe('TurnUsageAccumulator', () => {
  it('coalesces repeated request updates and sums distinct requests', () => {
    const accumulator = new TurnUsageAccumulator()
    const first = { inputTokens: 100, outputTokens: 20, quality: 'provider' as const, source: 'openai', requestId: 'round-1' }
    expect(accumulator.add(first)).toMatchObject({ inputTokens: 100, outputTokens: 20, requestCount: 1 })
    expect(accumulator.add(first)).toMatchObject({ inputTokens: 100, outputTokens: 20, requestCount: 1 })
    expect(accumulator.add({ ...first, requestId: 'round-2', inputTokens: 140, outputTokens: 30 })).toMatchObject({ inputTokens: 240, outputTokens: 50, requestCount: 2 })
  })

  it('marks a completed turn without losing accumulated usage', () => {
    const accumulator = new TurnUsageAccumulator()
    accumulator.add({ inputTokens: 10, outputTokens: 2, quality: 'provider', source: 'cli' })
    expect(accumulator.markComplete()).toMatchObject({ inputTokens: 10, outputTokens: 2, complete: true })
  })
})
