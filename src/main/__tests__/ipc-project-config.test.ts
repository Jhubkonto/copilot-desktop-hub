import { describe, expect, it } from 'vitest'
import { parseProjectConfig } from '../project-handlers'

describe('project config parsing', () => {
  it('merges valid JSON config with defaults', () => {
    expect(parseProjectConfig('{"orchestration":{"enabled":true}}')).toEqual(
      expect.objectContaining({ orchestration: expect.objectContaining({ enabled: true }) })
    )
  })

  it('falls back to defaults for invalid JSON config', () => {
    expect(parseProjectConfig('{')).toEqual(expect.objectContaining({ instructions: expect.any(String) }))
  })
})
