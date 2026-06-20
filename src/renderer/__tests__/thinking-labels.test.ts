import { describe, expect, it } from 'vitest'
import { getThinkingBlockLabel } from '../components/chat/ChatMessages'

describe('getThinkingBlockLabel', () => {
  it('labels Codex activity blocks separately from reasoning summaries', () => {
    expect(getThinkingBlockLabel('codex-activity')).toBe('Codex activity')
    expect(getThinkingBlockLabel('codex-reasoning-summary')).toBe('Reasoning summary')
    expect(getThinkingBlockLabel('reasoning-0')).toBe('Reasoning')
  })
})
