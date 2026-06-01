import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { formatWikiSection, getRelevantWikiEntries, scoreWikiEntry } from '../wiki-context'

let db: Database.Database

function insertProject(id: string) {
  db.prepare(
    'INSERT INTO projects (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, id, 'blue', 1, 1)
}

function insertWiki(id: string, projectId: string, title: string, body: string, tags: string[] = []) {
  db.prepare(
    'INSERT INTO project_wiki_entries (id, project_id, title, body, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, projectId, title, body, JSON.stringify(tags), Date.now(), Date.now())
}

beforeEach(() => {
  db = new Database(':memory:')
  initializeBaseSchema(db)
  runMigrations(db)
  insertProject('p1')
})

describe('scoreWikiEntry', () => {
  it('returns 0 for empty user text', () => {
    expect(scoreWikiEntry('', { title: 'Auth flow', body: 'JWT tokens', tags: [] })).toBe(0)
  })

  it('returns 0 when no tokens overlap', () => {
    expect(scoreWikiEntry('unrelated nonsense', { title: 'Auth flow', body: 'JWT tokens', tags: [] })).toBe(0)
  })

  it('scores higher for matching title words', () => {
    const scoreTitle = scoreWikiEntry('auth flow setup', { title: 'Auth flow', body: 'some other stuff', tags: [] })
    const scoreBody = scoreWikiEntry('auth flow setup', { title: 'Deployment', body: 'auth flow explained', tags: [] })
    expect(scoreTitle).toBeGreaterThan(scoreBody)
  })

  it('includes tag tokens in scoring', () => {
    const withTag = scoreWikiEntry('authentication', {
      title: 'Login',
      body: 'User signs in',
      tags: ['authentication'],
    })
    const withoutTag = scoreWikiEntry('authentication', {
      title: 'Login',
      body: 'User signs in',
      tags: [],
    })
    expect(withTag).toBeGreaterThan(withoutTag)
  })
})

describe('getRelevantWikiEntries', () => {
  it('returns empty array when no entries exist', () => {
    const results = getRelevantWikiEntries(db, 'p1', 'some query')
    expect(results).toEqual([])
  })

  it('returns entries sorted by relevance score', () => {
    insertWiki('w1', 'p1', 'Auth tokens', 'JWT and OAuth flows', ['auth'])
    insertWiki('w2', 'p1', 'Deployment guide', 'Docker and Kubernetes setup', ['infra'])

    const results = getRelevantWikiEntries(db, 'p1', 'auth tokens JWT')
    expect(results[0].id).toBe('w1')
  })

  it('respects maxEntries limit', () => {
    for (let i = 0; i < 8; i++) {
      insertWiki(`w${i}`, 'p1', `Auth entry ${i}`, 'auth tokens JWT flow authentication', ['auth'])
    }
    const results = getRelevantWikiEntries(db, 'p1', 'auth tokens', 3)
    expect(results.length).toBeLessThanOrEqual(3)
  })

  it('excludes superseded entries', () => {
    insertWiki('w1', 'p1', 'Old auth flow', 'outdated info')
    db.prepare('UPDATE project_wiki_entries SET superseded_by = ? WHERE id = ?').run('w2', 'w1')

    const results = getRelevantWikiEntries(db, 'p1', 'auth flow old')
    expect(results.every((r) => r.id !== 'w1')).toBe(true)
  })

  it('returns entries even with empty user text (most recent first)', () => {
    insertWiki('w1', 'p1', 'Entry one', 'body one')
    insertWiki('w2', 'p1', 'Entry two', 'body two')

    const results = getRelevantWikiEntries(db, 'p1', '')
    expect(results.length).toBeGreaterThan(0)
  })

  it('parses tags correctly from JSON', () => {
    insertWiki('w1', 'p1', 'Tagged entry', 'body', ['tag1', 'tag2'])
    const results = getRelevantWikiEntries(db, 'p1', '')
    expect(results[0].tags).toEqual(['tag1', 'tag2'])
  })
})

describe('formatWikiSection', () => {
  it('returns empty string for no entries', () => {
    expect(formatWikiSection([])).toBe('')
  })

  it('includes [Project Wiki Knowledge] header', () => {
    const entries = [
      { id: 'w1', title: 'Auth flow', body: 'JWT tokens', tags: ['auth'], score: 1 },
    ]
    const section = formatWikiSection(entries)
    expect(section).toContain('[Project Wiki Knowledge]')
    expect(section).toContain('### Auth flow')
    expect(section).toContain('[auth]')
    expect(section).toContain('JWT tokens')
  })

  it('truncates long body text', () => {
    const longBody = 'a'.repeat(1000)
    const entries = [{ id: 'w1', title: 'Long entry', body: longBody, tags: [], score: 1 }]
    const section = formatWikiSection(entries)
    expect(section).toContain('...')
  })

  it('omits tag block when no tags', () => {
    const entries = [{ id: 'w1', title: 'No tags', body: 'body content', tags: [], score: 1 }]
    const section = formatWikiSection(entries)
    // The entry title line should not have a [tag] block; only the section header has brackets
    const entryLine = section.split('\n').find((l) => l.startsWith('###'))
    expect(entryLine).toBe('### No tags')
  })
})
