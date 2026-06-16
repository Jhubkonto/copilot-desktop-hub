import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { insertWikiEntry } from '../wiki-handlers'
import type { ToolDefinition } from '../provider-types'

let db: Database.Database

function insertProject(id: string) {
  db.prepare(
    'INSERT INTO projects (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, id, 'blue', 1, 1)
}

beforeEach(() => {
  db = new Database(':memory:')
  initializeBaseSchema(db)
  runMigrations(db)
  insertProject('p1')
})

// ─── insertWikiEntry helper ──────────────────────────────────────────────────

describe('insertWikiEntry', () => {
  it('inserts and returns a wiki entry', () => {
    const entry = insertWikiEntry(db, 'p1', 'My Title', 'My body content', ['tag1', 'tag2'])
    expect(entry.id).toBeTruthy()
    expect(entry.project_id).toBe('p1')
    expect(entry.title).toBe('My Title')
    expect(entry.body).toBe('My body content')
    expect(entry.tags).toEqual(['tag1', 'tag2'])
  })

  it('truncates title to 200 chars', () => {
    const longTitle = 'A'.repeat(250)
    const entry = insertWikiEntry(db, 'p1', longTitle, 'body', [])
    expect(entry.title.length).toBe(200)
  })

  it('sets sourceInfo when provided', () => {
    const entry = insertWikiEntry(db, 'p1', 'T', 'B', [], { conversationId: 'conv-1', messageId: 'msg-1' })
    expect(entry.source_conversation_id).toBe('conv-1')
    expect(entry.source_message_id).toBe('msg-1')
  })

  it('sets null source fields when sourceInfo is omitted', () => {
    const entry = insertWikiEntry(db, 'p1', 'T', 'B', [])
    expect(entry.source_conversation_id).toBeNull()
    expect(entry.source_message_id).toBeNull()
  })
})

// ─── runProviderMcpToolLoop inline handler dispatch ─────────────────────────

import { runProviderMcpToolLoop } from '../tool-loop'
import type { ProviderNonStreamResult } from '../provider-types'
import type { ProviderMessage } from '../providers'

function makeToolDef(name: string): ToolDefinition {
  return {
    type: 'function',
    function: { name, description: name, parameters: { type: 'object', properties: {} } },
  }
}

const fakeWebContents = {
  isDestroyed: () => false,
  send: vi.fn(),
} as unknown as Electron.WebContents

describe('runProviderMcpToolLoop — inline handlers', () => {
  it('dispatches to inlineHandler when toolMap has no match', async () => {
    const handler = vi.fn().mockResolvedValue({ success: true, result: 'wiki result' })
    const inlineHandlers = new Map([['my_inline_tool', handler]])

    let callCount = 0
    const caller = vi.fn().mockImplementation(async (): Promise<ProviderNonStreamResult> => {
      callCount++
      if (callCount === 1) {
        return {
          content: null,
          toolCalls: [{ id: 'tc1', name: 'my_inline_tool', arguments: { query: 'hello' } }],
        }
      }
      return { content: 'done', toolCalls: [] }
    })

    const messages: ProviderMessage[] = [{ role: 'user', content: 'test' }]
    const result = await runProviderMcpToolLoop(
      caller,
      messages,
      [makeToolDef('my_inline_tool')],
      new Map(),
      'agent-1',
      null,
      fakeWebContents,
      vi.fn(),
      undefined,
      undefined,
      inlineHandlers,
      'Use tools as needed.',
    )

    expect(handler).toHaveBeenCalledWith({ query: 'hello' })
    expect(result).toBe('done')
    expect(fakeWebContents.send).toHaveBeenCalledWith(
      'chat:tool-call-event',
      expect.objectContaining({ toolName: 'my_inline_tool', serverName: 'Project Wiki', success: true }),
    )
  })

  it('emits unknown-tool error when neither toolMap nor inlineHandlers match', async () => {
    let callCount = 0
    const caller = vi.fn().mockImplementation(async (): Promise<ProviderNonStreamResult> => {
      callCount++
      if (callCount === 1) {
        return {
          content: null,
          toolCalls: [{ id: 'tc1', name: 'ghost_tool', arguments: {} }],
        }
      }
      return { content: 'done', toolCalls: [] }
    })

    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'x' }],
      [],
      new Map(),
      'agent-1',
      null,
      fakeWebContents,
      vi.fn(),
      undefined,
      undefined,
      undefined,
      'tools',
    )

    expect(result).toBe('done')
    expect(fakeWebContents.send).toHaveBeenCalledWith(
      'chat:tool-call-event',
      expect.objectContaining({ success: false }),
    )
  })

  it('respects custom toolDirective in system message', async () => {
    const caller = vi.fn().mockResolvedValue({ content: 'ok', toolCalls: [] })
    const messages: ProviderMessage[] = [{ role: 'system', content: 'system content' }]

    await runProviderMcpToolLoop(
      caller,
      messages,
      [],
      new Map(),
      'a',
      null,
      fakeWebContents,
      vi.fn(),
      undefined,
      undefined,
      undefined,
      'Custom directive here.',
    )

    const calledMessages = caller.mock.calls[0][0] as ProviderMessage[]
    expect(calledMessages[0].content).toContain('Custom directive here.')
  })

  it('inline handler error is forwarded to model', async () => {
    const handler = vi.fn().mockResolvedValue({ success: false, error: 'not found' })
    const inlineHandlers = new Map([['bad_tool', handler]])

    let callCount = 0
    const caller = vi.fn().mockImplementation(async (): Promise<ProviderNonStreamResult> => {
      callCount++
      if (callCount === 1) {
        return { content: null, toolCalls: [{ id: 'tc1', name: 'bad_tool', arguments: {} }] }
      }
      return { content: 'handled', toolCalls: [] }
    })

    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'x' }],
      [makeToolDef('bad_tool')],
      new Map(),
      'a',
      null,
      fakeWebContents,
      vi.fn(),
      undefined,
      undefined,
      inlineHandlers,
      'tools',
    )

    expect(result).toBe('handled')
    // The tool result message passed to model should contain 'Error: not found'
    const toolResultMsg = (caller.mock.calls[1][0] as ProviderMessage[]).find(m => m.role === 'tool')
    expect(toolResultMsg?.content).toContain('Error: not found')
  })
})

// ─── search_project_wiki inline handler ──────────────────────────────────────

import { getRelevantWikiEntries, formatWikiSection } from '../wiki-context'

describe('search_project_wiki handler logic', () => {
  it('returns no-results message when wiki is empty', () => {
    const entries = getRelevantWikiEntries(db, 'p1', 'anything')
    expect(entries).toHaveLength(0)
    // Handler would return the no-results message
  })

  it('returns formatted entries when matches found', () => {
    db.prepare(
      'INSERT INTO project_wiki_entries (id, project_id, title, body, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('e1', 'p1', 'Auth flow', 'JWT is used for auth', JSON.stringify(['auth']), 1, 1)

    const entries = getRelevantWikiEntries(db, 'p1', 'auth jwt')
    expect(entries.length).toBeGreaterThan(0)
    const formatted = formatWikiSection(entries)
    expect(formatted).toContain('Auth flow')
    expect(formatted).toContain('JWT')
  })
})

