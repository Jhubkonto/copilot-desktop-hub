import type { McpCatalogRequiredEnv } from '../shared/mcp-catalog'
import type {
  McpRegistrySearchResult,
  McpRegistryServer,
  McpRegistryInstallConfig,
} from '../shared/types'
import { httpsRequestUrl } from './http-client'
import { getDatabase } from './database'

const REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io'
const REGISTRY_PATH = '/v0.1/servers'
const SNAPSHOT_KEY = 'mcp_registry_search_cache'
const CACHE_TTL_MS = 60 * 60 * 1000
const MAX_CACHE_ENTRIES = 20
const PAGE_SIZE = 24

interface RegistryCacheEntry {
  servers: McpRegistryServer[]
  fetchedAt: number
}

type RegistryCache = Record<string, RegistryCacheEntry>

let cache: RegistryCache | null = null

function getCache(): RegistryCache {
  if (cache) return cache
  try {
    const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get(SNAPSHOT_KEY) as
      | { value: string }
      | undefined
    cache = row ? JSON.parse(row.value) as RegistryCache : {}
  } catch {
    cache = {}
  }
  return cache
}

function persistCache(next: RegistryCache): void {
  cache = next
  try {
    getDatabase().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      SNAPSHOT_KEY,
      JSON.stringify(next),
    )
  } catch {
    // A network result is still useful when the settings snapshot cannot be written.
  }
}

function materialiseArguments(argumentsList: unknown): string[] | null {
  if (!Array.isArray(argumentsList)) return []
  const result: string[] = []
  for (const raw of argumentsList) {
    if (!raw || typeof raw !== 'object') return null
    const arg = raw as {
      type?: string
      name?: string
      value?: string
      default?: string
      valueHint?: string
      isRequired?: boolean
    }
    if (arg.type === 'named') {
      if (typeof arg.name !== 'string' || !arg.name) return null
      result.push(arg.name)
      const value = arg.value ?? arg.default
      if (value !== undefined && value !== '') result.push(value)
      continue
    }
    const value = arg.value ?? arg.default
    if (typeof value === 'string' && value !== '') {
      result.push(value)
      continue
    }
    // A valueHint is a variable that needs user input. Do not turn it into a
    // literal command argument; the entry remains visible but not installable.
    if (arg.valueHint || arg.isRequired) return null
  }
  return result
}

function normaliseEnvironmentVariables(value: unknown, websiteUrl?: string): McpCatalogRequiredEnv[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const input = raw as {
      name?: string
      description?: string
      isRequired?: boolean
      isSecret?: boolean
      placeholder?: string
    }
    if (!input.name) return []
    return [{
      key: input.name,
      label: input.description || input.name,
      helpUrl: websiteUrl,
      secret: input.isSecret ?? false,
    }]
  })
}

function packageToInstallConfig(server: Record<string, unknown>, packageInfo: Record<string, unknown>): McpRegistryInstallConfig | undefined {
  const transport = packageInfo.transport as { type?: string } | undefined
  if (transport?.type !== 'stdio') return undefined

  const registryType = typeof packageInfo.registryType === 'string' ? packageInfo.registryType : ''
  const identifier = typeof packageInfo.identifier === 'string' ? packageInfo.identifier : ''
  const version = typeof packageInfo.version === 'string' ? packageInfo.version : ''
  if (!identifier || !version) return undefined

  const runtimeHint = typeof packageInfo.runtimeHint === 'string' ? packageInfo.runtimeHint : undefined
  const runtimeArguments = materialiseArguments(packageInfo.runtimeArguments)
  const packageArguments = materialiseArguments(packageInfo.packageArguments)
  if (!runtimeArguments || !packageArguments) return undefined

  let command: string
  let args: string[]
  if (registryType === 'npm' && (!runtimeHint || runtimeHint === 'npx')) {
    command = 'npx'
    args = [...runtimeArguments]
    if (command === 'npx' && !args.includes('-y')) args.push('-y')
    args.push(`${identifier}@${version}`)
    args.push(...packageArguments)
  } else if (registryType === 'pypi' && (!runtimeHint || runtimeHint === 'uvx')) {
    command = 'uvx'
    args = [...runtimeArguments, `${identifier}==${version}`, ...packageArguments]
  } else {
    return undefined
  }

  const websiteUrl = typeof server.websiteUrl === 'string' ? server.websiteUrl : undefined
  return {
    command,
    args,
    requiredEnv: normaliseEnvironmentVariables(packageInfo.environmentVariables, websiteUrl),
  }
}

