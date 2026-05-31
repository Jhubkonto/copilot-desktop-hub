import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogModel } from '../../shared/types'

const OLD_MODELS: CatalogModel[] = [
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', vendor: 'Anthropic', capabilities: ['chat'], contextWindow: 200_000 },
  { id: 'gpt-4.1', name: 'GPT-4.1', vendor: 'OpenAI', capabilities: ['chat'], contextWindow: 128_000 },
]

const NEW_MODELS: CatalogModel[] = [
  { id: 'gpt-4.1', name: 'GPT-4.1 Turbo', vendor: 'OpenAI', capabilities: ['chat', 'vision'], contextWindow: 256_000 },
  { id: 'gpt-5.4', name: 'GPT-5.4', vendor: 'OpenAI', capabilities: ['chat'], contextWindow: 256_000 },
]

type SnapshotValue = string | undefined

async function importCopilotApiWithResponses(responses: Array<{ status: number; data: string }>, githubToken = 'gh-token') {
  vi.resetModules()
  const httpsRequestWithResponse = vi.fn()
  for (const response of responses) {
    httpsRequestWithResponse.mockResolvedValueOnce(response)
  }

  vi.doMock('electron', () => ({ BrowserWindow: class BrowserWindow {} }))
  vi.doMock('../auth', () => ({ retrieveToken: vi.fn(() => githubToken) }))
  vi.doMock('../http-client', () => ({
    httpsRequestWithResponse,
    parseSseStream: vi.fn(),
  }))

  const mod = await import('../copilot-api')
  return { ...mod, httpsRequestWithResponse }
}

async function importModelCatalogModule(options?: {
  fetchSequence?: Array<CatalogModel[] | null>
  snapshot?: SnapshotValue
}) {
  vi.resetModules()

  const dbStore = new Map<string, string>()
  if (options?.snapshot !== undefined) {
    dbStore.set('model_catalog_snapshot', options.snapshot)
  }

  const runSpy = vi.fn((key: string, value: string) => {
    dbStore.set(key, value)
    return { changes: 1 }
  })
  const getSpy = vi.fn((key: string) => {
    const value = dbStore.get(key)
    return value === undefined ? undefined : { value }
  })
  const prepare = vi.fn((sql: string) => {
    if (sql.startsWith('SELECT value FROM settings')) {
      return { get: getSpy }
    }
    if (sql.startsWith('INSERT OR REPLACE INTO settings')) {
      return { run: runSpy }
    }
    throw new Error(`Unexpected SQL: ${sql}`)
  })

  const fetchModelCatalog = vi.fn()
  for (const result of options?.fetchSequence ?? []) {
    fetchModelCatalog.mockResolvedValueOnce(result)
  }

  vi.doMock('../copilot-api', () => ({ fetchModelCatalog }))
  vi.doMock('../database', () => ({
    getDatabase: vi.fn(() => ({ prepare })),
  }))

  const mod = await import('../model-catalog')
  return { ...mod, dbStore, runSpy, getSpy, fetchModelCatalog }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe('fetchModelCatalog', () => {
  it('mc-1 maps catalog response into shared model shape', async () => {
    const { fetchModelCatalog, httpsRequestWithResponse } = await importCopilotApiWithResponses([
      {
        status: 200,
        data: JSON.stringify({ token: 'copilot-token', expires_at: Math.floor(Date.now() / 1000) + 3600 }),
      },
      {
        status: 200,
        data: JSON.stringify({
          data: [
            {
              id: 'gpt-5.4',
              name: 'GPT-5.4 Live',
              vendor: 'OpenAI',
              capabilities: {
                supports: { chat: true, vision: false, reasoning: true },
                limits: { max_context_window_tokens: 256000 },
              },
            },
          ],
        }),
      },
    ])

    await expect(fetchModelCatalog()).resolves.toEqual([
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4 Live',
        vendor: 'OpenAI',
        capabilities: ['chat', 'reasoning'],
        contextWindow: 256000,
      },
    ])
    expect(httpsRequestWithResponse).toHaveBeenCalledTimes(2)
  })

  it('mc-2 returns null when the catalog request is not successful', async () => {
    const { fetchModelCatalog } = await importCopilotApiWithResponses([
      {
        status: 200,
        data: JSON.stringify({ token: 'copilot-token', expires_at: Math.floor(Date.now() / 1000) + 3600 }),
      },
      { status: 503, data: '{}' },
    ])

    await expect(fetchModelCatalog()).resolves.toBeNull()
  })

  it('mc-3 returns null when auth or payload parsing fails', async () => {
    const { fetchModelCatalog: noAuth } = await importCopilotApiWithResponses([], null as unknown as string)
    await expect(noAuth()).resolves.toBeNull()

    const { fetchModelCatalog: badPayload } = await importCopilotApiWithResponses([
      {
        status: 200,
        data: JSON.stringify({ token: 'copilot-token', expires_at: Math.floor(Date.now() / 1000) + 3600 }),
      },
      { status: 200, data: '{"data":' },
    ])
    await expect(badPayload()).resolves.toBeNull()
  })
})

