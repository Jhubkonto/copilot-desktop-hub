import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const state = vi.hoisted(() => ({ db: null as Database.Database | null }))

vi.mock('../database', () => ({
  getDatabase: () => {
    if (!state.db) throw new Error('test database is not ready')
    return state.db
  },
}))

import { handleStandaloneSyncCommand } from '../standalone-sync'

describe('standalone peer synchronization', () => {
  beforeEach(() => {
    state.db = new Database(':memory:')
    state.db.pragma('foreign_keys = ON')
    initializeBaseSchema(state.db)
    runMigrations(state.db)
    state.db.prepare(
      'INSERT INTO projects (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('project-1', 'Desktop name', 'blue', 1, 10)
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  function command(command: string, data: Record<string, unknown>) {
    const payload = command === 'sync:hello'
      ? {
          schemaVersion: 2,
          supportedEntityTypes: ['project', 'agent', 'conversation', 'message', 'wiki', 'prompt', 'skill'],
          attachmentSupport: 'metadata',
          maxBatchSize: 100,
          ...data,
        }
      : data
    const reply = vi.fn()
    expect(handleStandaloneSyncCommand(command, payload, reply)).toBe(true)
    expect(reply).toHaveBeenCalledTimes(1)
    return reply.mock.calls[0][0] as { event: string; data: Record<string, any> }
  }

  it('loads the shared canonical fixture without field loss', () => {
    const fixture = JSON.parse(
      readFileSync(resolve(process.cwd(), 'fixtures/standalone-sync-v1.json'), 'utf8'),
    ) as Record<string, any>
    expect(fixture.schemaVersion).toBe(1)
    expect(Object.keys(fixture.entities)).toEqual([
      'project', 'agent', 'conversation', 'message', 'wiki', 'prompt', 'skill',
    ])
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture)
    expect(fixture.normalizedChatTurn.map((event: Record<string, unknown>) => event.type))
      .toEqual(['turn_started', 'assistant_text_delta', 'turn_completed'])
  })

  it('negotiates protocol and returns a versioned snapshot', () => {
    const result = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })

    expect(result.event).toBe('sync:welcome')
    expect(result.data.protocolVersion).toBe(1)
    expect(result.data.schemaVersion).toBe(2)
    expect(result.data.attachmentSupport).toBe('metadata')
    expect(result.data.maxBatchSize).toBe(100)
    expect(result.data.snapshot.projects).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'project-1', name: 'Desktop name' })]),
    )
    expect(result.data.snapshot.versions['project:project-1']).toBe(1)
  })

  it('applies and acknowledges an idempotent Android operation', () => {
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    const operation = {
      operationId: 'operation-1',
      deviceId: 'android-1',
      deviceSequence: 1,
      entityType: 'project',
      entityId: 'project-1',
      operation: 'upsert',
      payloadJson: JSON.stringify({
        id: 'project-1',
        name: 'Android name',
        color: 'green',
        createdAt: 1,
        updatedAt: 20,
      }),
      baseRemoteVersion: 1,
    }

    const first = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [operation],
    })
    const replay = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [operation],
    })

    expect(first.data.operationIds).toEqual(['operation-1'])
    expect(first.data.conflicts).toEqual([])
    expect(replay.data.operationIds).toEqual(['operation-1'])
    expect(
      state.db!.prepare('SELECT name, color FROM projects WHERE id = ?').get('project-1'),
    ).toMatchObject({ name: 'Android name', color: 'green' })
    expect(
      state.db!.prepare('SELECT COUNT(*) AS count FROM sync_applied_operations').get(),
    ).toMatchObject({ count: 1 })
  })

  it('preserves both versions when the base version is stale', () => {
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    state.db!.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
      .run('New desktop edit', 30, 'project-1')
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })

    const result = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [{
        operationId: 'operation-conflict',
        deviceId: 'android-1',
        deviceSequence: 2,
        entityType: 'project',
        entityId: 'project-1',
        operation: 'upsert',
        payloadJson: JSON.stringify({ id: 'project-1', name: 'Android edit', color: 'blue' }),
        baseRemoteVersion: 1,
      }],
    })

    expect(result.data.conflicts).toHaveLength(1)
    expect(
      state.db!.prepare('SELECT name FROM projects WHERE id = ?').get('project-1'),
    ).toMatchObject({ name: 'New desktop edit' })
    expect(
      state.db!.prepare('SELECT COUNT(*) AS count FROM sync_conflicts WHERE resolved_at IS NULL').get(),
    ).toMatchObject({ count: 1 })
  })

  it('automatically merges independent field changes from the same base version', () => {
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    state.db!.prepare('UPDATE projects SET color = ?, updated_at = ? WHERE id = ?')
      .run('green', 30, 'project-1')
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })

    const result = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [{
        operationId: 'operation-merge',
        deviceId: 'android-1',
        deviceSequence: 3,
        entityType: 'project',
        entityId: 'project-1',
        operation: 'upsert',
        payloadJson: JSON.stringify({
          id: 'project-1',
          name: 'Android name',
          color: 'blue',
          config: {},
          createdAt: 1,
          updatedAt: 20,
        }),
        baseRemoteVersion: 1,
      }],
    })

    expect(result.data.conflicts).toEqual([])
    expect(
      state.db!.prepare('SELECT name, color FROM projects WHERE id = ?').get('project-1'),
    ).toMatchObject({ name: 'Android name', color: 'green' })
  })

  it('rejects incompatible protocol versions without mutating device state', () => {
    const result = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 99,
    })

    expect(result.event).toBe('sync:error')
    expect(result.data.code).toBe('unsupported-protocol')
    expect(state.db!.prepare('SELECT COUNT(*) AS count FROM sync_devices').get()).toMatchObject({ count: 0 })
  })

  it('rejects incompatible schema versions without mutating device state', () => {
    const result = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
      schemaVersion: 99,
    })

    expect(result.event).toBe('sync:error')
    expect(result.data.code).toBe('unsupported-schema')
    expect(state.db!.prepare('SELECT COUNT(*) AS count FROM sync_devices').get()).toMatchObject({ count: 0 })
  })

  it('supports one prior Android sync schema without enabling unsupported attachments', () => {
    const result = command('sync:hello', {
      deviceId: 'android-prior',
      datasetId: 'dataset-1',
      protocolVersion: 1,
      schemaVersion: 1,
      attachmentSupport: 'metadata',
    })

    expect(result.event).toBe('sync:welcome')
    expect(result.data.schemaVersion).toBe(1)
    expect(result.data.attachmentSupport).toBe('none')
  })

  it('records desktop-originated changes with a stable device and monotonic sequence', () => {
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    state.db!.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
      .run('Desktop changed', 50, 'project-1')
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })

    const changes = state.db!.prepare(`
      SELECT sequence, device_id, entity_version FROM sync_desktop_changes
      WHERE dataset_id = ? AND entity_type = 'project' AND entity_id = ?
      ORDER BY sequence
    `).all('dataset-1', 'project-1') as Array<{
      sequence: number
      device_id: string
      entity_version: number
    }>
    expect(changes).toHaveLength(2)
    expect(changes[1].sequence).toBeGreaterThan(changes[0].sequence)
    expect(changes[1].device_id).toBe(changes[0].device_id)
    expect(changes.map(change => change.entity_version)).toEqual([1, 2])
  })

  it('synchronizes conversation archive and in-place message edits', () => {
    state.db!.prepare(`
      INSERT INTO conversations (id, title, created_at, updated_at)
      VALUES ('conversation-edit', 'Editable', 1, 1)
    `).run()
    state.db!.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, timestamp)
      VALUES ('message-edit', 'conversation-edit', 'user', 'Before', 2)
    `).run()
    const hello = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })

    const result = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [{
        operationId: 'archive-conversation',
        deviceId: 'android-1',
        deviceSequence: 40,
        entityType: 'conversation',
        entityId: 'conversation-edit',
        operation: 'upsert',
        payloadJson: JSON.stringify({
          id: 'conversation-edit',
          title: 'Editable',
          archived: true,
          createdAt: 1,
          updatedAt: 3,
        }),
        baseRemoteVersion: hello.data.snapshot.versions['conversation:conversation-edit'],
      }, {
        operationId: 'edit-message',
        deviceId: 'android-1',
        deviceSequence: 41,
        entityType: 'message',
        entityId: 'message-edit',
        operation: 'upsert',
        payloadJson: JSON.stringify({
          id: 'message-edit',
          conversationId: 'conversation-edit',
          role: 'user',
          content: 'After',
          timestamp: 2,
        }),
        baseRemoteVersion: hello.data.snapshot.versions['message:message-edit'],
      }],
    })

    expect(result.data.conflicts).toEqual([])
    expect(state.db!.prepare('SELECT archived FROM conversations WHERE id = ?').get('conversation-edit'))
      .toMatchObject({ archived: 1 })
    expect(state.db!.prepare('SELECT content FROM messages WHERE id = ?').get('message-edit'))
      .toMatchObject({ content: 'After' })
  })

  it('applies the selected Android value and converges after conflict resolution', () => {
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    state.db!.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
      .run('Desktop edit', 30, 'project-1')
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    const conflictResult = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [{
        operationId: 'operation-resolve',
        deviceId: 'android-1',
        deviceSequence: 10,
        entityType: 'project',
        entityId: 'project-1',
        operation: 'upsert',
        payloadJson: JSON.stringify({ id: 'project-1', name: 'Android edit', color: 'blue' }),
        baseRemoteVersion: 1,
      }],
    })
    const conflictId = conflictResult.data.conflicts[0].id

    const resolved = command('sync:resolve-conflict', { conflictId, resolution: 'remote' })

    expect(resolved.event).toBe('sync:conflict-resolved')
    expect(state.db!.prepare('SELECT name FROM projects WHERE id = ?').get('project-1'))
      .toMatchObject({ name: 'Android edit' })
    expect(state.db!.prepare('SELECT COUNT(*) AS count FROM sync_conflicts WHERE resolved_at IS NULL').get())
      .toMatchObject({ count: 0 })
  })

  it('preserves a delete-versus-edit conflict for review', () => {
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    state.db!.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
      .run('Desktop retained edit', 40, 'project-1')
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })

    const result = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [{
        operationId: 'operation-delete-conflict',
        deviceId: 'android-1',
        deviceSequence: 11,
        entityType: 'project',
        entityId: 'project-1',
        operation: 'delete',
        payloadJson: JSON.stringify({ id: 'project-1', deletedAt: 50 }),
        baseRemoteVersion: 1,
      }],
    })

    expect(result.data.conflicts).toHaveLength(1)
    expect(state.db!.prepare('SELECT name FROM projects WHERE id = ?').get('project-1'))
      .toMatchObject({ name: 'Desktop retained edit' })
  })

  it('excludes secrets and device-local paths in both synchronization directions', () => {
    state.db!.prepare('UPDATE projects SET config_json = ? WHERE id = ?').run(JSON.stringify({
      description: 'portable',
      apiKey: 'desktop-secret',
      rootDirectory: 'C:\\private\\workspace',
      nested: { token: 'pairing-secret', enabled: true },
    }), 'project-1')

    const hello = command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    const serialized = JSON.stringify(hello.data.snapshot)
    expect(serialized).toContain('portable')
    expect(serialized).not.toContain('desktop-secret')
    expect(serialized).not.toContain('pairing-secret')
    expect(serialized).not.toContain('private')

    command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [{
        operationId: 'operation-secret-filter',
        deviceId: 'android-1',
        deviceSequence: 9,
        entityType: 'project',
        entityId: 'project-1',
        operation: 'upsert',
        payloadJson: JSON.stringify({
          id: 'project-1',
          name: 'Safe project',
          color: 'blue',
          config: {
            description: 'allowed',
            api_key: 'android-secret',
            workspacePath: '/private/mobile',
          },
        }),
        baseRemoteVersion: hello.data.snapshot.versions['project:project-1'],
      }],
    })
    const row = state.db!.prepare('SELECT config_json FROM projects WHERE id = ?').get('project-1') as {
      config_json: string
    }
    expect(JSON.parse(row.config_json)).toEqual({ description: 'allowed' })
  })

  it('resumes content-hashed attachment transfer and serves completed chunks', () => {
    const content = Buffer.from('resumable attachment bytes')
    const hash = createHash('sha256').update(content).digest('hex')
    const first = content.subarray(0, 10)
    const second = content.subarray(10)

    const manifest = command('sync:attachment-manifest', {
      contentHash: hash,
      displayName: 'proof.txt',
      mimeType: 'text/plain',
      sizeBytes: content.length,
      attachmentId: 'attachment-1',
      messageId: 'message-1',
    })
    expect(manifest.data).toMatchObject({ nextOffset: 0, complete: false })

    const partial = command('sync:attachment-chunk', {
      contentHash: hash,
      offset: 0,
      dataBase64: first.toString('base64'),
    })
    expect(partial.data).toMatchObject({ nextOffset: 10, complete: false })

    const resumed = command('sync:attachment-manifest', {
      contentHash: hash,
      displayName: 'proof.txt',
      mimeType: 'text/plain',
      sizeBytes: content.length,
    })
    expect(resumed.data).toMatchObject({ nextOffset: 10, complete: false })

    const complete = command('sync:attachment-chunk', {
      contentHash: hash,
      offset: 10,
      dataBase64: second.toString('base64'),
    })
    expect(complete.data).toMatchObject({ nextOffset: content.length, complete: true })

    const pulled = command('sync:attachment-pull', { contentHash: hash, offset: 0 })
    expect(Buffer.from(pulled.data.dataBase64, 'base64')).toEqual(content)
    expect(pulled.data).toMatchObject({
      displayName: 'proof.txt',
      attachmentId: 'attachment-1',
      messageId: 'message-1',
      complete: true,
    })
  })

  it('orders device sequences and safely replays after a dropped acknowledgement', () => {
    command('sync:hello', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      protocolVersion: 1,
    })
    const first = {
      operationId: 'ordered-1',
      deviceId: 'android-1',
      deviceSequence: 20,
      entityType: 'project',
      entityId: 'project-1',
      operation: 'upsert',
      payloadJson: JSON.stringify({ id: 'project-1', name: 'First', color: 'blue' }),
      baseRemoteVersion: 1,
    }
    const second = {
      ...first,
      operationId: 'ordered-2',
      deviceSequence: 21,
      payloadJson: JSON.stringify({ id: 'project-1', name: 'Second', color: 'blue' }),
      baseRemoteVersion: 2,
    }

    const applied = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [second, first],
    })
    const replay = command('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [second, first],
    })

    expect(applied.data.conflicts).toEqual([])
    expect(replay.data.operationIds).toEqual(['ordered-1', 'ordered-2'])
    expect(state.db!.prepare('SELECT name FROM projects WHERE id = ?').get('project-1'))
      .toMatchObject({ name: 'Second' })
  })

  it('rolls back a partial batch when application terminates with an invalid operation', () => {
    const reply = vi.fn()
    expect(() => handleStandaloneSyncCommand('sync:push', {
      deviceId: 'android-1',
      datasetId: 'dataset-1',
      operations: [{
        operationId: 'partial-valid',
        deviceId: 'android-1',
        deviceSequence: 30,
        entityType: 'project',
        entityId: 'project-new',
        operation: 'upsert',
        payloadJson: JSON.stringify({ id: 'project-new', name: 'Must roll back', color: 'blue' }),
        baseRemoteVersion: 0,
      }, {
        operationId: 'partial-invalid',
        deviceId: 'android-1',
        deviceSequence: 31,
        entityType: 'unsupported',
        entityId: 'invalid',
        operation: 'upsert',
        payloadJson: '{}',
        baseRemoteVersion: 0,
      }],
    }, reply)).toThrow('Unsupported sync entity type')
    expect(state.db!.prepare('SELECT 1 FROM projects WHERE id = ?').get('project-new')).toBeUndefined()
    expect(state.db!.prepare('SELECT COUNT(*) AS count FROM sync_applied_operations').get())
      .toMatchObject({ count: 0 })
  })
})
