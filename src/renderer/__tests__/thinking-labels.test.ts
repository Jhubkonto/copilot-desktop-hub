import { describe, expect, it } from 'vitest'
import { getThinkingBlockLabel } from '../components/chat/ChatMessages'

describe('getThinkingBlockLabel', () => {
  it('labels Codex reasoning summaries distinctly from generic reasoning blocks', () => {
    // codex-activity is no longer a thinking-block id at all — Codex CLI lifecycle
    // narration now goes out as a transient 'activity' event (see cli-adapters/codex.ts),
    // not a persisted thinking block, so there's no label case for it here anymore.
    expect(getThinkingBlockLabel('codex-reasoning-summary-0')).toBe('Reasoning summary')
    expect(getThinkingBlockLabel('reasoning-0')).toBe('Reasoning')
  })
})
