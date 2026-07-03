import { describe, expect, it } from 'vitest'
import { resolveToolsSupported } from '../../shared/models'
import type { CatalogModel } from '../../shared/types'

function catalogModel(overrides: Partial<CatalogModel>): CatalogModel {
  return { id: 'model-1', name: 'Model', vendor: 'test', capabilities: [], ...overrides }
}

describe('resolveToolsSupported', () => {
  it('treats a non-OpenRouter provider as tool-capable when the model is unknown (optimistic)', () => {
    expect(resolveToolsSupported('openai', 'some-unknown-model', [])).toBe(true)
  })

  it('treats a non-OpenRouter provider as not tool-capable when the catalog explicitly says so', () => {
    const catalog = [catalogModel({ id: 'no-tools-model', capabilities: ['vision'] })]
    expect(resolveToolsSupported('openai', 'no-tools-model', catalog)).toBe(false)
  })

  it('treats an OpenRouter model with a catalog entry lacking tool_calls as not tool-capable', () => {
    const catalog = [catalogModel({ id: 'hermes-4-70b', capabilities: ['vision'] })]
    expect(resolveToolsSupported('openrouter', 'hermes-4-70b', catalog)).toBe(false)
  })

  it('treats an OpenRouter model with a catalog entry including tool_calls as tool-capable', () => {
    const catalog = [catalogModel({ id: 'gpt-4o-mini', capabilities: ['tool_calls'] })]
    expect(resolveToolsSupported('openrouter', 'gpt-4o-mini', catalog)).toBe(true)
  })

  it('treats an OpenRouter model with no catalog entry and a known-capable family name as tool-capable', () => {
    expect(resolveToolsSupported('openrouter', 'anthropic/claude-sonnet-4.5', [])).toBe(true)
  })

  it('treats an OpenRouter model with no catalog entry and an unrecognized family name as NOT tool-capable', () => {
    // This is the exact scenario that caused a real investigation to silently produce an empty
    // plan: Hermes has no OpenRouter catalog capability entry and doesn't match any known-capable
    // family, so it must be conservatively treated as unable to use native tool calling.
    expect(resolveToolsSupported('openrouter', 'nousresearch/hermes-4-70b', [])).toBe(false)
  })

  it('treats the "default" model id as tool-capable on OpenRouter', () => {
    expect(resolveToolsSupported('openrouter', 'default', [])).toBe(true)
  })

  it('treats a null/undefined model id as tool-capable on OpenRouter', () => {
    expect(resolveToolsSupported('openrouter', null, [])).toBe(true)
    expect(resolveToolsSupported('openrouter', undefined, [])).toBe(true)
  })

  it('strips a leading ~ routing prefix before matching known-capable families', () => {
    expect(resolveToolsSupported('openrouter', '~anthropic/claude-sonnet-4.5', [])).toBe(true)
  })
})
