import type { BrowserWindow } from 'electron'
import type { CatalogModel } from '../shared/types'
import { getStaticCatalogSeed } from '../shared/models'
import { getDatabase } from './database'

const SNAPSHOT_KEY = 'model_catalog_snapshot'

// Derived from the single canonical model list in shared/models.ts so the
// dropdown catalog and the label/multiplier maps cannot drift apart.
export const STATIC_SEED: CatalogModel[] = getStaticCatalogSeed()

let catalogCache: CatalogModel[] | null = null
let toastSentThisSession = false

export interface CatalogDiff {
  added: string[]
  removed: string[]
  changed: string[]
}

function deduplicateAndSort(list: CatalogModel[]): CatalogModel[] {
  const byId = new Map<string, CatalogModel>()
  for (const model of list) {
    byId.set(model.id, model)
  }

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
  const sorted = deduplicateAndSort(STATIC_SEED)
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
    changeSummary,
  })

  if (hasChanges) {
    toastSentThisSession = true
  }
}

export function __resetModelCatalogForTests(): void {
  catalogCache = null
  toastSentThisSession = false
}