function normaliseServer(raw: unknown): McpRegistryServer | null {
  if (!raw || typeof raw !== 'object') return null
  const response = raw as { server?: Record<string, unknown>; _meta?: Record<string, unknown> }
  const server = response.server ?? raw as Record<string, unknown>
  if (typeof server.name !== 'string' || typeof server.description !== 'string' || typeof server.version !== 'string') {
    return null
  }

  const officialMeta = (response._meta?.['io.modelcontextprotocol.registry/official'] ?? {}) as Record<string, unknown>
  const packages = Array.isArray(server.packages) ? server.packages : []
  const install = packages
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .map((entry) => packageToInstallConfig(server, entry))
    .find((entry): entry is McpRegistryInstallConfig => Boolean(entry))
  const repository = server.repository && typeof server.repository === 'object'
    ? server.repository as { url?: string }
    : undefined
  const remotes = Array.isArray(server.remotes) ? server.remotes : []
  const docsUrl = typeof server.websiteUrl === 'string'
    ? server.websiteUrl
    : typeof repository?.url === 'string' ? repository.url : undefined

  return {
    name: server.name,
    title: typeof server.title === 'string' ? server.title : undefined,
    description: server.description,
    version: server.version,
    docsUrl,
    repositoryUrl: typeof repository?.url === 'string' ? repository.url : undefined,
    status: officialMeta.status === 'deprecated' || officialMeta.status === 'deleted' ? officialMeta.status : 'active',
    statusMessage: typeof officialMeta.statusMessage === 'string' ? officialMeta.statusMessage : undefined,
    publishedAt: typeof officialMeta.publishedAt === 'string' ? officialMeta.publishedAt : undefined,
    updatedAt: typeof officialMeta.updatedAt === 'string' ? officialMeta.updatedAt : undefined,
    isLatest: officialMeta.isLatest !== false,
    transport: install ? 'stdio' : remotes.length > 0 ? 'remote' : 'unknown',
    install,
  }
}

function errorMessage(status: number, data: string): string {
  try {
    const parsed = JSON.parse(data) as { error?: string; message?: string }
    if (parsed.error || parsed.message) return String(parsed.error || parsed.message)
  } catch {
    // Use the status fallback below.
  }
  return `MCP Registry request failed (HTTP ${status})`
}

export async function searchMcpRegistry(query: string): Promise<McpRegistrySearchResult> {
  const normalisedQuery = query.trim().slice(0, 120)
  const cacheKey = normalisedQuery.toLowerCase()
  const existing = getCache()[cacheKey]
  const now = Date.now()
  if (existing && now - existing.fetchedAt < CACHE_TTL_MS) {
    return { servers: existing.servers, fetchedAt: existing.fetchedAt, stale: false }
  }

  const params = new URLSearchParams({ limit: String(PAGE_SIZE), version: 'latest' })
  if (normalisedQuery) params.set('search', normalisedQuery)
  const response = await httpsRequestUrl(`${REGISTRY_BASE_URL}${REGISTRY_PATH}?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json', 'User-Agent': 'Nexy MCP Registry browser' },
  })

  if (response.status < 200 || response.status >= 300) {
    if (existing) return { servers: existing.servers, fetchedAt: existing.fetchedAt, stale: true }
    throw new Error(errorMessage(response.status, response.data))
  }

  let parsed: { servers?: unknown[] }
  try {
    parsed = JSON.parse(response.data) as { servers?: unknown[] }
  } catch {
    if (existing) return { servers: existing.servers, fetchedAt: existing.fetchedAt, stale: true }
    throw new Error('MCP Registry returned invalid JSON')
  }
  const servers = (parsed.servers ?? []).map(normaliseServer).filter((entry): entry is McpRegistryServer => Boolean(entry))
  const next = { ...getCache(), [cacheKey]: { servers, fetchedAt: now } }
  const trimmed = Object.fromEntries(Object.entries(next).sort(([, a], [, b]) => b.fetchedAt - a.fetchedAt).slice(0, MAX_CACHE_ENTRIES))
  persistCache(trimmed)
  return { servers, fetchedAt: now, stale: false }
}

export function __resetMcpRegistryForTests(): void {
  cache = null
}
