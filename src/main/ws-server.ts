import { createServer, type Server as HttpServer } from 'http'
import { networkInterfaces } from 'os'
import { randomBytes } from 'crypto'
import { WebSocketServer, WebSocket } from 'ws'
import type { AddressInfo } from 'net'
import QRCode from 'qrcode'
import { getDatabase } from './database'

export interface WsPushEvent {
  event: string
  data?: unknown
}

export interface WsCommand {
  token: string
  command: string
  data?: Record<string, unknown>
}

type CommandHandler = (command: string, data: Record<string, unknown>) => void

let wss: WebSocketServer | null = null
let httpServer: HttpServer | null = null
let currentPort: number | null = null
let currentToken: string | null = null
const connectedClients = new Set<WebSocket>()
let commandHandler: CommandHandler | null = null

function getLocalIp(): string {
  const ifaces = networkInterfaces()
  for (const iface of Object.values(ifaces)) {
    if (!iface) continue
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) return info.address
    }
  }
  return '127.0.0.1'
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
  return {
    enabled: wss !== null,
    port: currentPort,
    token: currentToken,
    localIp: getLocalIp(),
    connectedClients: connectedClients.size,
  }
}

export async function getQrDataUrl(): Promise<string | null> {
  if (!currentPort || !currentToken) return null
  const url = `ws://${getLocalIp()}:${currentPort}?token=${currentToken}`
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
      ws.send(JSON.stringify({ event: 'connected', data: { version: '0.9.0' } }))

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as WsCommand
          if (msg.token !== currentToken) { ws.close(4001, 'Unauthorized'); return }
          commandHandler?.(msg.command, msg.data ?? {})
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
