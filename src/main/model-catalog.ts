import type { BrowserWindow } from 'electron'
import type { CatalogModel } from '../shared/types'
import { fetchModelCatalog } from './copilot-api'
import { getDatabase } from './database'

const SNAPSHOT_KEY = 'model_catalog_snapshot'

export const STATIC_SEED: CatalogModel[] = [
  { id: 'gpt-5.5',           name: 'GPT-5.5',          vendor: 'OpenAI',    capabilities: ['tool_calls'] },
  { id: 'gpt-5.4',           name: 'GPT-5.4',          vendor: 'OpenAI',    capabilities: ['tool_calls'] },
  { id: 'gpt-5.3-codex',     name: 'GPT-5.3-Codex',    vendor: 'OpenAI',    capabilities: ['tool_calls'] },
  { id: 'gpt-5.2-codex',     name: 'GPT-5.2-Codex',    vendor: 'OpenAI',    capabilities: ['tool_calls'] },
  { id: 'gpt-5.2',           name: 'GPT-5.2',          vendor: 'OpenAI',    capabilities: ['tool_calls'] },
  { id: 'gpt-5-mini',        name: 'GPT-5 mini',       vendor: 'OpenAI',    capabilities: ['tool_calls'] },
  { id: 'gpt-4.1',           name: 'GPT-4.1',          vendor: 'OpenAI',    capabilities: ['tool_calls'] },
  { id: 'claude-opus-4.8',   name: 'Claude Opus 4.8',  vendor: 'Anthropic', capabilities: ['tool_calls'] },
  { id: 'claude-opus-4.7',   name: 'Claude Opus 4.7',  vendor: 'Anthropic', capabilities: ['tool_calls'] },
  { id: 'claude-opus-4.6',   name: 'Claude Opus 4.6',  vendor: 'Anthropic', capabilities: ['tool_calls'] },
  { id: 'claude-opus-4.5',   name: 'Claude Opus 4.5',  vendor: 'Anthropic', capabilities: ['tool_calls'] },
  { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6',vendor: 'Anthropic', capabilities: ['tool_calls'] },
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5',vendor: 'Anthropic', capabilities: ['tool_calls'] },
  { id: 'claude-sonnet-4',   name: 'Claude Sonnet 4',  vendor: 'Anthropic', capabilities: ['tool_calls'] },
  { id: 'claude-haiku-4.5',  name: 'Claude Haiku 4.5', vendor: 'Anthropic', capabilities: ['tool_calls'] },
]

let catalogCache: CatalogModel[] | null = null
let toastSentThisSession = false

export interface CatalogDiff {
  added: string[]
  removed: string[]
  changed: string[]
}

function deduplicateAndSort(list: CatalogModel[]): CatalogModel[] {
  // First pass: deduplicate by ID
  const byId = new Map<string, CatalogModel>()
  for (const model of list) {
    byId.set(model.id, model)
  }
  // Second pass: deduplicate by name, keeping the entry with the shortest ID.
  // The API returns versioned variants (e.g. gpt-4o-2024-05-13) that share a
  // display name with the canonical base model (gpt-4o). We keep the base.
  const byName = new Map<string, CatalogModel>()
  for (const model of byId.values()) {
    const existing = byName.get(model.name)
    if (!existing || model.id.length < existing.id.length) {
      byName.set(model.name, model)
    }
  }
  return [...byName.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function getCachedCatalog(): CatalogModel[] {
  if (catalogCache !== null) return catalogCache

  try {
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SNAPSHOT_KEY) as
      | { value: string }
      | undefined
    if (row) {
      catalogCache = deduplicateAndSort(JSON.parse(row.value) as CatalogModel[])
      return catalogCache
    }

    const sorted = deduplicateAndSort(STATIC_SEED)
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      SNAPSHOT_KEY,
      JSON.stringify(sorted)
    )
    catalogCache = sorted
    return catalogCache
  } catch {
    // Ignore DB errors — static seed returned below as a last resort.
  }

  catalogCache = deduplicateAndSort(STATIC_SEED)
  return catalogCache
}

export function diffCatalog(oldList: CatalogModel[], newList: CatalogModel[]): CatalogDiff {
  const sortedOld = deduplicateAndSort(oldList)
  const sortedNew = deduplicateAndSort(newList)
  const oldMap = new Map(sortedOld.map((model) => [model.id, model]))
  const newMap = new Map(sortedNew.map((model) => [model.id, model]))

  const added = sortedNew.filter((model) => !oldMap.has(model.id)).map((model) => model.id)
  const removed = sortedOld.filter((model) => !newMap.has(model.id)).map((model) => model.id)
  const changed = sortedNew
    .filter((model) => {
      const old = oldMap.get(model.id)
      if (!old) return false
      return old.name !== model.name || old.vendor !== model.vendor
    })
    .map((model) => model.id)

  return { added, removed, changed }
}

export async function loadModelCatalog(mainWindow: BrowserWindow): Promise<void> {
  const fresh = await fetchModelCatalog()
  if (fresh === null) return

  const sorted = deduplicateAndSort(fresh)
  const previous = getCachedCatalog()
  const diff = diffCatalog(previous, sorted)
  const hasChanges = diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0

  catalogCache = sorted

  try {
    const db = getDatabase()
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      SNAPSHOT_KEY,
      JSON.stringify(sorted)
    )
  } catch {
    // Ignore snapshot write failures so the live catalog can still be used.
  }

  const changeSummary = hasChanges && !toastSentThisSession
    ? (() => {
        const parts: string[] = []
        if (diff.added.length) parts.push(`${diff.added.length} added`)
        if (diff.removed.length) parts.push(`${diff.removed.length} removed`)
        if (diff.changed.length) parts.push(`${diff.changed.length} updated`)
        return `Model catalog refreshed — ${parts.join(', ')}`
      })()
    : undefined

  mainWindow.webContents.send('model:catalog-updated', {
    models: sorted,
    changeSummary
  })

  if (hasChanges) {
    toastSentThisSession = true
  }
}

export function __resetModelCatalogForTests(): void {
  catalogCache = null
  toastSentThisSession = false
}
