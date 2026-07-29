import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}))

vi.mock('../database', () => ({
  getDatabase: () => {
    if (!state.db) throw new Error('Database not initialized')
    return state.db
  },
}))

vi.mock('../safe-handle', () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    state.handlers.set(channel, handler)
  },
}))

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import {
  applyWikiChangeProposal,
  computeBodyOverlap,
  findFuzzyMatch,
  proposeWikiChange,
  registerWikiHandlers,
} from '../wiki-handlers'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return await handler({}, ...args) as T
}

describe('wiki handlers', () => {
  beforeEach(() => {
    state.handlers.clear()
    state.db?.close()
    state.db = new Database(':memory:')
    initializeBaseSchema(state.db)
    runMigrations(state.db)
    registerWikiHandlers()
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  it('computes word overlap', () => {
    expect(computeBodyOverlap('Alpha beta gamma', 'Alpha beta delta')).toBeGreaterThan(0)
  })

  it('finds fuzzy title matches', () => {
    expect(findFuzzyMatch('Caching strategy notes', [{ id: '1', title: 'Project caching strategy' }])).toEqual({ id: '1', title: 'Project caching strategy' })
  })

  it('creates and lists wiki entries', async () => {
    const entry = await invoke<{ id: string; title: string }>('wiki:create-entry', 'project-1', 'Testing', 'Body', ['tag'])
    const entries = await invoke<Array<{ id: string; title: string }>>('wiki:list-entries', 'project-1')

    expect(entry.id).toBeTruthy()
    expect(entries).toEqual([expect.objectContaining({ title: 'Testing' })])
  })

  it('classifies a new wiki proposal as create and applies it', () => {
    const db = state.db!
    const proposal = proposeWikiChange(db, 'project-1', 'Project memory rules', 'Useful facts should be saved.', ['wiki'])

    expect(proposal.action).toBe('create')
    const entry = applyWikiChangeProposal(db, proposal, { conversationId: 'conv-1' })

    expect(entry.title).toBe('Project memory rules')
    expect(entry.source_conversation_id).toBe('conv-1')
  })

  it('updates a fuzzy title match when the body substantially overlaps', () => {
    const db = state.db!
    const existing = applyWikiChangeProposal(
      db,
      proposeWikiChange(db, 'project-1', 'Project memory rules', 'Useful facts should be saved to the project wiki.', ['wiki']),
    )
    const proposal = proposeWikiChange(
      db,
      'project-1',
      'Memory rules',
      'Useful facts should be saved to the project wiki with approval.',
      ['wiki', 'approval'],
    )

    expect(proposal.action).toBe('update')
    const updated = applyWikiChangeProposal(db, proposal)

    expect(updated.id).toBe(existing.id)
    expect(updated.body).toContain('with approval')
  })

  it('supersedes a fuzzy title match when the body changes meaningfully', () => {
    const db = state.db!
    const old = applyWikiChangeProposal(
      db,
      proposeWikiChange(db, 'project-1', 'Deployment target', 'Deploy the app to staging only.', ['deploy']),
    )
    const proposal = proposeWikiChange(
      db,
      'project-1',
      'Deployment target',
      'Deploy the app to production after smoke tests pass.',
      ['deploy'],
    )

    expect(proposal.action).toBe('supersede')
    const replacement = applyWikiChangeProposal(db, proposal)
    const oldRow = db.prepare('SELECT superseded_by FROM project_wiki_entries WHERE id = ?').get(old.id) as { superseded_by: string | null }

    expect(replacement.id).not.toBe(old.id)
    expect(oldRow.superseded_by).toBe(replacement.id)
  })
})
