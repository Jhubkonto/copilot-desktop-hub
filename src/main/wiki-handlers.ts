import { randomUUID } from 'crypto'
import { getDatabase } from './database'
import type Database from 'better-sqlite3'
import type { ProviderMessage } from './providers'
import { getProviderForAgent, getApiKey, sendProviderNonStreaming } from './providers'
import { safeHandle } from './safe-handle'
import type { WikiCandidate, WikiEntry, WikiExtractionResult } from '../shared/types'

function parseRow(row: {
  id: string
  project_id: string
  title: string
  body: string
  tags: string
  source_conversation_id: string | null
  source_message_id: string | null
  superseded_by: string | null
  created_at: number
  updated_at: number
}): WikiEntry {
  return {
    ...row,
    tags: (() => {
      try {
        return JSON.parse(row.tags) as string[]
      } catch {
        return []
      }
    })(),
  }
}

export function computeBodyOverlap(body1: string, body2: string): number {
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 3)
    )
  const w1 = words(body1)
  const w2 = words(body2)
  if (w1.size === 0 && w2.size === 0) return 1
  const intersection = [...w1].filter((w) => w2.has(w))
  return intersection.length / Math.max(w1.size, w2.size, 1)
}

export function findFuzzyMatch(
  candidateTitle: string,
  existing: { id: string; title: string }[]
): { id: string; title: string } | null {
  const words = (value: string) => new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((word) => word.length > 3)
  )
  const candidateWords = words(candidateTitle)
  if (candidateWords.size === 0) return null

  for (const entry of existing) {
    const entryWords = words(entry.title)
    const intersection = [...candidateWords].filter((word) => entryWords.has(word))
    const overlap = intersection.length / Math.max(candidateWords.size, entryWords.size, 1)
    if (overlap >= 0.5) return entry
  }

  return null
}

export function insertWikiEntry(
  db: Database.Database,
  projectId: string,
  title: string,
  body: string,
  tags: string[],
  sourceInfo?: { conversationId?: string; messageId?: string }
): WikiEntry {
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    'INSERT INTO project_wiki_entries (id, project_id, title, body, tags, source_conversation_id, source_message_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    projectId,
    String(title).slice(0, 200),
    String(body),
    JSON.stringify(tags ?? []),
    sourceInfo?.conversationId ?? null,
    sourceInfo?.messageId ?? null,
    now,
    now,
  )
  return parseRow(db.prepare('SELECT * FROM project_wiki_entries WHERE id = ?').get(id) as Parameters<typeof parseRow>[0])
}

