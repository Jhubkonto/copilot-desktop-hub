import https from 'https'
import http from 'http'
import { retrieveToken } from './auth'
import { BrowserWindow } from 'electron'

interface CopilotToken {
  token: string
  expires_at: number
}

let cachedToken: CopilotToken | null = null
let activeRequest: http.ClientRequest | null = null

function httpPostJson(
  url: string,
  headers: Record<string, string>,
  body?: string
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          ...headers,
          ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {})
        }
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve({ status: res.statusCode || 0, data }))
      }
    )
    req.setTimeout(30000, () => req.destroy(new Error('Request timed out')))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function httpGetJson(
  url: string,
  headers: Record<string, string>
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'GET',
        headers
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve({ status: res.statusCode || 0, data }))
      }
    )
    req.setTimeout(30000, () => req.destroy(new Error('Request timed out')))
    req.on('error', reject)
    req.end()
  })
}

async function exchangeToken(githubToken: string): Promise<CopilotToken> {
  const { status, data } = await httpGetJson(
    'https://api.github.com/copilot_internal/v2/token',
    {
      Authorization: `token ${githubToken}`,
      'editor-version': 'vscode/1.95.0',
      'editor-plugin-version': 'copilot/1.200.0',
      'User-Agent': 'GithubCopilot/1.200.0',
      Accept: 'application/json'
    }
  )

  if (status !== 200) {
    let message = `Token exchange failed (HTTP ${status})`
    try {
      const parsed = JSON.parse(data)
      if (parsed.message) message = parsed.message
    } catch { /* use default message */ }
    console.error('[copilot-api] Token exchange error:', status, data)
    throw new Error(message)
  }

  const parsed = JSON.parse(data)
  if (!parsed.token) {
    throw new Error('No token in Copilot response — do you have an active Copilot subscription?')
  }

  return {
    token: parsed.token,
    expires_at: parsed.expires_at
  }
}

export async function getCopilotToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && cachedToken.expires_at > Date.now() / 1000 + 60) {
    return cachedToken.token
  }

  const githubToken = retrieveToken()
  if (!githubToken) {
    throw new Error('Not authenticated — sign in with GitHub first')
  }

  cachedToken = await exchangeToken(githubToken)
  return cachedToken.token
}

export async function sendCopilotChatMessage(
  window: BrowserWindow,
  messages: { role: string; content: string }[],
  onChunk: (chunk: string) => void
): Promise<string> {
  const token = await getCopilotToken()

  const body = JSON.stringify({
    model: 'gpt-4o',
    messages,
    stream: true,
    max_tokens: 4096
  })

  return new Promise((resolve, reject) => {
    const urlObj = new URL('https://api.githubcopilot.com/chat/completions')
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'editor-version': 'vscode/1.95.0',
          'editor-plugin-version': 'copilot/1.200.0',
          'User-Agent': 'GithubCopilot/1.200.0',
          'Content-Length': String(Buffer.byteLength(body)),
          Accept: 'text/event-stream'
        }
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errData = ''
          res.on('data', (chunk) => (errData += chunk))
          res.on('end', () => {
            activeRequest = null
            let message = `Copilot API error (HTTP ${res.statusCode})`
            try {
              const parsed = JSON.parse(errData)
              if (parsed.error?.message) message = parsed.error.message
              else if (parsed.message) message = parsed.message
            } catch { /* use default */ }
            // Invalidate cached token on auth errors
            if (res.statusCode === 401 || res.statusCode === 403) {
              cachedToken = null
            }
            reject(new Error(message))
          })
          return
        }

        let fullContent = ''
        let buffer = ''

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data: ')) continue
            const data = trimmed.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              const delta = parsed.choices?.[0]?.delta?.content
              if (delta) {
                fullContent += delta
                onChunk(delta)
              }
            } catch {
              // Skip malformed chunks
            }
          }
        })

        res.on('end', () => {
          activeRequest = null
          resolve(fullContent)
        })

        res.on('error', (err) => {
          activeRequest = null
          reject(err)
        })
      }
    )

    req.on('error', (err) => {
      activeRequest = null
      reject(err)
    })

    activeRequest = req
    req.write(body)
    req.end()
  })
}

export function abortCopilotStream(): void {
  if (activeRequest) {
    activeRequest.destroy()
    activeRequest = null
  }
}

export function clearCopilotTokenCache(): void {
  cachedToken = null
}
