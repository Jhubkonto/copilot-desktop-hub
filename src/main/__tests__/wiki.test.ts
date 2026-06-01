import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initializeBaseSchema, runMigrations } from '../database-migrations'

const { mockSendNonStreaming } = vi.hoisted(() => ({
  mockSendNonStreaming: vi.fn(),
}))

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
}))

vi.mock('../copilot-api', () => ({
  sendCopilotNonStreaming: mockSendNonStreaming,
}))

vi.mock('../database', () => ({
  getDatabase: () => {
    if (!state.db) throw new Error('Database not initialized')
    return state.db
  },
}))

vi.mock('../safe-handle', () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    state.ipcHandlers.set(channel, handler)
  },
}))

const mockRandomUUID = vi.fn()
vi.mock('crypto', () => ({ randomUUID: () => mockRandomUUID() }))

function insertProject(id: string, name = id) {
  state.db?.prepare(
    'INSERT INTO projects (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name, 'blue', 1, 1)
}

function insertConversation(id: string, projectId = 'project-1') {
  state.db?.prepare(
    'INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, projectId, 'Conversation', 1, 1)
}

function insertMessage(id: string, conversationId: string, role: 'user' | 'assistant' | 'system' | 'team-activity', content: string, timestamp: number) {
  state.db?.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)'
  ).run(id, conversationId, role, content, timestamp)
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = state.ipcHandlers.get(channel)
  if (!handler) throw new Error(`No handler registered for "${channel}"`)
  return await handler({}, ...args) as T
}

