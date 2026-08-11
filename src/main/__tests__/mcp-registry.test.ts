import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  store: new Map<string, string>(),
  request: vi.fn(),
}))

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

vi.mock('../http-client', () => ({
  httpsRequestUrl: state.request,
}))

import { __resetMcpRegistryForTests, searchMcpRegistry } from '../mcp-registry'

describe('MCP registry browser', () => {
  beforeEach(() => {
    state.store.clear()
    state.request.mockReset()
    __resetMcpRegistryForTests()
  })

  it('normalizes an npm stdio package into a pinned guided install', async () => {
    state.request.mockResolvedValue({
      status: 200,
      data: JSON.stringify({
        servers: [{
          server: {
            name: 'io.github.acme/calendar',
            title: 'Calendar',
            description: 'Read and manage calendars.',
            version: '2.1.0',
            websiteUrl: 'https://example.com/calendar',
            repository: { url: 'https://github.com/acme/calendar', source: 'github' },
            packages: [{
              registryType: 'npm',
              identifier: '@acme/calendar-mcp',
              version: '2.1.0',
              runtimeHint: 'npx',
              transport: { type: 'stdio' },
              environmentVariables: [{
                name: 'CALENDAR_TOKEN',
                description: 'Calendar access token',
                isRequired: true,
                isSecret: true,
              }],
            }],
          },
          _meta: {
            'io.modelcontextprotocol.registry/official': {
              status: 'active',
              isLatest: true,
            },
          },
        }] 
      }),
    })

    const result = await searchMcpRegistry('calendar')

    expect(result.servers).toHaveLength(1)
    expect(result.servers[0]).toMatchObject({
      name: 'io.github.acme/calendar',
      title: 'Calendar',
      transport: 'stdio',
      install: {
        command: 'npx',
        args: ['-y', '@acme/calendar-mcp@2.1.0'],
        requiredEnv: [{
          key: 'CALENDAR_TOKEN',
          label: 'Calendar access token',
          secret: true,
        }],
      },
    })
    expect(state.request).toHaveBeenCalledWith(
      expect.stringContaining('search=calendar'),
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('serves a fresh query from the persisted cache', async () => {
    state.request.mockResolvedValue({ status: 200, data: JSON.stringify({ servers: [] }) })

    await searchMcpRegistry('filesystem')
    await searchMcpRegistry('filesystem')

    expect(state.request).toHaveBeenCalledTimes(1)
  })

  it('returns stale cached data when a refresh fails', async () => {
    state.request
      .mockResolvedValueOnce({
        status: 200,
        data: JSON.stringify({ servers: [{ server: { name: 'com.example/fs', description: 'Files', version: '1.0.0' } }] }),
      })
      .mockResolvedValueOnce({ status: 503, data: 'unavailable' })

    const first = await searchMcpRegistry('files')
    // Expire the in-memory entry without touching the production clock by restoring
    // the persisted entry with an old timestamp.
    const cached = JSON.parse(state.store.get('mcp_registry_search_cache') || '{}')
    cached.files.fetchedAt = 0
    state.store.set('mcp_registry_search_cache', JSON.stringify(cached))
    __resetMcpRegistryForTests()

    const second = await searchMcpRegistry('files')
    expect(first.servers).toHaveLength(1)
    expect(second.stale).toBe(true)
    expect(second.servers[0]).toMatchObject({ name: 'com.example/fs', version: '1.0.0' })
  })
})
