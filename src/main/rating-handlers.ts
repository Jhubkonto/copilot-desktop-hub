import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import { parseProjectConfig } from './project-handlers'
import { broadcastToMobile } from './ws-server'
import type {
  ConversationRating,
  ConversationRatingListItem,
  ConversationRatingSnapshot,
  ConversationRatingStats,
  RatingAggregate,
} from '../shared/types'
import type { Database as DatabaseType } from 'better-sqlite3'

const EMPTY_SNAPSHOT: ConversationRatingSnapshot = {
  agentId: null,
  agentName: null,
  model: null,
  backend: null,
  projectId: null,
  projectName: null,
  workflowMode: null,
  toolNames: [],
  serverNames: [],
  skillIds: [],
  skillNames: [],
  keywords: [],
}

// Deliberately local/heuristic rather than an LLM call — rating submission shouldn't depend
// on a model call succeeding (src/roadmap-new/conversation-rating-system-roadmap.md §3.3).
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to', 'of', 'in',
  'on', 'for', 'with', 'at', 'by', 'from', 'up', 'about', 'into', 'over', 'after', 'this', 'that', 'these',
  'those', 'it', 'its', 'as', 'if', 'then', 'than', 'so', 'can', 'could', 'would', 'should', 'will', 'shall',
  'do', 'does', 'did', 'not', 'i', 'you', 'he', 'she', 'we', 'they', 'my', 'your', 'his', 'her', 'our',
  'their', 'me', 'him', 'us', 'them', 'what', 'which', 'who', 'whom', 'how', 'why', 'when', 'where', 'all',
  'any', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'only', 'own', 'same', 'too',
  'very', 'just', 'also', 'please', 'help', 'want', 'need', 'like', 'get',
])

export function extractKeywords(text: string, max = 8): string[] {
  const keywords: string[] = []
  const seen = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw) || seen.has(raw)) continue
    seen.add(raw)
    keywords.push(raw)
    if (keywords.length >= max) break
  }
  return keywords
}

function readConfigName(configJson: string | undefined): string | null {
  if (!configJson) return null
  try {
    const cfg = JSON.parse(configJson) as { name?: unknown }
    return typeof cfg.name === 'string' ? cfg.name : null
  } catch {
    return null
  }
}

/**
 * Freezes everything a later "similar strategy" retrieval needs, at rating time — mirrors
 * the messages.context_snapshot precedent so a rating stays meaningful even after the source
 * agent/skill is renamed or deleted, or the project's workflowMode later changes.
 */
function buildRatingSnapshot(db: DatabaseType, conversationId: string): ConversationRatingSnapshot {
  const convRow = db
    .prepare('SELECT agent_id, model, cli_backend, project_id, title FROM conversations WHERE id = ?')
    .get(conversationId) as
    | { agent_id: string | null; model: string | null; cli_backend: string | null; project_id: string | null; title: string }
    | undefined

  if (!convRow) return EMPTY_SNAPSHOT

  const agentName = convRow.agent_id
    ? readConfigName(
        (db.prepare('SELECT config_json FROM agents WHERE id = ?').get(convRow.agent_id) as { config_json: string } | undefined)
          ?.config_json,
      )
    : null

  const projectRow = convRow.project_id
    ? (db.prepare('SELECT name, config_json FROM projects WHERE id = ?').get(convRow.project_id) as
        | { name: string; config_json: string | null }
        | undefined)
    : undefined
  const projectName = projectRow?.name ?? null
  const workflowMode = convRow.project_id ? parseProjectConfig(projectRow?.config_json ?? null).workflowMode : null

  const toolRows = db
    .prepare('SELECT DISTINCT tool_name, server_name FROM conversation_tool_calls WHERE conversation_id = ?')
    .all(conversationId) as { tool_name: string; server_name: string | null }[]
  const toolNames = [...new Set(toolRows.map((r) => r.tool_name))]
  const serverNames = [...new Set(toolRows.map((r) => r.server_name).filter((n): n is string => Boolean(n)))]

  const skillRows = db
    .prepare(
      `SELECT DISTINCT csi.skill_id, s.config_json FROM conversation_skill_invocations csi
       JOIN skills s ON s.id = csi.skill_id WHERE csi.conversation_id = ?`,
    )
    .all(conversationId) as { skill_id: string; config_json: string }[]
  const skillIds = skillRows.map((r) => r.skill_id)
  const skillNames = skillRows.map((r) => readConfigName(r.config_json) ?? r.skill_id)

  const firstUserMessage = db
    .prepare("SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY timeline_order ASC, timestamp ASC, id ASC LIMIT 1")
    .get(conversationId) as { content: string } | undefined

  const keywords = extractKeywords(`${convRow.title} ${firstUserMessage?.content ?? ''}`)

  return {
    agentId: convRow.agent_id,
    agentName,
    model: convRow.model,
    backend: convRow.cli_backend,
    projectId: convRow.project_id,
    projectName,
    workflowMode,
    toolNames,
    serverNames,
    skillIds,
    skillNames,
    keywords,
  }
}

type ConversationRatingRow = {
  id: string
  conversation_id: string
  rating: number
  note: string | null
  context_snapshot_json: string
  created_at: number
  updated_at: number
}

function rowToRating(row: ConversationRatingRow): ConversationRating {
  let snapshot: ConversationRatingSnapshot
  try {
    snapshot = JSON.parse(row.context_snapshot_json) as ConversationRatingSnapshot
  } catch {
    snapshot = EMPTY_SNAPSHOT
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    rating: row.rating,
    note: row.note,
    snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function broadcastRatingChange(conversationId: string, rating: ConversationRating | null): void {
  const payload = { conversationId, rating }
  broadcastToMobile({ event: 'rating:updated', data: payload })
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send('rating:updated', payload)
  })
}

