import { describe, it, expect } from 'vitest'
import { isFullAutoApprove, resolveAgenticPolicy } from '../agentic-policy'
import type { AgentConfig } from '../../shared/types'

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    icon: '🤖',
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: 4096,
    contextDirectories: [],
    contextFiles: [],
    mcpServers: [],
    agenticMode: false,
    tools: {
      fileEdit: { enabled: true, approval: 'auto', instructions: '' },
      terminal: { enabled: false, approval: 'always-ask', instructions: '' },
      webFetch: { enabled: true, approval: 'auto', instructions: '' },
    },
    responseFormat: 'default',
    ...overrides,
  }
}

describe('isFullAutoApprove', () => {
  it('returns false when fullAutoApprove is absent', () => {
    expect(isFullAutoApprove(makeAgent())).toBe(false)
  })

  it('returns false when fullAutoApprove is false', () => {
    expect(isFullAutoApprove(makeAgent({ fullAutoApprove: false }))).toBe(false)
  })

  it('returns false when fullAutoApprove is undefined', () => {
    expect(isFullAutoApprove(makeAgent({ fullAutoApprove: undefined }))).toBe(false)
  })

  it('returns true when fullAutoApprove is true', () => {
    expect(isFullAutoApprove(makeAgent({ fullAutoApprove: true }))).toBe(true)
  })
})

describe('resolveAgenticPolicy', () => {
  it('returns normal preset for a plain agent', () => {
    const result = resolveAgenticPolicy(makeAgent())
    expect(result.preset).toBe('normal')
    expect(result.neverAllow).toEqual([])
  })

  it('returns autonomous preset when agenticMode is true', () => {
    const result = resolveAgenticPolicy(makeAgent({ agenticMode: true }))
    expect(result.preset).toBe('autonomous')
  })

  it('returns autonomous preset with empty neverAllow when fullAutoApprove is true', () => {
    const result = resolveAgenticPolicy(makeAgent({ fullAutoApprove: true }))
    expect(result.preset).toBe('autonomous')
    expect(result.neverAllow).toEqual([])
  })

  it('clears neverAllow when fullAutoApprove is true even if agenticMode is false', () => {
    const result = resolveAgenticPolicy(makeAgent({ fullAutoApprove: true, agenticMode: false }))
    expect(result.preset).toBe('autonomous')
    expect(result.neverAllow).toEqual([])
  })
})
