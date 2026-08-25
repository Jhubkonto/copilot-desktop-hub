import { safeStorage } from 'electron'
import { GoogleAuth } from 'google-auth-library'
import type Database from 'better-sqlite3'

const FCM_SA_KEY = 'fcm_service_account'
const FCM_SA_ENCRYPTED_KEY = 'fcm_service_account_encrypted'
const FCM_SCOPES = ['https://www.googleapis.com/auth/firebase.messaging']

let cachedAuth: GoogleAuth | null = null
let cachedSaJson: string | null = null

interface ServiceAccountJson {
  project_id: string
  client_email: string
  private_key: string
  type: string
}

function parseSaJson(json: string): ServiceAccountJson {
  const parsed = JSON.parse(json) as Record<string, unknown>
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

export function getFcmConfigStatus(db: Database.Database): { configured: boolean; projectId?: string } {
  const json = loadFcmServiceAccountJson(db)
  if (!json) return { configured: false }
  try {
    const parsed = parseSaJson(json)
    return { configured: true, projectId: parsed.project_id }
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

export async function sendSchedulerRunNotification(
  db: Database.Database,
  payload: { type: 'run-completed' | 'run-failed' | 'run-approval-required'; taskId: string; taskName: string; status: string; conversationId: string | null },
): Promise<void> {
  const saJson = loadFcmServiceAccountJson(db)
  if (!saJson) return

  let parsed: ServiceAccountJson
  try {
    parsed = parseSaJson(saJson)
  } catch {
    return
  }

  const tokens = (db.prepare('SELECT device_id, fcm_token FROM mobile_clients').all() as { device_id: string; fcm_token: string }[])
  if (tokens.length === 0) return

  const auth = getAuth(saJson)
  const client = await auth.getClient()
  const tokenResponse = await client.getAccessToken()
  const accessToken = tokenResponse.token
  if (!accessToken) return

  const projectId = parsed.project_id

  await Promise.allSettled(
    tokens.map(async ({ device_id, fcm_token }) => {
      const data: Record<string, string> = {
        type: `scheduler:${payload.type}`,
        taskId: payload.taskId,
        taskName: payload.taskName,
        status: payload.status,
      }
      if (payload.conversationId) data.conversationId = payload.conversationId

      const body = JSON.stringify({
        message: {
          token: fcm_token,
          data,
        },
      })

      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
      })

      if (res.status === 404 || res.status === 410) {
        db.prepare('DELETE FROM mobile_clients WHERE device_id = ?').run(device_id)
      }
    })
  )
}

export async function sendDesktopOnlinePush(
  db: Database.Database,
  wsUrl: string,
): Promise<void> {
  const saJson = loadFcmServiceAccountJson(db)
  if (!saJson) return

  let parsed: ServiceAccountJson
  try {
    parsed = parseSaJson(saJson)
  } catch {
    return
  }

  const tokens = (db.prepare('SELECT device_id, fcm_token FROM mobile_clients').all() as { device_id: string; fcm_token: string }[])
  if (tokens.length === 0) return

  const auth = getAuth(saJson)
  const client = await auth.getClient()
  const tokenResponse = await client.getAccessToken()
  const accessToken = tokenResponse.token
  if (!accessToken) return

  const projectId = parsed.project_id

  await Promise.allSettled(
    tokens.map(async ({ device_id, fcm_token }) => {
      const body = JSON.stringify({
        message: {
          token: fcm_token,
          android: { priority: 'high' },
          data: { type: 'desktop:online', wsUrl },
        },
      })

      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
      })

      if (res.status === 404 || res.status === 410) {
        db.prepare('DELETE FROM mobile_clients WHERE device_id = ?').run(device_id)
      }
    })
  )
}

export async function sendIpChangedPush(
  db: Database.Database,
  wsUrl: string,
): Promise<void> {
  const saJson = loadFcmServiceAccountJson(db)
  if (!saJson) return

  let parsed: ServiceAccountJson
  try {
    parsed = parseSaJson(saJson)
  } catch {
    return
  }

  const tokens = (db.prepare('SELECT device_id, fcm_token FROM mobile_clients').all() as { device_id: string; fcm_token: string }[])
  if (tokens.length === 0) return

  const auth = getAuth(saJson)
  const client = await auth.getClient()
  const tokenResponse = await client.getAccessToken()
  const accessToken = tokenResponse.token
  if (!accessToken) return

  const projectId = parsed.project_id

  await Promise.allSettled(
    tokens.map(async ({ device_id, fcm_token }) => {
      const body = JSON.stringify({
        message: {
          token: fcm_token,
          android: { priority: 'high' },
          data: { type: 'desktop:ip-changed', wsUrl },
        },
      })

      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
      })

      if (res.status === 404 || res.status === 410) {
        db.prepare('DELETE FROM mobile_clients WHERE device_id = ?').run(device_id)
      }
    })
  )
}

export async function sendChatCompleteNotification(
  db: Database.Database,
  payload: { conversationId: string; title: string },
): Promise<void> {
  const saJson = loadFcmServiceAccountJson(db)
  if (!saJson) return

  let parsed: ServiceAccountJson
  try {
    parsed = parseSaJson(saJson)
  } catch {
    return
  }

  const tokens = (db.prepare('SELECT device_id, fcm_token FROM mobile_clients').all() as { device_id: string; fcm_token: string }[])
  if (tokens.length === 0) return

  const auth = getAuth(saJson)
  const client = await auth.getClient()
  const tokenResponse = await client.getAccessToken()
  const accessToken = tokenResponse.token
  if (!accessToken) return

  const projectId = parsed.project_id

  await Promise.allSettled(
    tokens.map(async ({ device_id, fcm_token }) => {
      const data: Record<string, string> = {
        type: 'chat:complete',
        conversationId: payload.conversationId,
        title: payload.title,
      }
      const body = JSON.stringify({
        message: {
          token: fcm_token,
          data,
        },
      })

      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
      })

      if (res.status === 404 || res.status === 410) {
        db.prepare('DELETE FROM mobile_clients WHERE device_id = ?').run(device_id)
      }
    })
  )
}

