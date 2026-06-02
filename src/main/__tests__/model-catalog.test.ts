import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogModel } from '../../shared/types'

const state = vi.hoisted(() => {
  const store = new Map<string, string>()
  return { store }
})

vi.mock('../database', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => ({
      get: (key: string) => {
        if (!sql.startsWith('SELECT value FROM settings')) return undefined
        const value = state.store.get(key)
        return value === undefined ? undefined : { value }
      },
      run: (key: string, value: string) => {
        state.store.set(key, value)
        return { changes: 1 }
      },
    }),
  }),
}))

import { STATIC_SEED, __resetModelCatalogForTests, diffCatalog, getCachedCatalog, loadModelCatalog } from '../model-catalog'

describe('model catalog', () => {
  beforeEach(() => {
    state.store.clear()
    __resetModelCatalogForTests()
  })

  it('seeds the cache from the static BYOK catalog', () => {
    const models = getCachedCatalog()
    expect(models.length).toBeGreaterThan(0)
    expect(models.some((model) => model.id === 'gpt-5-mini')).toBe(true)
    expect(models.some((model) => model.id === 'claude-sonnet-4.6')).toBe(true)
  })

  it('diffs model additions and removals', () => {
    const oldList: CatalogModel[] = [{ id: 'gpt-4.1', name: 'GPT-4.1', vendor: 'OpenAI', capabilities: ['tool_calls'] }]
    const newList: CatalogModel[] = [{ id: 'gpt-5-mini', name: 'GPT-5 mini', vendor: 'OpenAI', capabilities: ['tool_calls'] }]
    expect(diffCatalog(oldList, newList)).toEqual({ added: ['gpt-5-mini'], removed: ['gpt-4.1'], changed: [] })
  })

  it('emits a catalog update event', async () => {
    state.store.set('model_catalog_snapshot', JSON.stringify([{ id: 'legacy-model', name: 'Legacy', vendor: 'OpenAI', capabilities: ['tool_calls'] }]))
    const send = vi.fn()

    await loadModelCatalog({ webContents: { send } } as unknown as Electron.BrowserWindow)

    expect(send).toHaveBeenCalledWith('model:catalog-updated', {
      models: STATIC_SEED.slice().sort((a, b) => a.id.localeCompare(b.id)),
      changeSummary: expect.stringContaining('Model catalog refreshed'),
    })
  })
})
