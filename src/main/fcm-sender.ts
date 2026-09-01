import { safeStorage } from 'electron'
import { GoogleAuth } from 'google-auth-library'
import type Database from 'better-sqlite3'
import { log } from './logger'

const FCM_SA_KEY = 'fcm_service_account'
const FCM_SA_ENCRYPTED_KEY = 'fcm_service_account_encrypted'
const FCM_SCOPES = ['https://www.googleapis.com/auth/firebase.messaging']
const FCM_ENDPOINT = 'https://fcm.googleapis.com/v1/projects'

let cachedAuth: GoogleAuth | null = null
let cachedSaJson: string | null = null

interface ServiceAccountJson {
  project_id: string
  client_email: string
  private_key: string
  type: string
}

export interface FcmConfigStatus {
  configured: boolean
  projectId?: string
  /** Safe metadata only; the service-account private key is never returned. */
  clientEmail?: string
}

export interface FcmVerificationStatus extends FcmConfigStatus {
  authenticated: boolean
  error?: string
}

function parseSaJson(json: string): ServiceAccountJson {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(json) as Record<string, unknown>
  } catch {
    throw new Error('Invalid service account JSON — paste the complete JSON key file.')
  }
  if (
    typeof parsed.project_id !== 'string' ||
    typeof parsed.client_email !== 'string' ||
    typeof parsed.private_key !== 'string' ||
    parsed.type !== 'service_account'
  ) {
    throw new Error('Invalid service account JSON — must include project_id, client_email, private_key, and type: "service_account"')
  }
  return parsed as unknown as ServiceAccountJson
}

export function saveFcmServiceAccount(db: Database.Database, json: string): void {
  parseSaJson(json) // validate before storing
  cachedAuth = null
  cachedSaJson = null
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(json).toString('base64')
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(FCM_SA_KEY, encrypted)
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(FCM_SA_ENCRYPTED_KEY, 'true')
  } else {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(FCM_SA_KEY, json)
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(FCM_SA_ENCRYPTED_KEY, 'false')
  }
}

function loadFcmServiceAccountJson(db: Database.Database): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(FCM_SA_KEY) as { value: string } | undefined
  if (!row?.value) return null
  const encRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(FCM_SA_ENCRYPTED_KEY) as { value: string } | undefined
  if (encRow?.value === 'true' && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(row.value, 'base64'))
  }
  return row.value
}

export function getFcmConfigStatus(db: Database.Database): FcmConfigStatus {
  const json = loadFcmServiceAccountJson(db)
  if (!json) return { configured: false }
  try {
    const parsed = parseSaJson(json)
    return { configured: true, projectId: parsed.project_id, clientEmail: parsed.client_email }
  } catch {
    return { configured: false }
  }
}