describe('wiki handlers', () => {
  let findFuzzyMatch: typeof import('../wiki-handlers').findFuzzyMatch
  let computeBodyOverlap: typeof import('../wiki-handlers').computeBodyOverlap

  beforeEach(async () => {
    vi.clearAllMocks()
    state.ipcHandlers.clear()
    state.db?.close()
    state.db = new Database(':memory:')
    state.db.pragma('foreign_keys = ON')
    initializeBaseSchema(state.db)
    runMigrations(state.db)
    insertProject('project-1', 'Project One')
    insertProject('project-2', 'Project Two')
    mockRandomUUID
      .mockReset()
      .mockReturnValueOnce('wiki-1')
      .mockReturnValueOnce('wiki-2')
      .mockReturnValueOnce('wiki-3')
      .mockReturnValueOnce('wiki-4')
      .mockReturnValueOnce('wiki-5')
      .mockReturnValueOnce('wiki-6')
      .mockReturnValueOnce('wiki-7')
      .mockReturnValueOnce('wiki-8')

    const wikiHandlers = await import('../wiki-handlers')
    findFuzzyMatch = wikiHandlers.findFuzzyMatch
    computeBodyOverlap = wikiHandlers.computeBodyOverlap
    wikiHandlers.registerWikiHandlers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    state.db?.close()
    state.db = null
  })

  it('createWikiEntry creates an entry with correct fields', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)

    const result = await invoke<{
      id: string
      project_id: string
      title: string
      body: string
      tags: string[]
      source_conversation_id: string | null
      source_message_id: string | null
      created_at: number
      updated_at: number
    }>(
      'wiki:create-entry',
      'project-1',
      'Architecture',
      'Initial notes',
      ['docs', 'phase-1'],
      { conversationId: 'conv-1', messageId: 'msg-1' },
    )

    expect(result).toMatchObject({
      id: 'wiki-1',
      project_id: 'project-1',
      title: 'Architecture',
      body: 'Initial notes',
      tags: ['docs', 'phase-1'],
      source_conversation_id: 'conv-1',
      source_message_id: 'msg-1',
      created_at: 1000,
      updated_at: 1000,
    })
  })

  it('listWikiEntries returns entries for the correct project only', async () => {
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    await invoke('wiki:create-entry', 'project-1', 'P1 note', 'One', ['alpha'])
    now = 2000
    await invoke('wiki:create-entry', 'project-2', 'P2 note', 'Two', ['beta'])

    const result = await invoke<Array<{ project_id: string; title: string }>>('wiki:list-entries', 'project-1')

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ project_id: 'project-1', title: 'P1 note' })
  })

  it('updateWikiEntry updates title, body, tags', async () => {
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    const created = await invoke<{ id: string; created_at: number }>(
      'wiki:create-entry',
      'project-1',
      'Old title',
      'Old body',
      ['old']
    )
    now = 2000
    const updated = await invoke<{ title: string; body: string; tags: string[]; updated_at: number }>(
      'wiki:update-entry',
      created.id,
      { title: 'New title', body: 'New body', tags: ['new', 'docs'] }
    )

    expect(updated).toMatchObject({
      title: 'New title',
      body: 'New body',
      tags: ['new', 'docs'],
      updated_at: 2000,
    })
    expect(updated.updated_at).toBeGreaterThan(created.created_at)
  })

  it('deleteWikiEntry removes the entry', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)

    const created = await invoke<{ id: string }>('wiki:create-entry', 'project-1', 'Delete me', 'Soon gone', ['cleanup'])
    expect(await invoke<boolean>('wiki:delete-entry', created.id)).toBe(true)
    expect(await invoke('wiki:list-entries', 'project-1')).toEqual([])
  })

  it('listWikiEntries returns entries sorted by updated_at DESC', async () => {
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    const first = await invoke<{ id: string }>('wiki:create-entry', 'project-1', 'First', 'Older', ['a'])
    now = 2000
    await invoke('wiki:create-entry', 'project-1', 'Second', 'Newer', ['b'])
    now = 3000
    await invoke('wiki:update-entry', first.id, { body: 'Newest now' })

    const result = await invoke<Array<{ title: string }>>('wiki:list-entries', 'project-1')

    expect(result.map((entry) => entry.title)).toEqual(['First', 'Second'])
  })

  it('tags are stored and retrieved as arrays', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)

    const created = await invoke<{ id: string; tags: string[] }>('wiki:create-entry', 'project-1', 'Tags', 'Body', ['one', 'two'])
    const listed = await invoke<Array<{ id: string; tags: string[] }>>('wiki:list-entries', 'project-1')

    expect(created.tags).toEqual(['one', 'two'])
    expect(Array.isArray(listed[0].tags)).toBe(true)
    expect(listed[0]).toMatchObject({ id: created.id, tags: ['one', 'two'] })
  })

  it('createWikiEntry with tags=[] works correctly', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)

    const result = await invoke<{ tags: string[] }>('wiki:create-entry', 'project-1', 'Empty tags', 'Body', [])

    expect(result.tags).toEqual([])
  })

  it('wiki:extract-learnings returns empty candidates for empty conversations', async () => {
    insertConversation('conv-empty')

    await expect(invoke('wiki:extract-learnings', 'conv-empty', 'project-1')).resolves.toEqual({ candidates: [] })
    expect(mockSendNonStreaming).not.toHaveBeenCalled()
  })

  it('wiki:extract-learnings calls the extractor and parses JSON candidates', async () => {
    insertConversation('conv-1')
    insertMessage('msg-1', 'conv-1', 'user', 'We should use SQLite for the wiki cache.', 1000)
    insertMessage('msg-2', 'conv-1', 'assistant', 'Agreed. Persist extracted notes in project_wiki_entries.', 2000)
    await invoke('wiki:create-entry', 'project-1', 'SQLite wiki cache', 'Existing note', ['storage'])

    mockSendNonStreaming.mockResolvedValue({
      content: '```json\n[{"title":"SQLite wiki cache","body":"Use SQLite-backed project_wiki_entries for wiki persistence.","tags":["storage","wiki"]}]\n```',
      toolCalls: [],
    })

    const result = await invoke<{ candidates: Array<{ title: string; body: string; tags: string[]; matchingEntryId: string | null; matchingEntryTitle: string | null; supersededEntryId: string | null; supersededEntryTitle: string | null }> }>(
      'wiki:extract-learnings',
      'conv-1',
      'project-1'
    )

    expect(mockSendNonStreaming).toHaveBeenCalledTimes(1)
    expect(mockSendNonStreaming).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('You are a knowledge extraction assistant.'),
        }),
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('User: We should use SQLite for the wiki cache.'),
        }),
      ]),
      undefined,
      'gpt-4o-mini',
      { maxTokens: 2000, temperature: 0.3 },
    )
    expect(result).toEqual({
      candidates: [
        {
          title: 'SQLite wiki cache',
          body: 'Use SQLite-backed project_wiki_entries for wiki persistence.',
          tags: ['storage', 'wiki'],
          matchingEntryId: 'wiki-1',
          matchingEntryTitle: 'SQLite wiki cache',
          supersededEntryId: null,
          supersededEntryTitle: null,
        },
      ],
    })
  })

  it('wiki:extract-learnings returns empty candidates for malformed model output', async () => {
    insertConversation('conv-bad')
    insertMessage('msg-1', 'conv-bad', 'user', 'Remember this.', 1000)
    mockSendNonStreaming.mockResolvedValue({ content: 'not json', toolCalls: [] })

    await expect(invoke('wiki:extract-learnings', 'conv-bad', 'project-1')).resolves.toEqual({ candidates: [] })
  })

  it('findFuzzyMatch handles exact, partial, and ignored short-word cases', () => {
    expect(findFuzzyMatch('SQLite wiki cache', [{ id: 'wiki-1', title: 'SQLite wiki cache' }])).toEqual({
      id: 'wiki-1',
      title: 'SQLite wiki cache',
    })
    expect(findFuzzyMatch('Wiki cache persistence', [{ id: 'wiki-2', title: 'SQLite wiki cache persistence' }])).toEqual({
      id: 'wiki-2',
      title: 'SQLite wiki cache persistence',
    })
    expect(findFuzzyMatch('Frontend theming guide', [{ id: 'wiki-3', title: 'SQLite wiki cache' }])).toBeNull()
    expect(findFuzzyMatch('API UI DB', [{ id: 'wiki-4', title: 'API UI DB' }])).toBeNull()
  })

  it('computeBodyOverlap returns high overlap for similar bodies', () => {
    const a = 'Use SQLite for persistent storage in the wiki system backend'
    const b = 'SQLite persistent storage wiki system backend approach'
    expect(computeBodyOverlap(a, b)).toBeGreaterThan(0.5)
  })

  it('computeBodyOverlap returns low overlap for unrelated bodies', () => {
    const a = 'Use SQLite for persistent storage in the wiki backend'
    const b = 'Frontend theme colors should follow the design system tokens'
    expect(computeBodyOverlap(a, b)).toBeLessThan(0.35)
  })

  it('computeBodyOverlap returns 1 for identical bodies', () => {
    expect(computeBodyOverlap('same words here exactly', 'same words here exactly')).toBe(1)
  })

  it('computeBodyOverlap returns 1 when both bodies are empty', () => {
    expect(computeBodyOverlap('', '')).toBe(1)
  })

  it('wiki:extract-learnings classifies as supersedes when existing body is substantive and divergent', async () => {
    insertConversation('conv-supersede')
    insertMessage('msg-s1', 'conv-supersede', 'user', 'Switched from SQLite to PostgreSQL for storage.', 1000)
    insertMessage('msg-s2', 'conv-supersede', 'assistant', 'PostgreSQL is now the recommended backend database.', 2000)
    await invoke('wiki:create-entry', 'project-1', 'Database choice', 'Originally used SQLite for persistent local storage in the project backend database.', ['storage'])

    mockSendNonStreaming.mockResolvedValue({
      content: '[{"title":"Database choice","body":"PostgreSQL is now the standard database replacing the previous SQLite approach entirely for all environments.","tags":["storage","database"]}]',
      toolCalls: [],
    })

    const result = await invoke<{ candidates: Array<{ matchingEntryId: string | null; supersededEntryId: string | null; supersededEntryTitle: string | null }> }>(
      'wiki:extract-learnings', 'conv-supersede', 'project-1'
    )

    expect(result.candidates[0].matchingEntryId).toBeNull()
    expect(result.candidates[0].supersededEntryId).not.toBeNull()
    expect(result.candidates[0].supersededEntryTitle).toBe('Database choice')
  })
})
