import { getDatabase } from './database'
import type { ConversationRatingSnapshot } from '../shared/types'

export interface SimilarRatedStrategy {
  conversationId: string
  rating: number
  note: string | null
  snapshot: ConversationRatingSnapshot
  ratedAt: number
}

export interface FindSimilarRatedStrategiesParams {
  agentId?: string | null
  model?: string | null
  projectId?: string | null
  keywords?: string[]
  limit?: number
}

type ConversationRatingRow = {
  conversation_id: string
  rating: number
  note: string | null
  context_snapshot_json: string
  updated_at: number
}

/**
 * Plain SQL match/score over conversation_ratings — no vector store, no embedding
 * infrastructure exists in this codebase (confirmed by search), so a keyword/field-overlap
 * heuristic is the appropriate retrieval mechanism here, not semantic similarity.
 * Ranked by match quality (project > agent > model > keyword overlap), then rating, then recency.
 */
export function findSimilarRatedStrategies(params: FindSimilarRatedStrategiesParams): SimilarRatedStrategy[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT conversation_id, rating, note, context_snapshot_json, updated_at FROM conversation_ratings').all() as ConversationRatingRow[]

  const keywords = params.keywords ?? []

  const scored = rows
    .map((row) => {
      let snapshot: ConversationRatingSnapshot
      try {
        snapshot = JSON.parse(row.context_snapshot_json) as ConversationRatingSnapshot
      } catch {
        return null
      }

      let score = 0
      if (params.projectId && snapshot.projectId === params.projectId) score += 4
      if (params.agentId && snapshot.agentId === params.agentId) score += 2
      if (params.model && snapshot.model === params.model) score += 1
      if (keywords.length > 0) {
        score += keywords.filter((k) => snapshot.keywords.includes(k)).length
      }
      if (score === 0) return null

      return { row, snapshot, score }
    })
    .filter((entry): entry is { row: ConversationRatingRow; snapshot: ConversationRatingSnapshot; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score || b.row.rating - a.row.rating || b.row.updated_at - a.row.updated_at)
    .slice(0, params.limit ?? 5)

  return scored.map(({ row, snapshot }) => ({
    conversationId: row.conversation_id,
    rating: row.rating,
    note: row.note,
    snapshot,
    ratedAt: row.updated_at,
  }))
}
