import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAvailableModelIds, getModelLabel } from '../../shared/models'
import type { CatalogModel } from '../../shared/types'
import { setupMockApi } from '../../test/mocks/api'

vi.mock('../../renderer/store/app-store', () => ({
  useAppStore: vi.fn(),
}))

const LIVE_CATALOG: CatalogModel[] = [
  { id: 'gpt-5.4', name: 'GPT-5.4 Live', vendor: 'OpenAI', capabilities: ['chat'], contextWindow: 256_000 },
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5 Live', vendor: 'Anthropic', capabilities: ['chat'], contextWindow: 200_000 },
]

beforeEach(() => {
  setupMockApi()
})

describe('dynamic model catalog UI', () => {
  it('mc-ui-3 preserves a legacy selected model that is missing from the live catalog', () => {
    expect(getAvailableModelIds(LIVE_CATALOG, 'legacy-model')).toEqual([
      'default',
      'gpt-5.4',
      'claude-sonnet-4.5',
      'legacy-model',
    ])
  })

  it('mc-ui-4 prefers catalog labels, falls back to static labels, then model ID', () => {
    expect(getModelLabel('gpt-5.4', LIVE_CATALOG)).toBe('GPT-5.4 Live')
    expect(getModelLabel('claude-sonnet-4.5', LIVE_CATALOG)).toBe('Claude Sonnet 4.5 Live')
    expect(getModelLabel('gpt-5.4', [])).toBe('GPT-5.4')
    expect(getModelLabel('legacy-model', LIVE_CATALOG)).toBe('legacy-model')
    expect(getModelLabel('legacy-model', [])).toBe('legacy-model')
  })
})
