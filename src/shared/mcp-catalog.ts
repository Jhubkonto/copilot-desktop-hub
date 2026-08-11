// Hand-curated catalog of well-known MCP servers, surfaced as a capability-first
// gallery in the MCP server panel so users pick "what they want" instead of typing
// launch commands. Kept dependency-free and shareable with the Android companion.

export type McpCatalogCategory = 'browser' | 'files' | 'dev' | 'web' | 'data' | 'productivity'

export interface McpCatalogRequiredEnv {
  key: string
  label: string
  helpUrl?: string
  /** Rendered as a masked field and (Phase 2) stored via safeStorage. */
  secret?: boolean
}

export interface McpCatalogEntry {
  /** Stable catalog id (not the persisted server id). */
  id: string
  /** Default server name pre-filled into the form. */
  name: string
  description: string
  category: McpCatalogCategory
  command: string
  args: string[]
  env?: Record<string, string>
  imageResponses?: 'allow' | 'omit'
  /** Declared secrets/config the server needs — rendered as labeled fields. */
  requiredEnv?: McpCatalogRequiredEnv[]
  docsUrl?: string
  /** Extra capability terms for search ("screenshot", "browse the web"). */
  keywords?: string[]
}

export const MCP_CATEGORY_LABELS: Record<McpCatalogCategory, string> = {
  browser: 'Browser',
  files: 'Files',
  dev: 'Developer',
  web: 'Web',
  data: 'Data',
  productivity: 'Productivity',
}

// Order here controls the order categories render in the gallery.
export const MCP_CATEGORY_ORDER: McpCatalogCategory[] = [
  'browser',
  'files',
  'dev',
  'web',
  'data',
  'productivity',
]

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: 'playwright',
    name: 'Playwright (Chromium)',
    description: 'AI-controlled managed browser — navigate pages, click, type, screenshot.',
    category: 'browser',
    command: 'npx',
    args: ['-y', '@playwright/mcp'],
    imageResponses: 'allow',
    docsUrl: 'https://github.com/microsoft/playwright-mcp',
    keywords: ['browser', 'web', 'screenshot', 'automation', 'scrape', 'chromium'],
  },
  {
    id: 'playwright-cdp',
    name: 'Playwright (CDP attach)',
    description: 'Attach to an existing Chrome/Edge launched with --remote-debugging-port=9222.',
    category: 'browser',
    command: 'npx',
    args: ['-y', '@playwright/mcp', '--cdp-endpoint', 'http://localhost:9222'],
    imageResponses: 'allow',
    docsUrl: 'https://github.com/microsoft/playwright-mcp',
    keywords: ['browser', 'chrome', 'edge', 'attach', 'debugging', 'cdp'],
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read, write, and search files within a directory you choose.',
    category: 'files',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    keywords: ['files', 'disk', 'read', 'write', 'directory', 'folder'],
  },
  {
    id: 'git',
    name: 'Git',
    description: 'Inspect and operate on a local Git repository — status, log, diff, commit.',
    category: 'dev',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-git'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
    keywords: ['git', 'repo', 'commit', 'diff', 'version control'],
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Access GitHub repos, issues, and pull requests with your token.',
    category: 'dev',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    requiredEnv: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub Personal Access Token',
        helpUrl: 'https://github.com/settings/tokens',
        secret: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
    keywords: ['github', 'repo', 'issues', 'pull request', 'pr', 'code'],
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: 'Fetch a URL and return its content as clean markdown for the model.',
    category: 'web',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    keywords: ['web', 'url', 'fetch', 'http', 'read page', 'markdown'],
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'A persistent knowledge graph the model can store and recall facts from.',
    category: 'data',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    keywords: ['memory', 'knowledge', 'remember', 'graph', 'notes'],
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Structured step-by-step reasoning scaffold for harder problems.',
    category: 'productivity',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    keywords: ['reasoning', 'planning', 'think', 'steps', 'chain of thought'],
  },
  {
    id: 'time',
    name: 'Time',
    description: 'Current time and timezone conversions.',
    category: 'productivity',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-time'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
    keywords: ['time', 'clock', 'timezone', 'date'],
  },
]

/** Config shape the panel form consumes when a catalog card is chosen. */
export interface McpCatalogFormConfig {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  imageResponses?: 'allow' | 'omit'
  enabled: boolean
}

export function catalogEntryToConfig(entry: McpCatalogEntry): McpCatalogFormConfig {
  const env: Record<string, string> = { ...(entry.env ?? {}) }
  // Seed declared secrets as empty keys so the guided fields render for the user to fill.
  for (const req of entry.requiredEnv ?? []) {
    if (!(req.key in env)) env[req.key] = ''
  }
  return {
    name: entry.name,
    command: entry.command,
    args: [...entry.args],
    env,
    cwd: undefined,
    imageResponses: entry.imageResponses,
    enabled: true,
  }
}

/** Case-insensitive match across name, description, category, and keywords. */
export function searchCatalog(query: string): McpCatalogEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return MCP_CATALOG
  const terms = q.split(/\s+/)
  return MCP_CATALOG.filter((entry) => {
    const haystack = [
      entry.name,
      entry.description,
      MCP_CATEGORY_LABELS[entry.category],
      ...(entry.keywords ?? []),
    ]
      .join(' ')
      .toLowerCase()
    return terms.every((t) => haystack.includes(t))
  })
}
