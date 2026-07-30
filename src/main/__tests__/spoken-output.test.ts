import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const providerMocks = vi.hoisted(() => ({
  getApiKey: vi.fn(() => 'test-key'),
  sendProviderNonStreaming: vi.fn(),
}))

vi.mock('../providers', () => ({
  DEFAULT_PROVIDER_MODEL: 'openai:gpt-test',
  getProviderForAgent: vi.fn(() => ({ provider: 'openai', model: 'gpt-test' })),
  getApiKey: providerMocks.getApiKey,
  sendProviderNonStreaming: providerMocks.sendProviderNonStreaming,
}))

vi.mock('../cli-adapters/claude', () => ({
  ClaudeAdapter: { isAvailable: vi.fn(() => false), send: vi.fn() },
}))

import {
  findLatestAssistantMessage,
  generateAiSpokenOutput,
  getMessageSpokenOutput,
  saveMessageSpokenOutput,
} from '../spoken-output'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initializeBaseSchema(db)
  runMigrations(db)
  db.prepare(
    'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run('conversation-1', 'Test', 1, 1)
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, 'assistant', ?, ?)",
  ).run('message-1', 'conversation-1', '**Completed.** Run `npm test` at https://example.com.', 1)
  providerMocks.sendProviderNonStreaming.mockReset()
})

afterEach(() => db.close())

describe('shared spoken-output service', () => {
  it('sanitizes and upserts deterministic output against an assistant message', () => {
    const first = saveMessageSpokenOutput(db, {
      messageId: 'message-1',
      spokenText: '**Completed.** Run `npm test` at https://example.com.',
      outputKind: 'response',
      generationKind: 'deterministic',
    })
    const second = saveMessageSpokenOutput(db, {
      messageId: 'message-1',
      spokenText: 'A shorter recap.',
      outputKind: 'quick-recap',
      generationKind: 'deterministic',
    })

    expect(first.spokenText).toBe('Completed. Run at')
    expect(second).toMatchObject({
      messageId: 'message-1',
      spokenText: 'A shorter recap.',
      outputKind: 'quick-recap',
      generationKind: 'deterministic',
    })
    expect(getMessageSpokenOutput(db, 'message-1')).toEqual(second)
  })

  it('generates, labels, sanitizes, and persists an optional provider recap', async () => {
    providerMocks.sendProviderNonStreaming.mockResolvedValue({
      content: '**Done.** See https://example.com and run `npm test`.',
    })
    const context = findLatestAssistantMessage(db, 'conversation-1')

    const result = await generateAiSpokenOutput(db, context!, 'ai-recap')

    expect(result).toMatchObject({
      messageId: 'message-1',
      spokenText: 'Done. See and run.',
      outputKind: 'ai-recap',
      generationKind: 'provider',
      model: 'openai:gpt-test',
    })
    expect(providerMocks.sendProviderNonStreaming).toHaveBeenCalledOnce()
    expect(getMessageSpokenOutput(db, 'message-1')).toEqual(result)
  })

  it('cascades persisted spoken output when its source message is deleted', () => {
    saveMessageSpokenOutput(db, {
      messageId: 'message-1',
      spokenText: 'Completed.',
      outputKind: 'response',
      generationKind: 'deterministic',
    })
    db.prepare('DELETE FROM messages WHERE id = ?').run('message-1')
    expect(getMessageSpokenOutput(db, 'message-1')).toBeNull()
  })
})
