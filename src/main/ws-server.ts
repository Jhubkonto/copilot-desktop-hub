import { createServer, type Server as HttpServer } from 'http'
import { networkInterfaces } from 'os'
import { randomBytes } from 'crypto'
import { WebSocketServer, WebSocket } from 'ws'
import type { AddressInfo } from 'net'
import QRCode from 'qrcode'
import { getDatabase } from './database'
import { isFeedRunning, getFeedLanUrl } from './local-feed-server'

export interface WsPushEvent {
  event: string
  data?: unknown
}

export interface WsCommand {
  token: string
  command: string
  data?: Record<string, unknown>
}

export type WsReply = (event: WsPushEvent) => void
type CommandHandler = (command: string, data: Record<string, unknown>, reply: WsReply) => void

let wss: WebSocketServer | null = null
let httpServer: HttpServer | null = null
let currentPort: number | null = null
let currentToken: string | null = null
const connectedClients = new Set<WebSocket>()
let commandHandler: CommandHandler | null = null
const EXTERNAL_WSS_URL_SETTING = 'ws_external_url'

function ipScore(addr: string): number {
  if (addr.startsWith('192.168.')) return 0  // WiFi / home LAN — best
  if (addr.startsWith('10.')) return 1        // corporate LAN
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return 2  // RFC-1918 (incl. WSL2)
  return 3                                    // VPN, Tailscale, etc.
}

function getLocalIp(): string {
  const ifaces = networkInterfaces()
  const candidates: string[] = []
  for (const iface of Object.values(ifaces)) {
    if (!iface) continue
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) candidates.push(info.address)
    }
  }
  candidates.sort((a, b) => ipScore(a) - ipScore(b))
  return candidates[0] ?? '127.0.0.1'
}

function getOrCreateToken(): string {
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ws_token'").get() as { value: string } | undefined
  if (row?.value) return row.value
  const token = randomBytes(24).toString('hex')
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ws_token', ?)").run(token)
  return token
}

export function broadcastToMobile(event: WsPushEvent): void {
  if (!wss || connectedClients.size === 0) return
  const msg = JSON.stringify(event)
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg)
  }
}

export function getWsStatus() {
  const pairingUrl = getPairingUrl()
  return {
    enabled: wss !== null,
    port: currentPort,
    token: currentToken,
    localIp: getLocalIp(),
    pairingUrl,
    externalUrl: getExternalWssUrl(),
    secure: pairingUrl?.startsWith('wss://') ?? false,
    connectedClients: connectedClients.size,
  }
}

export function normalizeExternalWssUrl(rawValue: string | null | undefined, token: string): string | null {
  const raw = rawValue?.trim()
  if (!raw) return null
  const parsed = (() => {
    try {
      return new URL(raw)
    } catch {
      return null
    }
  })()
  if (!parsed || parsed.protocol !== 'wss:' || !parsed.host) return null
  parsed.searchParams.set('token', token)
  return parsed.toString()
}

function getExternalWssUrl(): string | null {
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(EXTERNAL_WSS_URL_SETTING) as { value: string } | undefined
  return row?.value?.trim() || null
}

function getPairingUrl(): string | null {
  if (!currentPort || !currentToken) return null
  return normalizeExternalWssUrl(getExternalWssUrl(), currentToken) ?? `ws://${getLocalIp()}:${currentPort}?token=${currentToken}`
}

export async function getQrDataUrl(): Promise<string | null> {
  const url = getPairingUrl()
  if (!url) return null
  return QRCode.toDataURL(url, { width: 240, margin: 2 })
}

export function setWsCommandHandler(handler: CommandHandler): void {
  commandHandler = handler
}

export function startWsServer(): Promise<{ port: number; token: string }> {
  return new Promise((resolve, reject) => {
    if (wss) {
      resolve({ port: currentPort!, token: currentToken! })
      return
    }

    currentToken = getOrCreateToken()
    httpServer = createServer()
    wss = new WebSocketServer({ server: httpServer })

    wss.on('connection', (ws, req) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.searchParams.get('token') !== currentToken) {
        ws.close(4001, 'Unauthorized')
        return
      }

      connectedClients.add(ws)
      const feedUrl = isFeedRunning() ? getFeedLanUrl(getLocalIp()) : null
      ws.send(JSON.stringify({ event: 'connected', data: { version: '0.9.0', feedUrl } }))

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as WsCommand
          if (msg.token !== currentToken) { ws.close(4001, 'Unauthorized'); return }
          commandHandler?.(msg.command, msg.data ?? {}, (event) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event))
          })
        } catch { /* ignore malformed */ }
      })

      ws.on('close', () => connectedClients.delete(ws))
      ws.on('error', () => connectedClients.delete(ws))
    })

    httpServer.listen(0, '0.0.0.0', () => {
      currentPort = (httpServer!.address() as AddressInfo).port
      const db = getDatabase()
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ws_port', ?)").run(String(currentPort))
      resolve({ port: currentPort, token: currentToken! })
    })

    httpServer.on('error', (err) => {
      wss = null
      httpServer = null
      reject(err)
    })
  })
}

export function stopWsServer(): void {
  for (const client of connectedClients) client.close(1001, 'Server stopping')
  connectedClients.clear()
  wss?.close()
  httpServer?.close()
  wss = null
  httpServer = null
  currentPort = null
}

export function regenerateToken(): string {
  const token = randomBytes(24).toString('hex')
  const db = getDatabase()
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ws_token', ?)").run(token)
  currentToken = token
  for (const client of connectedClients) client.close(4002, 'Token regenerated — re-pair required')
  connectedClients.clear()
  return token
}