export function registerWikiHandlers(): void {
  const db = getDatabase()

  safeHandle('wiki:list-entries', (_event, projectId: string) => {
    const rows = db.prepare(
      'SELECT * FROM project_wiki_entries WHERE project_id = ? ORDER BY updated_at DESC'
    ).all(projectId) as Parameters<typeof parseRow>[0][]
    return rows.map(parseRow)
  })

  safeHandle(
    'wiki:create-entry',
    (_event, projectId: string, title: string, body: string, tags: string[], sourceInfo?: { conversationId?: string; messageId?: string }) => {
      return insertWikiEntry(db, projectId, title, body, tags, sourceInfo)
    }
  )

  safeHandle('wiki:update-entry', (_event, id: string, fields: { title?: string; body?: string; tags?: string[]; superseded_by?: string | null }) => {
    const now = Date.now()
    const row = db.prepare('SELECT * FROM project_wiki_entries WHERE id = ?').get(id) as Parameters<typeof parseRow>[0] | undefined
    if (!row) throw new Error('Wiki entry not found')
    const title = fields.title !== undefined ? String(fields.title).slice(0, 200) : row.title
    const body = fields.body !== undefined ? String(fields.body) : row.body
    const tags = fields.tags !== undefined ? JSON.stringify(fields.tags) : row.tags
    const superseded_by = 'superseded_by' in fields ? (fields.superseded_by ?? null) : row.superseded_by
    db.prepare(
      'UPDATE project_wiki_entries SET title = ?, body = ?, tags = ?, superseded_by = ?, updated_at = ? WHERE id = ?'
    ).run(title, body, tags, superseded_by, now, id)
    return parseRow(db.prepare('SELECT * FROM project_wiki_entries WHERE id = ?').get(id) as Parameters<typeof parseRow>[0])
  })

  safeHandle('wiki:delete-entry', (_event, id: string) => {
    db.prepare('DELETE FROM project_wiki_entries WHERE id = ?').run(id)
    return true
  })

  safeHandle('wiki:extract-learnings', async (_event, conversationId: string, projectId: string, model?: string): Promise<WikiExtractionResult> => {
    const rows = db.prepare(
      "SELECT role, content FROM messages WHERE conversation_id = ? AND role IN ('user', 'assistant') ORDER BY timestamp ASC"
    ).all(conversationId) as { role: string; content: string }[]

    if (rows.length === 0) return { candidates: [] }

    const transcript = rows
      .map((row) => `${row.role === 'user' ? 'User' : 'Assistant'}: ${row.content}`)
      .join('\n\n')

    // Resolve which provider+model to use for extraction.
    // Prefer the project's primary agent's configured provider; fall back to Copilot gpt-4o-mini.
    let extractionProvider: ReturnType<typeof getProviderForAgent>
    if (model) {
      extractionProvider = getProviderForAgent(model)
    } else {
      const agentRow = db.prepare(
        'SELECT a.config_json FROM project_agents pa JOIN agents a ON pa.agent_id = a.id WHERE pa.project_id = ? AND pa.is_primary = 1 LIMIT 1'
      ).get(projectId) as { config_json: string } | undefined

      const agentModel = (() => {
        try {
          const cfg = JSON.parse(agentRow?.config_json ?? '{}') as Record<string, unknown>
          return typeof cfg.model === 'string' && cfg.model ? cfg.model : 'gpt-4o-mini'
        } catch {
          return 'gpt-4o-mini'
        }
      })()
      extractionProvider = getProviderForAgent(agentModel)
    }

    const { provider, model: resolvedModel } = extractionProvider
    const apiKey = getApiKey(provider)

    const systemPrompt = `You are a knowledge extraction assistant. Analyze this conversation and extract factual learnings, decisions, and procedures as structured wiki entries.

Return a JSON array (and NOTHING else — no markdown, no preamble) with this schema:
[
  {
    "title": "Brief descriptive title (max 80 chars)",
    "body": "The key fact, decision, or procedure. Be concise but complete.",
    "tags": ["category1", "category2"]
  }
]

Guidelines:
- Only extract things worth remembering across conversations (architectural decisions, coding conventions, debugging resolutions, API quirks, project-specific facts)
- Skip small talk, clarifying questions, and trivial exchanges
- Maximum 10 entries
- If nothing notable was learned, return []
- Tags should be lowercase, 1-2 words each`

    const messages: ProviderMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Here is the conversation to analyze:\n\n${transcript.slice(0, 12000)}` },
    ]

    const result = await sendProviderNonStreaming(
      provider,
      apiKey,
      resolvedModel,
      messages,
      { maxTokens: 2000, temperature: 0.3 },
    )

    let rawCandidates: { title: string; body: string; tags: string[] }[] = []
    try {
      const text = result.content ?? ''
      const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
      rawCandidates = JSON.parse(cleaned) as { title: string; body: string; tags: string[] }[]
      if (!Array.isArray(rawCandidates)) rawCandidates = []
    } catch {
      return { candidates: [] }
    }

    const existingEntries = db.prepare(
      'SELECT id, title, body FROM project_wiki_entries WHERE project_id = ?'
    ).all(projectId) as { id: string; title: string; body: string }[]

    const candidates: WikiCandidate[] = rawCandidates
      .slice(0, 10)
      .map((candidate) => {
        const title = String(candidate.title ?? '').slice(0, 200).trim()
        const body = String(candidate.body ?? '').trim()
        const tags = Array.isArray(candidate.tags) ? candidate.tags.map(String) : []
        const matchedEntry = findFuzzyMatch(title, existingEntries)

        let matchingEntryId: string | null = null
        let matchingEntryTitle: string | null = null
        let supersededEntryId: string | null = null
        let supersededEntryTitle: string | null = null

        if (matchedEntry) {
          const existing = existingEntries.find((e) => e.id === matchedEntry.id)!
          const existingBodyWords = existing.body
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .split(/\s+/)
            .filter((w) => w.length > 3)
          const existingIsSubstantive = existingBodyWords.length >= 5
          const overlap = computeBodyOverlap(existing.body, body)

          if (existingIsSubstantive && overlap < 0.35) {
            supersededEntryId = matchedEntry.id
            supersededEntryTitle = matchedEntry.title
          } else {
            matchingEntryId = matchedEntry.id
            matchingEntryTitle = matchedEntry.title
          }
        }

        return {
          title,
          body,
          tags,
          matchingEntryId,
          matchingEntryTitle,
          supersededEntryId,
          supersededEntryTitle,
        }
      })
      .filter((candidate) => candidate.title.length > 0)

    return { candidates }
  })
}
