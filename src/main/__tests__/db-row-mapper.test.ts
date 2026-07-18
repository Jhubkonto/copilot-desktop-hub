import { describe, it, expect } from 'vitest'
import { mapRow, snakeToCamel } from '../db-row-mapper'

describe('snakeToCamel', () => {
  it('converts snake_case to camelCase', () => {
    expect(snakeToCamel('agent_id')).toBe('agentId')
    expect(snakeToCamel('next_run_at')).toBe('nextRunAt')
    expect(snakeToCamel('id')).toBe('id')
    expect(snakeToCamel('workflow_run_ids')).toBe('workflowRunIds')
  })
})

describe('mapRow', () => {
  it('maps snake_case columns to camelCase keys and null-coalesces undefined', () => {
    const result = mapRow<{ id: string; agentId: string | null; createdAt: number }>({
      id: 'a1',
      agent_id: null,
      created_at: 123,
    })
    expect(result).toEqual({ id: 'a1', agentId: null, createdAt: 123 })
  })

  it('coerces listed boolean keys from 0/1', () => {
    const result = mapRow<{ enabled: boolean; isDefault: boolean }>(
      { enabled: 1, is_default: 0 },
      { booleans: ['enabled', 'isDefault'] },
    )
    expect(result).toEqual({ enabled: true, isDefault: false })
  })

  it('parses *_json columns under the suffix-stripped key', () => {
    const result = mapRow<{ toolPolicy: { preApproved: string[] } }>({
      tool_policy_json: '{"preApproved":["a"]}',
    })
    expect(result.toolPolicy).toEqual({ preApproved: ['a'] })
  })

  it('applies json fallbacks for null, empty, and malformed values', () => {
    const fallback = { preApproved: [] }
    expect(
      mapRow<{ toolPolicy: unknown }>({ tool_policy_json: null }, { jsonFallbacks: { toolPolicy: fallback } }).toolPolicy,
    ).toEqual(fallback)
    expect(
      mapRow<{ toolPolicy: unknown }>({ tool_policy_json: '' }, { jsonFallbacks: { toolPolicy: fallback } }).toolPolicy,
    ).toEqual(fallback)
    expect(
      mapRow<{ toolPolicy: unknown }>({ tool_policy_json: '{oops' }, { jsonFallbacks: { toolPolicy: fallback } }).toolPolicy,
    ).toEqual(fallback)
    expect(mapRow<{ other: unknown }>({ other_json: null }).other).toBeNull()
  })

  it('skips excluded columns', () => {
    const result = mapRow<Record<string, unknown>>(
      { id: 'x', config_json: '{"a":1}' },
      { exclude: ['config_json'] },
    )
    expect(result).toEqual({ id: 'x' })
  })
})
