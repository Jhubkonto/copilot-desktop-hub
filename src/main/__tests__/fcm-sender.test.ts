import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  authClient: {
    getAccessToken: vi.fn().mockResolvedValue({ token: 'access-token' }),
  },
  log: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((value: string) => Buffer.from(value)),
    decryptString: vi.fn((value: Buffer) => value.toString()),
  },
}))

vi.mock('google-auth-library', () => ({
  GoogleAuth: class GoogleAuth {
    getClient = vi.fn().mockResolvedValue(state.authClient)
  },
}))

vi.mock('../logger', () => ({ log: state.log }))

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import {
  getFcmConfigStatus,
  saveFcmServiceAccount,
  sendApprovalPush,
  verifyFcmConfig,
} from '../fcm-sender'

const serviceAccount = (projectId: string) => JSON.stringify({
  type: 'service_account',
  project_id: projectId,
  client_email: 'nexy@example.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\n',
})

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initializeBaseSchema(db)
  runMigrations(db)
  state.authClient.getAccessToken.mockResolvedValue({ token: 'access-token' })
  state.log.warn.mockReset()
  state.log.error.mockReset()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('') }))
})

afterEach(() => {
  db.close()
  vi.unstubAllGlobals()
})

describe('FCM sender', () => {
  it('reports safe saved metadata without returning the private key', () => {
    saveFcmServiceAccount(db, serviceAccount('nexy-test'))

    expect(getFcmConfigStatus(db)).toEqual({
      configured: true,
      projectId: 'nexy-test',
      clientEmail: 'nexy@example.iam.gserviceaccount.com',
    })
  })

  it('verifies Google authentication separately from structural configuration', async () => {
    saveFcmServiceAccount(db, serviceAccount('nexy-verified'))

    await expect(verifyFcmConfig(db)).resolves.toMatchObject({
      configured: true,
      authenticated: true,
      projectId: 'nexy-verified',
    })
  })

  it('sends data-only notifications at high Android transport priority', async () => {
    saveFcmServiceAccount(db, serviceAccount('nexy-delivery'))
    db.prepare('INSERT INTO mobile_clients (device_id, fcm_token, registered_at) VALUES (?, ?, ?)').run('device-1', 'token-1', Date.now())

    await sendApprovalPush(db, {
      requestId: 'request-1',
      toolName: 'read_file',
      args: { path: 'README.md' },
      description: 'Read the README',
    })

    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    const body = JSON.parse(String(request?.body))
    expect(body.message.android).toEqual({ priority: 'high' })
    expect(body.message.data.type).toBe('tool:approval-request')
  })

  it('logs Firebase HTTP failures instead of silently treating them as success', async () => {
    saveFcmServiceAccount(db, serviceAccount('nexy-failure'))
    db.prepare('INSERT INTO mobile_clients (device_id, fcm_token, registered_at) VALUES (?, ?, ?)').run('device-1', 'token-1', Date.now())
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403, text: vi.fn().mockResolvedValue('{"error":"permission denied"}') } as unknown as Response)

    await sendApprovalPush(db, {
      requestId: 'request-1',
      toolName: 'read_file',
      args: {},
      description: 'Read the README',
    })

    expect(state.log.error).toHaveBeenCalledWith(
      expect.stringContaining('[fcm] tool:approval-request delivery failed (403)'),
      '{"error":"permission denied"}',
    )
  })
})
