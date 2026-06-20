import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initializeBaseSchema, runMigrations } from '../database-migrations'

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
}))

vi.mock('../database', () => ({
  getDatabase: () => {
    if (!state.db) throw new Error('Database not initialized')
    return state.db
  },
}))

import {
  createSkillConfig,
  deleteSkillConfig,
  duplicateSkillConfig,
  getSkillAgentLinks,
  getSkillAgentUsage,
  getSkillConfig,
  listSkillConfigs,
  reorderSkillsForAgent,
  setSkillAgentAttachment,
  updateSkillConfig,
} from '../skills'

function createDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initializeBaseSchema(db)
  runMigrations(db)
  return db
}

function insertAgent(id: string) {
  state.db?.prepare(
    'INSERT INTO agents (id, config_json, created_at, updated_at) VALUES (?, ?, ?, ?)'
  ).run(id, JSON.stringify({ id, name: id, icon: '' }), 1, 1)
}

describe('skill persistence helpers', () => {
  beforeEach(() => {
    state.db?.close()
    state.db = createDatabase()
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  it('creates, reads, updates, duplicates, lists, and deletes skill configs', () => {
    const created = createSkillConfig({
      name: 'Drawing',
      icon: '*',
      description: 'Sketch useful diagrams.',
      instructions: 'Prefer SVG when possible.',
      tags: ['visual'],
      tools: {
        fileEdit: { enabled: true, approval: 'always-ask', instructions: 'Write image files carefully.' },
        terminal: { enabled: false, approval: 'disabled', instructions: '' },
        webFetch: { enabled: true, approval: 'auto', instructions: 'Fetch references.' },
      },
      mcpServers: ['figma'],
      mcpServerTrust: [{ serverId: 'figma', trust: 'always-ask' }],
      mcpToolOverrides: [{
        serverId: 'figma',
        toolName: 'export_frame',
        enabled: true,
        approval: 'auto',
        instructions: 'Only export requested frames.',
      }],
      knowledge: [{ title: 'Style', content: 'Use restrained colors.' }],
    })

    expect(getSkillConfig(created.id)).toEqual(expect.objectContaining({
      id: created.id,
      name: 'Drawing',
      mcpServers: ['figma'],
      mcpServerTrust: [{ serverId: 'figma', trust: 'always-ask' }],
      mcpToolOverrides: [expect.objectContaining({ serverId: 'figma', toolName: 'export_frame' })],
    }))

    const updated = updateSkillConfig(created.id, {
      name: 'Drawing Assistant',
      tools: {
        fileEdit: { enabled: true, approval: 'auto', instructions: 'Save generated assets.' },
        terminal: { enabled: false, approval: 'disabled', instructions: '' },
        webFetch: { enabled: false, approval: 'disabled', instructions: '' },
      },
    })
    expect(updated.name).toBe('Drawing Assistant')
    expect(getSkillConfig(created.id)?.tools.fileEdit).toEqual({
      enabled: true,
      approval: 'auto',
      instructions: 'Save generated assets.',
    })

    const duplicated = duplicateSkillConfig(created.id)
    expect(duplicated).toEqual(expect.objectContaining({
      name: 'Drawing Assistant (copy)',
      instructions: 'Prefer SVG when possible.',
    }))
    expect(listSkillConfigs().map((skill) => skill.id)).toEqual(expect.arrayContaining([
      created.id,
      duplicated?.id,
    ]))

    expect(deleteSkillConfig(created.id)).toBe(true)
    expect(getSkillConfig(created.id)).toBeNull()
    expect(getSkillConfig(duplicated!.id)).not.toBeNull()
  })

  it('attaches, detaches, reorders, and reports agent skill usage', () => {
    insertAgent('agent-a')
    insertAgent('agent-b')
    const review = createSkillConfig({ name: 'Review' })
    const test = createSkillConfig({ name: 'Test Runner' })

    expect(setSkillAgentAttachment('agent-a', review.id, true)).toBe(true)
    expect(setSkillAgentAttachment('agent-a', test.id, true)).toBe(true)
    expect(setSkillAgentAttachment('agent-b', review.id, true)).toBe(true)

    expect(getSkillAgentLinks('agent-a').map((link) => link.skill_id)).toEqual([review.id, test.id])
    expect(getSkillAgentUsage()).toEqual(expect.arrayContaining([
      { skill_id: review.id, agent_count: 2 },
      { skill_id: test.id, agent_count: 1 },
    ]))

    expect(reorderSkillsForAgent('agent-a', [test.id, review.id])).toBe(true)
    expect(getSkillAgentLinks('agent-a')).toEqual([
      { skill_id: test.id, sort_order: 0 },
      { skill_id: review.id, sort_order: 1 },
    ])

    expect(setSkillAgentAttachment('agent-a', review.id, false)).toBe(true)
    expect(getSkillAgentLinks('agent-a').map((link) => link.skill_id)).toEqual([test.id])
    expect(getSkillAgentUsage()).toEqual(expect.arrayContaining([
      { skill_id: review.id, agent_count: 1 },
      { skill_id: test.id, agent_count: 1 },
    ]))
  })
})
