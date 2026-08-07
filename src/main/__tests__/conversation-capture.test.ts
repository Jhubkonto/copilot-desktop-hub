import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
}))

vi.mock('../database', () => ({
  getDatabase: () => {
    if (!state.db) throw new Error('Database not initialized')
    return state.db
  },
}))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  nativeImage: { createFromBuffer: vi.fn() },
}))
vi.mock('../agents', () => ({ getAgentConfig: vi.fn(() => null) }))
vi.mock('../file-handlers', () => ({ listDirectoryEntries: vi.fn(() => []) }))
function baseProjectConfig() {
  return {
    instructions: '', instructionsEnabled: true, rootDirectory: '', sources: [], repositories: [], variables: [],
    instructionMode: 'prepend', workflowMode: 'single-agent', orchestrationEnabled: false,
    maxDelegationDepth: 5, showTeamActivity: true, inScope: [], outOfScope: [], milestones: [],
    strategyRetrievalEnabled: false, codingWorkspace: false, workspaceInfo: null, verifyCommands: null,
    terminalSandboxBypass: false,
  }
}
vi.mock('../project-handlers', () => ({
  parseProjectConfig: vi.fn(() => baseProjectConfig()),
}))
vi.mock('../wiki-context', () => ({ getRelevantWikiEntries: vi.fn(() => []), formatWikiSection: vi.fn(() => '') }))
vi.mock('../wiki-handlers', () => ({ insertWikiEntry: vi.fn() }))
vi.mock('../tools', () => ({ requestApproval: vi.fn() }))
vi.mock('../project-audit', () => ({
  inferProjectAuditTarget: vi.fn(() => null),
  recordProjectAuditChange: vi.fn(),
}))
vi.mock('../remote-edit/fix-agent', () => ({ computeLineDiff: vi.fn(() => []) }))
vi.mock('../debug-mode', () => ({ debugLog: vi.fn() }))

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { buildChatContext } from '../chat-context-builder'
import { parseProjectConfig } from '../project-handlers'

function makeWebContents() {
  return { send: vi.fn(), isDestroyed: vi.fn().mockReturnValue(false) } as unknown as Electron.WebContents
}