export function submitRatingForConversation(
  conversationId: string,
  rating: number,
  note?: string | null,
): ConversationRating {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('rating must be an integer between 1 and 5')
  }
  const db = getDatabase()
  const snapshot = buildRatingSnapshot(db, conversationId)
  const now = Date.now()
  const existing = db
    .prepare('SELECT id, created_at FROM conversation_ratings WHERE conversation_id = ?')
    .get(conversationId) as { id: string; created_at: number } | undefined
  const id = existing?.id ?? randomUUID()
  const createdAt = existing?.created_at ?? now

  db.prepare(
    `INSERT INTO conversation_ratings (id, conversation_id, rating, note, context_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET
       rating = excluded.rating,
       note = excluded.note,
       context_snapshot_json = excluded.context_snapshot_json,
       updated_at = excluded.updated_at`,
  ).run(id, conversationId, rating, note ?? null, JSON.stringify(snapshot), createdAt, now)

  const result: ConversationRating = {
    id,
    conversationId,
    rating,
    note: note ?? null,
    snapshot,
    createdAt,
    updatedAt: now,
  }
  broadcastRatingChange(conversationId, result)
  return result
}

export function getRatingForConversation(conversationId: string): ConversationRating | null {
  const db = getDatabase()
  const row = db
    .prepare('SELECT * FROM conversation_ratings WHERE conversation_id = ?')
    .get(conversationId) as ConversationRatingRow | undefined
  return row ? rowToRating(row) : null
}

export function deleteRatingForConversation(conversationId: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM conversation_ratings WHERE conversation_id = ?').run(conversationId)
  if (result.changes === 0) return false
  broadcastRatingChange(conversationId, null)
  return true
}

/** Denormalized table rows for the RatingsPane/RatingsScreen — sourced from the frozen snapshot, not live joins. */
export function listRatings(): ConversationRatingListItem[] {
  const db = getDatabase()
  const rows = db
    .prepare(
      `SELECT cr.*, c.title as conversation_title FROM conversation_ratings cr
       JOIN conversations c ON c.id = cr.conversation_id
       ORDER BY cr.updated_at DESC`,
    )
    .all() as (ConversationRatingRow & { conversation_title: string })[]

  return rows.map((row) => {
    const rating = rowToRating(row)
    return {
      id: rating.id,
      conversationId: rating.conversationId,
      conversationTitle: row.conversation_title,
      projectId: rating.snapshot.projectId,
      projectName: rating.snapshot.projectName,
      rating: rating.rating,
      note: rating.note,
      agentName: rating.snapshot.agentName,
      model: rating.snapshot.model,
      toolNames: rating.snapshot.toolNames,
      skillNames: rating.snapshot.skillNames,
      createdAt: rating.createdAt,
      updatedAt: rating.updatedAt,
    }
  })
}

function aggregateBy(
  rows: { rating: number; snapshot: ConversationRatingSnapshot }[],
  getLabels: (snapshot: ConversationRatingSnapshot) => (string | null)[],
): RatingAggregate[] {
  const buckets = new Map<string, { sum: number; count: number }>()
  for (const row of rows) {
    for (const label of getLabels(row.snapshot)) {
      if (!label) continue
      const bucket = buckets.get(label) ?? { sum: 0, count: 0 }
      bucket.sum += row.rating
      bucket.count += 1
      buckets.set(label, bucket)
    }
  }
  return [...buckets.entries()]
    .map(([label, { sum, count }]) => ({ label, average: sum / count, count }))
    .sort((a, b) => b.average - a.average || b.count - a.count)
}

export function getRatingStats(): ConversationRatingStats {
  const db = getDatabase()
  const rawRows = db.prepare('SELECT rating, context_snapshot_json, updated_at FROM conversation_ratings').all() as {
    rating: number
    context_snapshot_json: string
    updated_at: number
  }[]

  const rows = rawRows.map((row) => {
    let snapshot: ConversationRatingSnapshot
    try {
      snapshot = JSON.parse(row.context_snapshot_json) as ConversationRatingSnapshot
    } catch {
      snapshot = EMPTY_SNAPSHOT
    }
    return { rating: row.rating, snapshot, updatedAt: row.updated_at }
  })

  const trendBuckets = new Map<string, { sum: number; count: number }>()
  for (const row of rows) {
    const date = new Date(row.updatedAt).toISOString().slice(0, 10)
    const bucket = trendBuckets.get(date) ?? { sum: 0, count: 0 }
    bucket.sum += row.rating
    bucket.count += 1
    trendBuckets.set(date, bucket)
  }
  const trend = [...trendBuckets.entries()]
    .map(([date, { sum, count }]) => ({ date, average: sum / count, count }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    averageByAgent: aggregateBy(rows, (s) => [s.agentName]),
    averageByModel: aggregateBy(rows, (s) => [s.model]),
    averageBySkill: aggregateBy(rows, (s) => s.skillNames),
    averageByServer: aggregateBy(rows, (s) => s.serverNames),
    averageByProject: aggregateBy(rows, (s) => [s.projectName]),
    trend,
  }
}

export function registerRatingHandlers(): void {
  safeHandle('rating:submit', (_event, conversationId: string, rating: number, note?: string | null): ConversationRating => {
    return submitRatingForConversation(conversationId, rating, note)
  })

  safeHandle('rating:get', (_event, conversationId: string): ConversationRating | null => {
    return getRatingForConversation(conversationId)
  })

  safeHandle('rating:delete', (_event, conversationId: string): boolean => {
    return deleteRatingForConversation(conversationId)
  })

  safeHandle('rating:list', (): ConversationRatingListItem[] => {
    return listRatings()
  })

  safeHandle('rating:get-stats', (): ConversationRatingStats => {
    return getRatingStats()
  })
}