function getAuth(saJson: string): GoogleAuth {
  if (cachedAuth && cachedSaJson === saJson) return cachedAuth
  cachedAuth = new GoogleAuth({ credentials: JSON.parse(saJson), scopes: FCM_SCOPES })
  cachedSaJson = saJson
  return cachedAuth
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Verifies the stored credentials against Google without sending a notification. */
export async function verifyFcmConfig(db: Database.Database): Promise<FcmVerificationStatus> {
  const saJson = loadFcmServiceAccountJson(db)
  if (!saJson) return { configured: false, authenticated: false, error: 'No Firebase service account is saved.' }

  let parsed: ServiceAccountJson | undefined
  try {
    parsed = parseSaJson(saJson)
    const client = await getAuth(saJson).getClient()
    const tokenResponse = await client.getAccessToken()
    if (!tokenResponse.token) throw new Error('Google did not return an access token.')
    return {
      configured: true,
      authenticated: true,
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
    }
  } catch (error) {
    const message = errorMessage(error)
    log.warn('[fcm] Firebase credential verification failed:', message)
    return {
      configured: Boolean(parsed),
      authenticated: false,
      projectId: parsed?.project_id,
      clientEmail: parsed?.client_email,
      error: message,
    }
  }
}

type MobileToken = { device_id: string; fcm_token: string }

async function getFcmAccess(db: Database.Database): Promise<{ projectId: string; accessToken: string; tokens: MobileToken[] } | null> {
  const saJson = loadFcmServiceAccountJson(db)
  if (!saJson) return null

  let parsed: ServiceAccountJson
  try {
    parsed = parseSaJson(saJson)
  } catch (error) {
    log.warn('[fcm] Stored Firebase configuration is invalid:', errorMessage(error))
    return null
  }

  const tokens = db.prepare('SELECT device_id, fcm_token FROM mobile_clients').all() as MobileToken[]
  if (tokens.length === 0) return null

  try {
    const client = await getAuth(saJson).getClient()
    const tokenResponse = await client.getAccessToken()
    if (!tokenResponse.token) throw new Error('Google did not return an access token.')
    return { projectId: parsed.project_id, accessToken: tokenResponse.token, tokens }
  } catch (error) {
    log.error('[fcm] Unable to authenticate with Firebase:', errorMessage(error))
    return null
  }
}

async function sendFcmDataNotification(
  db: Database.Database,
  type: string,
  data: Record<string, string>,
): Promise<void> {
  const access = await getFcmAccess(db)
  if (!access) return

  await Promise.allSettled(access.tokens.map(async ({ device_id, fcm_token }) => {
    const body = JSON.stringify({
      message: {
        token: fcm_token,
        // These are data-only messages. High transport priority is required for
        // approvals and completion events to wake a background Android app promptly.
        android: { priority: 'high' },
        data: { type, ...data },
      },
    })

    try {
      const res = await fetch(`${FCM_ENDPOINT}/${access.projectId}/messages:send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
      })

      if (res.status === 404 || res.status === 410) {
        db.prepare('DELETE FROM mobile_clients WHERE device_id = ?').run(device_id)
      }

      if (!res.ok) {
        const responseBody = (await res.text()).slice(0, 1000)
        log.error(`[fcm] ${type} delivery failed (${res.status}) for device ${device_id}:`, responseBody)
      }
    } catch (error) {
      log.error(`[fcm] ${type} delivery request failed for device ${device_id}:`, errorMessage(error))
    }
  }))
}

export async function sendSchedulerRunNotification(
  db: Database.Database,
  payload: { type: 'run-completed' | 'run-failed' | 'run-approval-required'; taskId: string; taskName: string; status: string; conversationId: string | null },
): Promise<void> {
  const data: Record<string, string> = {
    taskId: payload.taskId,
    taskName: payload.taskName,
    status: payload.status,
  }
  if (payload.conversationId) data.conversationId = payload.conversationId
  return sendFcmDataNotification(db, `scheduler:${payload.type}`, data)
}

export function sendDesktopOnlinePush(db: Database.Database, wsUrl: string): Promise<void> {
  return sendFcmDataNotification(db, 'desktop:online', { wsUrl })
}

export function sendIpChangedPush(db: Database.Database, wsUrl: string): Promise<void> {
  return sendFcmDataNotification(db, 'desktop:ip-changed', { wsUrl })
}

export function sendChatCompleteNotification(db: Database.Database, payload: { conversationId: string; title: string }): Promise<void> {
  return sendFcmDataNotification(db, 'chat:complete', payload)
}

/** Pushed when a deferred job resolves, before its follow-up turn starts. */
export function sendDeferredJobNotification(db: Database.Database, payload: { conversationId: string; title: string; body?: string }): Promise<void> {
  return sendFcmDataNotification(db, 'deferred:complete', payload)
}

export function sendDebriefCompleteNotification(db: Database.Database, payload: { conversationId: string; title: string }): Promise<void> {
  return sendFcmDataNotification(db, 'debrief:complete', payload)
}

export function sendQuizCompleteNotification(db: Database.Database, payload: { conversationId: string; title: string }): Promise<void> {
  return sendFcmDataNotification(db, 'quiz:complete', payload)
}

export function sendApprovalPush(
  db: Database.Database,
  payload: { requestId: string; toolName: string; args: Record<string, unknown>; description: string },
): Promise<void> {
  return sendFcmDataNotification(db, 'tool:approval-request', {
    requestId: payload.requestId,
    toolName: payload.toolName,
    args: JSON.stringify(payload.args),
    description: payload.description,
  })
}
