import { safeStorage, BrowserWindow } from 'electron'
import { getDatabase } from './database'
import https from 'https'
import { safeHandle } from './safe-handle'

const GITHUB_CLIENT_ID = 'Ov23li2lYX52yQHvwNPf'
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code'
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'
const SCOPES = 'read:user'

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

interface TokenResponse {
  access_token?: string
  token_type?: string
  scope?: string
  error?: string
}

interface GitHubUser {
  login: string
  avatar_url: string
  name: string | null
}

let pollTimer: ReturnType<typeof setInterval> | null = null

function httpPost(url: string, body: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(body).toString()
    const urlObj = new URL(url)
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }
    const req = https.request(options, (res) => {
      let result = ''
      res.on('data', (chunk) => (result += chunk))
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          console.error(`[auth] HTTP ${res.statusCode} from ${url}:`, result)
        }
        resolve(result)
      })
    })
    req.setTimeout(30000, () => {
      req.destroy(new Error('Request timed out'))
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function httpGet(url: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'CopilotDesktopHub'
      }
    }
    const req = https.request(options, (res) => {
      let result = ''
      res.on('data', (chunk) => (result += chunk))
      res.on('end', () => resolve(result))
    })
    req.setTimeout(30000, () => {
      req.destroy(new Error('Request timed out'))
    })
    req.on('error', reject)
    req.end()
  })
}

function storeToken(token: string): void {
  const db = getDatabase()
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(token).toString('base64')
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auth_token', ?)").run(encrypted)
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auth_encrypted', 'true')").run()
  } else {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auth_token', ?)").run(token)
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auth_encrypted', 'false')").run()
  }
}

function retrieveToken(): string | null {
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'auth_token'").get() as
    | { value: string }
    | undefined
  if (!row) return null

  const encRow = db.prepare("SELECT value FROM settings WHERE key = 'auth_encrypted'").get() as
    | { value: string }
    | undefined
  if (encRow?.value === 'true' && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(row.value, 'base64'))
  }
  return row.value
}

function clearToken(): void {
  const db = getDatabase()
  db.prepare("DELETE FROM settings WHERE key IN ('auth_token', 'auth_encrypted', 'auth_user')").run()
}

async function fetchGitHubUser(token: string): Promise<GitHubUser | null> {
  try {
    const result = await httpGet(GITHUB_USER_URL, token)
    const user = JSON.parse(result) as GitHubUser
    if (user.login) {
      const db = getDatabase()
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auth_user', ?)").run(
        JSON.stringify({ login: user.login, avatar_url: user.avatar_url, name: user.name })
      )
      return user
    }
    return null
  } catch {
    return null
  }
}

export function registerAuthHandlers(): void {
  safeHandle('auth:status', async () => {
    const token = retrieveToken()
    if (!token) {
      return { authenticated: false, user: null }
    }

    const db = getDatabase()
    const cachedUser = db.prepare("SELECT value FROM settings WHERE key = 'auth_user'").get() as
      | { value: string }
      | undefined
    if (cachedUser) {
      return { authenticated: true, user: JSON.parse(cachedUser.value) }
    }

    const user = await fetchGitHubUser(token)
    if (user) {
      return { authenticated: true, user }
    }

    // Token is invalid
    clearToken()
    return { authenticated: false, user: null }
  })

  safeHandle('auth:login', async (event) => {
    console.log('[auth] Login initiated')
    const window = BrowserWindow.fromWebContents(event.sender)

    try {
      console.log('[auth] Requesting device code...')
      const codeResponse = await httpPost(GITHUB_DEVICE_CODE_URL, {
        client_id: GITHUB_CLIENT_ID,
        scope: SCOPES
      })
      console.log('[auth] Device code response:', codeResponse)

      const deviceData = JSON.parse(codeResponse) as DeviceCodeResponse

      // Send user code and verification URL to renderer
      window?.webContents.send('auth:device-code', {
        userCode: deviceData.user_code,
        verificationUri: deviceData.verification_uri
      })

      // Poll for token
      return new Promise<{ success: boolean; user?: GitHubUser; error?: string }>(
        (resolve) => {
          const startTime = Date.now()
          const expiresMs = deviceData.expires_in * 1000

          let currentIntervalMs = (deviceData.interval || 5) * 1000
          console.log(`[auth] Starting poll every ${currentIntervalMs}ms, expires in ${deviceData.expires_in}s`)

          const poll = async (): Promise<void> => {
            const elapsed = Date.now() - startTime
            if (elapsed > expiresMs) {
              console.log('[auth] Device code expired after', elapsed, 'ms')
              pollTimer = null
              resolve({ success: false, error: 'Device code expired' })
              return
            }

            try {
              console.log(`[auth] Polling for access token (interval: ${currentIntervalMs}ms)...`)
              const tokenResponse = await httpPost(GITHUB_ACCESS_TOKEN_URL, {
                client_id: GITHUB_CLIENT_ID,
                device_code: deviceData.device_code,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
              })

              console.log('[auth] Poll response:', tokenResponse)
              const tokenData = JSON.parse(tokenResponse) as TokenResponse & { interval?: number }

              if (tokenData.access_token) {
                console.log('[auth] Access token received, fetching user...')
                pollTimer = null

                storeToken(tokenData.access_token)
                const user = await fetchGitHubUser(tokenData.access_token)
                console.log('[auth] Login complete, user:', user?.login)
                resolve({ success: true, user: user ?? undefined })
                return
              }

              if (tokenData.error === 'slow_down' && tokenData.interval) {
                currentIntervalMs = tokenData.interval * 1000
                console.log(`[auth] Slowing down, new interval: ${currentIntervalMs}ms`)
              } else if (tokenData.error) {
                console.log('[auth] Poll pending:', tokenData.error)
              }
            } catch (err) {
              console.error('[auth] Poll error:', err)
            }

            pollTimer = setTimeout(poll, currentIntervalMs)
          }

          pollTimer = setTimeout(poll, currentIntervalMs)
        }
      )
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Login failed'
      }
    }
  })

  safeHandle('auth:logout', () => {
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    clearToken()
    return true
  })

}
