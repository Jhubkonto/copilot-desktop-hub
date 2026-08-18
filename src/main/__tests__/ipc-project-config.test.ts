import { describe, expect, it } from 'vitest'
import { parseProjectConfig } from '../project-handlers'

describe('project config parsing', () => {
  it('derives workflow mode from legacy orchestrationEnabled flag', () => {
    expect(parseProjectConfig('{"orchestrationEnabled":true}')).toEqual(
      expect.objectContaining({ workflowMode: 'orchestrated', orchestrationEnabled: true })
    )
  })

  it('keeps explicit workflow mode and mirrors orchestrationEnabled from it', () => {
    expect(parseProjectConfig('{"workflowMode":"automated-delegation","orchestrationEnabled":true}')).toEqual(
      expect.objectContaining({ workflowMode: 'automated-delegation', orchestrationEnabled: false })
    )
  })

  it('self-heals the pre-rename "manual-delegation" workflow mode to "automated-delegation"', () => {
    expect(parseProjectConfig('{"workflowMode":"manual-delegation","orchestrationEnabled":true}')).toEqual(
      expect.objectContaining({ workflowMode: 'automated-delegation', orchestrationEnabled: false })
    )
  })

  it('falls back to defaults for invalid JSON config', () => {
    expect(parseProjectConfig('{')).toEqual(expect.objectContaining({ instructions: expect.any(String) }))
  })

  it('normalizes the project default thinking effort', () => {
    expect(parseProjectConfig('{"defaultThinkingEffort":"high"}').defaultThinkingEffort).toBe('high')
    expect(parseProjectConfig('{"defaultThinkingEffort":"invalid"}').defaultThinkingEffort).toBeNull()
  })
})