describe('model catalog cache and diffing', () => {
  it('mc-4 seeds the DB with the static catalog when no snapshot exists', async () => {
    const { getCachedCatalog, runSpy } = await importModelCatalogModule()
    const result = getCachedCatalog()

    expect(result.length).toBeGreaterThan(0)
    expect(result.some((m) => m.id === 'gpt-4.1')).toBe(true)
    expect(result.some((m) => m.id === 'claude-sonnet-4.6')).toBe(true)
    expect(runSpy).toHaveBeenCalledOnce()
    const writtenSnapshot = JSON.parse(runSpy.mock.calls[0][1] as string) as CatalogModel[]
    expect(writtenSnapshot.some((m) => m.id === 'gpt-4.1')).toBe(true)
  })

  it('mc-5 loads and sorts the persisted snapshot from settings', async () => {
    const snapshot = JSON.stringify([...NEW_MODELS].reverse())
    const { getCachedCatalog } = await importModelCatalogModule({ snapshot })
    expect(getCachedCatalog()).toEqual([...NEW_MODELS].sort((a, b) => a.id.localeCompare(b.id)))
  })

  it('mc-6 diffs added, removed, and changed models independent of input order', async () => {
    const { diffCatalog } = await importModelCatalogModule()
    expect(diffCatalog([...OLD_MODELS].reverse(), [...NEW_MODELS].reverse())).toEqual({
      added: ['gpt-5.4'],
      removed: ['claude-sonnet-4.5'],
      changed: ['gpt-4.1'],
    })
  })
})

describe('loadModelCatalog', () => {
  it('mc-7 persists fresh data and emits a one-time change summary', async () => {
    const { loadModelCatalog, dbStore } = await importModelCatalogModule({
      snapshot: JSON.stringify(OLD_MODELS),
      fetchSequence: [NEW_MODELS, [
        ...NEW_MODELS,
        { id: 'gpt-5.5', name: 'GPT-5.5', vendor: 'OpenAI', capabilities: ['chat'], contextWindow: 256_000 },
      ]],
    })
    const send = vi.fn()
    const mainWindow = { webContents: { send } } as const

    await loadModelCatalog(mainWindow as never)
    await loadModelCatalog(mainWindow as never)

    expect(send).toHaveBeenNthCalledWith(1, 'model:catalog-updated', {
      models: [...NEW_MODELS].sort((a, b) => a.id.localeCompare(b.id)),
      changeSummary: 'Model catalog refreshed — 1 added, 1 removed, 1 updated',
    })
    expect(send).toHaveBeenNthCalledWith(2, 'model:catalog-updated', {
      models: [
        ...NEW_MODELS,
        { id: 'gpt-5.5', name: 'GPT-5.5', vendor: 'OpenAI', capabilities: ['chat'], contextWindow: 256_000 },
      ].sort((a, b) => a.id.localeCompare(b.id)),
      changeSummary: undefined,
    })
    expect(dbStore.get('model_catalog_snapshot')).toBeTruthy()
  })

  it('mc-8 does not overwrite the snapshot when fetching the catalog fails', async () => {
    const snapshot = JSON.stringify(OLD_MODELS)
    const { getCachedCatalog, loadModelCatalog, runSpy } = await importModelCatalogModule({
      snapshot,
      fetchSequence: [null],
    })
    const send = vi.fn()
    const mainWindow = { webContents: { send } } as const

    await loadModelCatalog(mainWindow as never)

    expect(runSpy).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(getCachedCatalog()).toEqual([...OLD_MODELS].sort((a, b) => a.id.localeCompare(b.id)))
  })
  })
