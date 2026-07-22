import { safeStorage } from 'electron'
import { GoogleAuth } from 'google-auth-library'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import {
  DEFAULT_PROVIDER_MODEL,
  getProviderForAgent,
  getApiKey,
  sendProviderNonStreaming,
} from './providers'
import type { ProviderMessage } from './providers'
import { ClaudeAdapter } from './cli-adapters/claude'

const FCM_SA_KEY = 'fcm_service_account'
const FCM_SA_ENCRYPTED_KEY = 'fcm_service_account_encrypted'
const FCM_SCOPES = ['https://www.googleapis.com/auth/firebase.messaging']
const SPOKEN_SUMMARY_HEAD = 4000
const SPOKEN_SUMMARY_HARD_LIMIT = 40_000

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

const SPOKEN_SUMMARY_SYSTEM_PROMPT = `You are a brief summary assistant for spoken delivery. Analyze this AI chat conversation and return ONLY a 1-2 sentence summary in plain English. This summary will be read aloud by text-to-speech, so:
- Use simple, natural language
- Avoid markdown, symbols, technical jargon where possible
- Use contractions (it's, you'll) for a natural spoken tone
- Keep it concise — aim for under 20 words total if possible
Return only the summary text, nothing else.`

export async function generateSpokenSummary(db: Database.Database, conversationId: string, projectId: string | null): Promise<string | null> {
  try {
    const rows = db.prepare(
      "SELECT role, content FROM messages WHERE conversation_id = ? AND role IN ('user', 'assistant') ORDER BY timeline_order ASC, timestamp ASC, id ASC"
    ).all(conversationId) as { role: string; content: string }[]

    if (rows.length === 0) return null

    const transcript = rows
      .map((r) => `${r.role === 'user' ? 'User' : 'Assistant'}: ${r.content}`)
      .join('\n\n')

    const truncatedTranscript = transcript.length <= SPOKEN_SUMMARY_HARD_LIMIT
      ? transcript
      : transcript.slice(0, SPOKEN_SUMMARY_HEAD) + '\n\n[... conversation truncated ...]\n\n' + transcript.slice(-(SPOKEN_SUMMARY_HARD_LIMIT - SPOKEN_SUMMARY_HEAD))

    const userContent = `Here is the conversation to summarize:\n\n${truncatedTranscript}`

    let extractionProvider = DEFAULT_PROVIDER_MODEL
    if (projectId) {
      const agentRow = db.prepare(
        'SELECT a.config_json FROM project_agents pa JOIN agents a ON pa.agent_id = a.id WHERE pa.project_id = ? AND pa.is_primary = 1 LIMIT 1'
      ).get(projectId) as { config_json: string } | undefined
      try {
        const cfg = JSON.parse(agentRow?.config_json ?? '{}') as Record<string, unknown>
        if (typeof cfg.model === 'string' && cfg.model) extractionProvider = cfg.model
      } catch { /* use default */ }
    }

    const { provider, model: resolvedModel } = getProviderForAgent(extractionProvider)
    const apiKey = getApiKey(provider)

    let summary: string | null = null
    if (apiKey) {
      const messages: ProviderMessage[] = [
        { role: 'system', content: SPOKEN_SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ]
      const result = await sendProviderNonStreaming(provider, apiKey, resolvedModel, messages, {
        maxTokens: 200,
        temperature: 0.3,
      })
      summary = (result.content ?? '').trim()
    } else if (ClaudeAdapter.isAvailable()) {
      summary = await ClaudeAdapter.send(
        null as never,
        {
          systemPrompt: SPOKEN_SUMMARY_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userContent }],
          cwd: '',
          model: 'default',
          conversationId: randomUUID(),
        },
        () => {},
      )
      summary = summary.trim()
    }
    return summary || null
  } catch {
    return null
  }
}

export async function sendRemoteEditNotification(
  db: Database.Database,
  payload: { type: string; reportId: string; title: string; failedStep?: string | null },
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
            type: `remote-edit:${payload.type}`,
            reportId: payload.reportId,
            title: payload.title,
            ...(payload.failedStep ? { failedStep: payload.failedStep } : {}),
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

export async function sendSchedulerRunNotification(
  db: Database.Database,
  payload: { type: 'run-completed' | 'run-failed'; taskId: string; taskName: string; status: string; conversationId: string | null },
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
  payload: { conversationId: string; title: string; summary?: string },
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
      if (payload.summary) {
        data.summary = payload.summary
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
