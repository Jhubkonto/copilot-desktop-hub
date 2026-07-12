import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

describe('conversation rating tables — cascade-delete correctness', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    // Matches production: src/main/database.ts enables this on every real connection, which is
    // what makes the ON DELETE CASCADE clauses on these tables actually take effect.
    db.pragma('foreign_keys = ON')
    initializeBaseSchema(db)
    runMigrations(db)

    db.prepare("INSERT INTO agents (id, config_json) VALUES ('agent-1', '{\"name\":\"Research Agent\"}')").run()
    db.prepare("INSERT INTO skills (id, config_json) VALUES ('skill-1', '{\"name\":\"Deep Research\"}')").run()
    db.prepare("INSERT INTO conversations (id, agent_id, title) VALUES ('conv-1', 'agent-1', 'Test')").run()
    db.prepare(
      "INSERT INTO conversation_tool_calls (id, conversation_id, tool_name, server_name, success, created_at) VALUES ('tc-1', 'conv-1', 'search_project_wiki', 'Project Wiki', 1, 1)",
    ).run()
    db.prepare(
      "INSERT INTO conversation_skill_invocations (id, conversation_id, skill_id, agent_id, created_at) VALUES ('si-1', 'conv-1', 'skill-1', 'agent-1', 1)",
    ).run()
    db.prepare(
      `INSERT INTO conversation_ratings (id, conversation_id, rating, note, context_snapshot_json, created_at, updated_at)
       VALUES ('r-1', 'conv-1', 5, 'great', '{"agentName":"Research Agent","skillNames":["Deep Research"]}', 1, 1)`,
    ).run()
  })

  afterEach(() => {
    db.close()
  })

  it('removes rows in all three tables when the conversation is deleted', () => {
    db.prepare("DELETE FROM conversations WHERE id = 'conv-1'").run()

    expect(db.prepare("SELECT COUNT(*) as c FROM conversation_tool_calls WHERE conversation_id = 'conv-1'").get()).toEqual({ c: 0 })
    expect(db.prepare("SELECT COUNT(*) as c FROM conversation_skill_invocations WHERE conversation_id = 'conv-1'").get()).toEqual({ c: 0 })
    expect(db.prepare("SELECT COUNT(*) as c FROM conversation_ratings WHERE conversation_id = 'conv-1'").get()).toEqual({ c: 0 })
  })

  it('cascades conversation_skill_invocations when the skill is deleted, but does not touch the rating', () => {
    db.prepare("DELETE FROM skills WHERE id = 'skill-1'").run()

    expect(db.prepare("SELECT COUNT(*) as c FROM conversation_skill_invocations WHERE conversation_id = 'conv-1'").get()).toEqual({ c: 0 })
    const rating = db.prepare("SELECT context_snapshot_json FROM conversation_ratings WHERE conversation_id = 'conv-1'").get() as
      | { context_snapshot_json: string }
      | undefined
    expect(rating).toBeDefined()
    expect(JSON.parse(rating!.context_snapshot_json).skillNames).toEqual(['Deep Research'])
  })

  it('cascades conversation_skill_invocations when the agent is deleted, but the rating keeps its denormalized agentName readable', () => {
    db.prepare("DELETE FROM agents WHERE id = 'agent-1'").run()

    expect(db.prepare("SELECT COUNT(*) as c FROM conversation_skill_invocations WHERE conversation_id = 'conv-1'").get()).toEqual({ c: 0 })
    const rating = db.prepare("SELECT context_snapshot_json FROM conversation_ratings WHERE conversation_id = 'conv-1'").get() as
      | { context_snapshot_json: string }
      | undefined
    expect(rating).toBeDefined()
    expect(JSON.parse(rating!.context_snapshot_json).agentName).toBe('Research Agent')
  })

  it('does not remove the rating or its tool-call/skill rows when an unrelated conversation is deleted', () => {
    db.prepare("INSERT INTO conversations (id, title) VALUES ('conv-2', 'Other')").run()
    db.prepare("DELETE FROM conversations WHERE id = 'conv-2'").run()

    expect(db.prepare("SELECT COUNT(*) as c FROM conversation_tool_calls WHERE conversation_id = 'conv-1'").get()).toEqual({ c: 1 })
    expect(db.prepare("SELECT COUNT(*) as c FROM conversation_skill_invocations WHERE conversation_id = 'conv-1'").get()).toEqual({ c: 1 })
    expect(db.prepare("SELECT COUNT(*) as c FROM conversation_ratings WHERE conversation_id = 'conv-1'").get()).toEqual({ c: 1 })
  })
})
