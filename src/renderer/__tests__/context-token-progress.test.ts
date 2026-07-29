import { describe, expect, it } from 'vitest'
import {
  estimateCharacterTokens,
  estimateInputTokens,
  formatEstimatedTokens,
} from '../../shared/token-estimate'
import { liveActivityLabel } from '../components/chat/ChatMessages'

describe('context token progress', () => {
  it('uses the shared provider-neutral estimate and formats it as approximate', () => {
    expect(estimateCharacterTokens(4_001)).toBe(1_001)
    expect(estimateInputTokens('abcd')).toBe(1)
    expect(estimateInputTokens({ url: 'data:image/png;base64,AAAA' })).toBeGreaterThanOrEqual(1_000)
    expect(formatEstimatedTokens(12_345)).toBe('~12,345 tokens')
  })

  it('shows token-bearing activity labels instead of replacing them with Thinking', () => {
    expect(liveActivityLabel('Starting CLI agent · ~12,345 tokens', 3))
      .toBe('Starting CLI agent · ~12,345 tokens')
    expect(liveActivityLabel('Generating response', 3)).toBe('Thinking · 3s')
  })
})
