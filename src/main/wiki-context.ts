import type Database from 'better-sqlite3'

interface WikiRow {
  id: string
  title: string
  body: string
  tags: string
}

export interface ScoredWikiEntry {
  id: string
  title: string
  body: string
  tags: string[]
  score: number
}

/** Tokenise text into lowercase words (3+ chars, letters/digits only). */
function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3),
  )
}

/** Jaccard-style overlap score between user text and a wiki entry. */
export function scoreWikiEntry(userText: string, entry: { title: string; body: string; tags: string[] }): number {
  const queryTokens = tokenise(userText)
  if (queryTokens.size === 0) return 0

  const entryTokens = tokenise([entry.title, entry.body, ...entry.tags].join(' '))
  if (entryTokens.size === 0) return 0

  let hits = 0
  for (const token of queryTokens) {
    if (entryTokens.has(token)) hits++
  }

  // Title match carries extra weight — check word-level overlap with title specifically
  const titleTokens = tokenise(entry.title)
  let titleHits = 0
  for (const token of queryTokens) {
    if (titleTokens.has(token)) titleHits++
  }

  const baseScore = hits / queryTokens.size
  const titleBonus = titleTokens.size > 0 ? (titleHits / titleTokens.size) * 0.3 : 0

  return baseScore + titleBonus
}

/** Fetch and rank the top-N wiki entries relevant to userText for a given project. */
export function getRelevantWikiEntries(
  db: Database.Database,
  projectId: string,
  userText: string,
  maxEntries = 5,
): ScoredWikiEntry[] {
  const rows = db
    .prepare(
      `SELECT id, title, body, tags FROM project_wiki_entries
       WHERE project_id = ? AND superseded_by IS NULL
       ORDER BY updated_at DESC`,
    )
    .all(projectId) as WikiRow[]

  if (rows.length === 0) return []

  const scored: ScoredWikiEntry[] = rows.map((row) => {
    let tags: string[] = []
    try {
      tags = JSON.parse(row.tags) as string[]
    } catch {
      tags = []
    }
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      tags,
      score: scoreWikiEntry(userText, { title: row.title, body: row.body, tags }),
    }
  })

  // Sort by score descending; if user text is empty, return most-recently-updated
  scored.sort((a, b) => b.score - a.score)

  // Only return entries with at least some relevance, unless there's no user text
  const hasQuery = userText.trim().length > 0
  const relevant = hasQuery ? scored.filter((e) => e.score > 0) : scored

  return relevant.slice(0, maxEntries)
}

const MAX_BODY_CHARS = 800

/** Format a list of wiki entries into a block ready for injection into the system prompt. */
export function formatWikiSection(entries: ScoredWikiEntry[]): string {
  if (entries.length === 0) return ''

  const formatted = entries.map((e) => {
    const tags = e.tags.length > 0 ? ` [${e.tags.join(', ')}]` : ''
    const body = e.body.length > MAX_BODY_CHARS ? e.body.slice(0, MAX_BODY_CHARS) + '...' : e.body
    return `### ${e.title}${tags}\n${body}`
  })

  return `[Project Wiki Knowledge]\n${formatted.join('\n\n')}`
}
