import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ db: null as Database.Database | null }))

vi.mock('../database', () => ({
  getDatabase: () => {
    if (!state.db) throw new Error('Database not initialized')
    return state.db
  },
}))

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { findSimilarRatedStrategies } from '../rating-retrieval'
import type { ConversationRatingSnapshot } from '../../shared/types'

function seedRating(
  db: Database.Database,
  conversationId: string,
  rating: number,
  snapshot: Partial<ConversationRatingSnapshot>,
  updatedAt: number,
) {
  const fullSnapshot: ConversationRatingSnapshot = {
    agentId: null,
    agentName: null,
    model: null,
    backend: null,
    projectName: null,
    projectId: null,
    workflowMode: null,
    toolNames: [],
    serverNames: [],
    skillIds: [],
    skillNames: [],
    keywords: [],
    ...snapshot,
  }
  db.prepare(
    `INSERT INTO conversation_ratings (id, conversation_id, rating, note, context_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(`rating-${conversationId}`, conversationId, rating, null, JSON.stringify(fullSnapshot), updatedAt, updatedAt)
}

describe('findSimilarRatedStrategies', () => {
  beforeEach(() => {
    state.db?.close()
    state.db = new Database(':memory:')
    initializeBaseSchema(state.db)
    runMigrations(state.db)
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  it('returns nothing when no rating matches on project, agent, model, or keywords', () => {
    const db = state.db!
    seedRating(db, 'conv-1', 5, { projectId: 'other-project' }, 100)

    const results = findSimilarRatedStrategies({ projectId: 'proj-1' })
    expect(results).toEqual([])
  })

  it('ranks project+agent match above project-only match, then by rating, then by recency', () => {
    const db = state.db!
    seedRating(db, 'conv-project-only-low', 2, { projectId: 'proj-1' }, 100)
    seedRating(db, 'conv-project-only-high', 5, { projectId: 'proj-1' }, 200)
    seedRating(db, 'conv-project-and-agent', 3, { projectId: 'proj-1', agentId: 'agent-1' }, 50)
    seedRating(db, 'conv-unrelated', 5, { projectId: 'other-project' }, 300)

    const results = findSimilarRatedStrategies({ projectId: 'proj-1', agentId: 'agent-1' })

    expect(results.map((r) => r.conversationId)).toEqual([
      'conv-project-and-agent',
      'conv-project-only-high',
      'conv-project-only-low',
    ])
  })

  it('scores keyword overlap and respects the limit', () => {
    const db = state.db!
    seedRating(db, 'conv-a', 4, { projectId: 'proj-1', keywords: ['login', 'flaky', 'staging'] }, 100)
    seedRating(db, 'conv-b', 4, { projectId: 'proj-1', keywords: ['login'] }, 200)
    seedRating(db, 'conv-c', 4, { projectId: 'proj-1', keywords: ['unrelated'] }, 300)

    const results = findSimilarRatedStrategies({
      projectId: 'proj-1',
      keywords: ['login', 'flaky', 'staging'],
      limit: 2,
    })

    expect(results.map((r) => r.conversationId)).toEqual(['conv-a', 'conv-b'])
  })
})