/**
 * Pushed the moment a deferred job (build, or an agent-tracked background command) resolves —
 * before the follow-up turn it triggers has even started generating a reply. Without this, a user
 * who put the phone down while a 20-minute Gradle build ran would only learn it finished once the
 * assistant's response to that result also finished streaming, which can lag the actual completion
 * by a full model turn.
 */
export async function sendDeferredJobNotification(
  db: Database.Database,
  payload: { conversationId: string; title: string; body?: string },
): Promise<void> {
  const saJson = loadFcmServiceAccountJson(db)
  if (!saJson) return

  let parsed: ServiceAccountJson
  try {
    parsed = parseSaJson(saJson)
  } catch {
    return
  }

  const tokens = (db.prepare('SELECT device_id, fcm_token FROM mobile_clients').all() as { device_id: string; fcm_token: string }[])
  if (tokens.length === 0) return

  const auth = getAuth(saJson)
  const client = await auth.getClient()
  const tokenResponse = await client.getAccessToken()
  const accessToken = tokenResponse.token
  if (!accessToken) return

  const projectId = parsed.project_id

  await Promise.allSettled(
    tokens.map(async ({ device_id, fcm_token }) => {
      const data: Record<string, string> = {
        type: 'deferred:complete',
        conversationId: payload.conversationId,
        title: payload.title,
        ...(payload.body ? { body: payload.body } : {}),
      }
      const body = JSON.stringify({
        message: {
          token: fcm_token,
          data,
        },
      })

      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
      })

      if (res.status === 404 || res.status === 410) {
        db.prepare('DELETE FROM mobile_clients WHERE device_id = ?').run(device_id)
      }
    })
  )
}

export async function sendDebriefCompleteNotification(
  db: Database.Database,
  payload: { conversationId: string; title: string },
): Promise<void> {
  const saJson = loadFcmServiceAccountJson(db)
  if (!saJson) return

  let parsed: ServiceAccountJson
  try {
    parsed = parseSaJson(saJson)
  } catch {
    return
  }

  const tokens = (db.prepare('SELECT device_id, fcm_token FROM mobile_clients').all() as { device_id: string; fcm_token: string }[])
  if (tokens.length === 0) return

  const auth = getAuth(saJson)
  const client = await auth.getClient()
  const tokenResponse = await client.getAccessToken()
  const accessToken = tokenResponse.token
  if (!accessToken) return

  const projectId = parsed.project_id

  await Promise.allSettled(
    tokens.map(async ({ device_id, fcm_token }) => {
      const body = JSON.stringify({
        message: {
          token: fcm_token,
          data: {
            type: 'debrief:complete',
            conversationId: payload.conversationId,
            title: payload.title,
          },
        },
      })

      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
      })

      if (res.status === 404 || res.status === 410) {
        db.prepare('DELETE FROM mobile_clients WHERE device_id = ?').run(device_id)
      }
    })
  )
}

export async function sendQuizCompleteNotification(
  db: Database.Database,
  payload: { conversationId: string; title: string },
): Promise<void> {
  const saJson = loadFcmServiceAccountJson(db)
  if (!saJson) return

  let parsed: ServiceAccountJson
  try {
    parsed = parseSaJson(saJson)
  } catch {
    return
  }

  const tokens = (db.prepare('SELECT device_id, fcm_token FROM mobile_clients').all() as { device_id: string; fcm_token: string }[])
  if (tokens.length === 0) return

  const auth = getAuth(saJson)
  const client = await auth.getClient()
  const tokenResponse = await client.getAccessToken()
  const accessToken = tokenResponse.token
  if (!accessToken) return

  const projectId = parsed.project_id

  await Promise.allSettled(
    tokens.map(async ({ device_id, fcm_token }) => {
      const body = JSON.stringify({
        message: {
          token: fcm_token,
          data: {
            type: 'quiz:complete',
            conversationId: payload.conversationId,
            title: payload.title,
          },
        },
      })

      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
      })

      if (res.status === 404 || res.status === 410) {
        db.prepare('DELETE FROM mobile_clients WHERE device_id = ?').run(device_id)
      }
    })
  )
}

export async function sendApprovalPush(
  db: Database.Database,
  payload: { requestId: string; toolName: string; args: Record<string, unknown>; description: string }
): Promise<void> {
  const saJson = loadFcmServiceAccountJson(db)
  if (!saJson) return

  let parsed: ServiceAccountJson
  try {
    parsed = parseSaJson(saJson)
  } catch {
    return
  }

  const tokens = (db.prepare('SELECT device_id, fcm_token FROM mobile_clients').all() as { device_id: string; fcm_token: string }[])
  if (tokens.length === 0) return

  const auth = getAuth(saJson)
  const client = await auth.getClient()
  const tokenResponse = await client.getAccessToken()
  const accessToken = tokenResponse.token
  if (!accessToken) return

  const projectId = parsed.project_id

  await Promise.allSettled(
    tokens.map(async ({ device_id, fcm_token }) => {
      const body = JSON.stringify({
        message: {
          token: fcm_token,
          data: {
            type: 'tool:approval-request',
            requestId: payload.requestId,
            toolName: payload.toolName,
            args: JSON.stringify(payload.args),
            description: payload.description,
          },
        },
      })

      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
      })

      if (res.status === 404 || res.status === 410) {
        db.prepare('DELETE FROM mobile_clients WHERE device_id = ?').run(device_id)
      }
    })
  )
}