describe('conversation capture instrumentation — skill invocations', () => {
  beforeEach(() => {
    state.db?.close()
    state.db = new Database(':memory:')
    initializeBaseSchema(state.db)
    runMigrations(state.db)

    const db = state.db
    db.prepare("INSERT INTO agents (id, config_json) VALUES ('agent-1', '{}')").run()
    db.prepare("INSERT INTO skills (id, config_json) VALUES ('skill-1', ?)").run(JSON.stringify({
      name: 'release-notes', description: 'Prepare release notes when the user asks for a changelog.', instructions: 'Summarize user-facing changes.',
    }))
    db.prepare("INSERT INTO skills (id, config_json) VALUES ('skill-2', ?)").run(JSON.stringify({
      name: 'test-runner', description: 'Run focused tests after code changes.', instructions: 'Run the narrowest relevant tests first.',
    }))
    db.prepare(
      "INSERT INTO agent_skills (agent_id, skill_id, sort_order, attached_at) VALUES ('agent-1', 'skill-1', 0, 1)",
    ).run()
    db.prepare(
      "INSERT INTO agent_skills (agent_id, skill_id, sort_order, attached_at) VALUES ('agent-1', 'skill-2', 1, 1)",
    ).run()
    db.prepare(
      "INSERT INTO conversations (id, agent_id, title) VALUES ('conv-1', 'agent-1', 'Test')",
    ).run()
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  it('does not log attached skills as invoked when they are only advertised', async () => {
    const db = state.db!
    await buildChatContext(db, 'conv-1', 'Hello', {}, makeWebContents(), vi.fn())

    const rows = db
      .prepare('SELECT skill_id, agent_id FROM conversation_skill_invocations WHERE conversation_id = ? ORDER BY skill_id')
      .all('conv-1') as { skill_id: string; agent_id: string }[]

    expect(rows).toEqual([])
  })

  it('logs only the skill explicitly activated with $skill-name', async () => {
    const db = state.db!
    const result = await buildChatContext(db, 'conv-1', '$release-notes Summarize this release', {}, makeWebContents(), vi.fn())
    await buildChatContext(db, 'conv-1', 'Follow-up', {}, makeWebContents(), vi.fn())

    const rows = db
      .prepare('SELECT skill_id, agent_id, trigger FROM conversation_skill_invocations WHERE conversation_id = ?')
      .all('conv-1') as { skill_id: string; agent_id: string; trigger: string }[]

    expect(result.augmentedContent).toContain('Explicitly activated skill: release-notes')
    expect(rows).toEqual([{ skill_id: 'skill-1', agent_id: 'agent-1', trigger: 'explicit' }])
  })

  it('logs an implicit activation only when activate_skill is called', async () => {
    const db = state.db!
    const context = await buildChatContext(db, 'conv-1', 'Please prepare a changelog', {}, makeWebContents(), vi.fn())
    const activate = context.skillInlineHandlers.get('activate_skill')!
    expect(await activate({ name: 'release-notes' })).toEqual(expect.objectContaining({ success: true }))

    const count = db
      .prepare('SELECT COUNT(*) as count FROM conversation_skill_invocations WHERE conversation_id = ?')
      .get('conv-1') as { count: number }
    expect(count.count).toBe(1)
  })

  it('logs nothing when the resolved agent has no attached skills', async () => {
    const db = state.db!
    db.prepare("INSERT INTO agents (id, config_json) VALUES ('agent-2', '{}')").run()
    db.prepare("INSERT INTO conversations (id, agent_id, title) VALUES ('conv-2', 'agent-2', 'Test 2')").run()

    await buildChatContext(db, 'conv-2', 'Hello', {}, makeWebContents(), vi.fn())

    const count = db
      .prepare('SELECT COUNT(*) as count FROM conversation_skill_invocations WHERE conversation_id = ?')
      .get('conv-2') as { count: number }
    expect(count.count).toBe(0)
  })
})

describe('conversation capture instrumentation — similar past strategies retrieval', () => {
  beforeEach(() => {
    state.db?.close()
    state.db = new Database(':memory:')
    initializeBaseSchema(state.db)
    runMigrations(state.db)
    vi.mocked(parseProjectConfig).mockReturnValue(baseProjectConfig() as ReturnType<typeof parseProjectConfig>)

    const db = state.db
    db.prepare("INSERT INTO projects (id, name) VALUES ('proj-1', 'Test Project')").run()
    db.prepare(
      "INSERT INTO conversations (id, project_id, title) VALUES ('conv-1', 'proj-1', 'Investigate flaky login')",
    ).run()
    db.prepare(
      `INSERT INTO conversation_ratings (id, conversation_id, rating, note, context_snapshot_json, created_at, updated_at)
       VALUES ('r-1', 'conv-old', 5, 'Worked great', ?, 1, 1)`,
    ).run(
      JSON.stringify({
        agentId: null, agentName: 'Research Agent', model: null, backend: null,
        projectId: 'proj-1', workflowMode: 'single-agent',
        toolNames: ['search_project_wiki'], serverNames: ['Project Wiki'],
        skillIds: [], skillNames: [], keywords: ['login', 'flaky'],
      }),
    )
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  it('injects nothing when strategyRetrievalEnabled is off (zero token impact)', async () => {
    const db = state.db!
    const result = await buildChatContext(db, 'conv-1', 'Investigate the flaky login bug', {}, makeWebContents(), vi.fn())
    expect(result.augmentedContent).not.toContain('Similar Past Strategies')
  })

  it('injects a Similar Past Strategies block when enabled and a match exists', async () => {
    vi.mocked(parseProjectConfig).mockReturnValue({
      ...baseProjectConfig(),
      strategyRetrievalEnabled: true,
    } as ReturnType<typeof parseProjectConfig>)

    const db = state.db!
    const result = await buildChatContext(db, 'conv-1', 'Investigate the flaky login bug', {}, makeWebContents(), vi.fn())
    expect(result.augmentedContent).toContain('[Similar Past Strategies]')
    expect(result.augmentedContent).toContain('Rated 5/5')
    expect(result.augmentedContent).toContain('Research Agent')
  })

  it('injects nothing when enabled but no rated conversation matches', async () => {
    vi.mocked(parseProjectConfig).mockReturnValue({
      ...baseProjectConfig(),
      strategyRetrievalEnabled: true,
    } as ReturnType<typeof parseProjectConfig>)

    const db = state.db!
    db.prepare("INSERT INTO projects (id, name) VALUES ('proj-2', 'Other Project')").run()
    db.prepare(
      "INSERT INTO conversations (id, project_id, title) VALUES ('conv-2', 'proj-2', 'Something else entirely')",
    ).run()

    const result = await buildChatContext(db, 'conv-2', 'Totally unrelated request', {}, makeWebContents(), vi.fn())
    expect(result.augmentedContent).not.toContain('Similar Past Strategies')
  })
})
