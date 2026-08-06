import { createServer as createHttpsServer, type Server as HttpsServer } from 'https'
import { networkInterfaces } from 'os'
import { randomBytes, X509Certificate } from 'crypto'
import { WebSocketServer, WebSocket } from 'ws'
import type { AddressInfo } from 'net'
import QRCode from 'qrcode'
import selfsigned from 'selfsigned'
import { app, powerSaveBlocker } from 'electron'
import Bonjour from 'bonjour-service'
import { getDatabase } from './database'
import { getVoiceCapabilities } from './voice-rollout'
import { isFeedRunning, getFeedLanUrl } from './local-feed-server'
import { debugLog } from './debug-mode'
import type { ConnectedAndroidDevice } from '../shared/types'

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
let httpServer: HttpsServer | null = null
let currentPort: number | null = null
let currentToken: string | null = null
let currentCertFingerprint: string | null = null
const connectedClients = new Set<WebSocket>()
const clientDeviceInfo = new Map<WebSocket, ConnectedAndroidDevice>()
// Tracks whether each client answered the previous heartbeat ping. A dropped Wi-Fi/mobile
// connection often never sends a TCP FIN, so without this the socket looks "connected"
// forever even though nothing sent to it will ever arrive — the desktop would keep it in
// connectedClients, hold the wake lock, and never let the phone's own reconnect logic kick in.
const clientAlive = new Map<WebSocket, boolean>()
let commandHandler: CommandHandler | null = null
let mobileInForeground = false
const EXTERNAL_WSS_URL_SETTING = 'ws_external_url'
let wakeLockId: number | null = null
let pingInterval: ReturnType<typeof setInterval> | null = null
let ipPollInterval: ReturnType<typeof setInterval> | null = null
let lastKnownIp: string | null = null
let lastKnownTailscaleIp: string | null = null
let lastKnownAllIps: string = ''
let onIpChange: ((newUrl: string) => void) | null = null
let bonjourInstance: Bonjour | null = null
let mdnsService: ReturnType<Bonjour['publish']> | null = null
let onClientCountChange: ((count: number) => void) | null = null

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

// Returns a sorted, joined snapshot of all non-internal IPv4 addresses.
// Used to detect any interface change (LAN, WireGuard, Tailscale, etc.) quickly.
function getAllIpSnapshot(): string {
  const ifaces = networkInterfaces()
  const addrs: string[] = []
  for (const iface of Object.values(ifaces)) {
    if (!iface) continue
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) addrs.push(info.address)
    }
  }
  return addrs.sort().join(',')
}

// Detect the Tailscale interface by name (ts0 on Linux/Mac, "Tailscale" on Windows)
// and return its IPv4 address, or null if Tailscale is not active.
export function getTailscaleIp(): string | null {
  const ifaces = networkInterfaces()
  for (const [name, iface] of Object.entries(ifaces)) {
    if (!iface || !/tailscale|ts0|utun/i.test(name)) continue
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) return info.address
    }
  }
  return null
}

function getMacAndBroadcast(boundIp: string): { macAddress: string | null; broadcastAddress: string | null } {
  const ifaces = networkInterfaces()
  for (const iface of Object.values(ifaces)) {
    if (!iface) continue
    for (const info of iface) {
      if (info.family === 'IPv4' && info.address === boundIp && info.mac && info.cidr) {
        const prefixLen = parseInt(info.cidr.split('/')[1] ?? '24', 10)
        const ipParts = info.address.split('.').map(Number)
        const maskParts = [0, 0, 0, 0].map((_, i) => {
          const bits = Math.max(0, Math.min(8, prefixLen - i * 8))
          return 0xff & (0xff << (8 - bits))
        })
        const broadcastParts = ipParts.map((b, i) => (b & maskParts[i]!) | (~maskParts[i]! & 0xff))
        return {
          macAddress: info.mac,
          broadcastAddress: broadcastParts.join('.'),
        }
      }
    }
  }
  return { macAddress: null, broadcastAddress: null }
}

function getOrCreateToken(): string {
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ws_token'").get() as { value: string } | undefined
  if (row?.value) return row.value
  const token = randomBytes(24).toString('hex')
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ws_token', ?)").run(token)
  return token
}

async function getOrCreateTlsCert(): Promise<{ cert: string; key: string }> {
  const db = getDatabase()
  const certRow = db.prepare("SELECT value FROM settings WHERE key = 'ws_tls_cert'").get() as { value: string } | undefined
  const keyRow  = db.prepare("SELECT value FROM settings WHERE key = 'ws_tls_key'").get()  as { value: string } | undefined
  if (certRow?.value && keyRow?.value) return { cert: certRow.value, key: keyRow.value }
  const notAfterDate = new Date(Date.now() + 10 * 365.25 * 24 * 3600 * 1000)
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'nexy-mobile' }], {
    notAfterDate, keySize: 2048, algorithm: 'sha256',
  })
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ws_tls_cert', ?)").run(pems.cert)
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ws_tls_key', ?)") .run(pems.private)
  return { cert: pems.cert, key: pems.private }
}

function computeFingerprint(certPem: string): string {
  return new X509Certificate(certPem).fingerprint256.replace(/:/g, '').toLowerCase()
}

export function hasMobileClients(): boolean {
  return connectedClients.size > 0
}

export function isMobileInForeground(): boolean {
  return mobileInForeground
}

export function setMobileInForeground(inForeground: boolean): void {
  mobileInForeground = inForeground
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
    tailscaleIp: getTailscaleIp(),
    pairingUrl,
    externalUrl: getExternalWssUrl(),
    secure: pairingUrl?.startsWith('wss://') ?? false,
    certFingerprint: currentCertFingerprint,
    connectedClients: connectedClients.size,
    devices: [...connectedClients].map((client) => clientDeviceInfo.get(client)).filter((device): device is ConnectedAndroidDevice => device !== undefined),
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

function isWakelockEnabled(): boolean {
  try {
    const db = getDatabase()
    const row = db.prepare("SELECT value FROM settings WHERE key = 'ws_wakelock_enabled'").get() as { value: string } | undefined
    return row?.value !== 'false'
  } catch {
    return true
  }
}

function acquireWakeLock(): void {
  if (wakeLockId !== null || !isWakelockEnabled()) return
  wakeLockId = powerSaveBlocker.start('prevent-app-suspension')
}

function releaseWakeLock(): void {
  if (wakeLockId === null) return
  powerSaveBlocker.stop(wakeLockId)
  wakeLockId = null
}

function getExternalWssUrl(): string | null {
  const db = getDatabase()
  // Try new profiles setting first
  const profilesRow = db.prepare("SELECT value FROM settings WHERE key = 'ws_url_profiles'").get() as { value: string } | undefined
  if (profilesRow?.value) {
    try {
      const profiles = JSON.parse(profilesRow.value) as { url: string; active: boolean }[]
      const active = profiles.find((p) => p.active)
      if (active?.url?.trim()) return active.url.trim()
    } catch { /* fall through */ }
  }
  // Legacy single-URL fallback
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(EXTERNAL_WSS_URL_SETTING) as { value: string } | undefined
  return row?.value?.trim() || null
}

function getPairingUrl(): string | null {
  if (!currentPort || !currentToken) return null
  const external = normalizeExternalWssUrl(getExternalWssUrl(), currentToken)
  if (external) return external
  const fp = currentCertFingerprint ? `&certFP=${currentCertFingerprint}` : ''
  return `wss://${getLocalIp()}:${currentPort}?token=${currentToken}${fp}`
}

// Returns all URLs that should be tried in order: LAN first, Tailscale second.
// Manual external profiles override auto-detection and return a single URL.
function getPairingUrls(): string[] | null {
  if (!currentPort || !currentToken) return null
  const external = normalizeExternalWssUrl(getExternalWssUrl(), currentToken)
  if (external) return [external]
  const fp = currentCertFingerprint ? `&certFP=${currentCertFingerprint}` : ''
  const lanUrl = `wss://${getLocalIp()}:${currentPort}?token=${currentToken}${fp}`
  const tsIp = getTailscaleIp()
  const tsUrl = tsIp ? `wss://${tsIp}:${currentPort}?token=${currentToken}${fp}` : null
  return tsUrl ? [lanUrl, tsUrl] : [lanUrl]
}

// v1 QR payload: JSON with urls array so Android can race-connect.
// Falls back to the bare URL string when only one URL is available,
// keeping the payload small and compatible with older scanners.
function getPairingQrString(): string | null {
  const urls = getPairingUrls()
  if (!urls || urls.length === 0) return null
  if (urls.length === 1) return urls[0]!
  return JSON.stringify({ v: 1, urls })
}

export function getCurrentPairingUrl(): string | null {
  return getPairingUrl()
}

export async function getQrDataUrl(): Promise<string | null> {
  const payload = getPairingQrString()
  if (!payload) return null
  return QRCode.toDataURL(payload, { width: 240, margin: 2 })
}

export function setWsCommandHandler(handler: CommandHandler): void {
  commandHandler = handler
}

export function setIpChangeCallback(cb: (newPairingUrl: string) => void): void {
  onIpChange = cb
}

export function setClientCountChangeCallback(cb: (count: number) => void): void {
  onClientCountChange = cb
}

export function getMobileClientCount(): number {
  return connectedClients.size
}

export function getMdnsName(): string {
  return 'nexy-desktop.local'
}

export async function autoStartWsServerIfEnabled(): Promise<void> {
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ws_enabled'").get() as { value: string } | undefined
  if (row?.value === 'true') {
    await startWsServer().catch(() => {})
  }
}

export async function startWsServer(): Promise<{ port: number; token: string }> {
  if (wss) return { port: currentPort!, token: currentToken! }

  currentToken = getOrCreateToken()
  const { cert, key } = await getOrCreateTlsCert()
  currentCertFingerprint = computeFingerprint(cert)
  httpServer = createHttpsServer({ key, cert })
  wss = new WebSocketServer({ server: httpServer })

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.searchParams.get('token') !== currentToken) {
      debugLog('ws', `connection rejected: invalid token from ${req.socket.remoteAddress}`)
      ws.close(4001, 'Unauthorized')
      return
    }
    const connectionId = randomBytes(16).toString('hex')

    connectedClients.add(ws)
    clientAlive.set(ws, true)
    ws.on('pong', () => clientAlive.set(ws, true))
    if (connectedClients.size === 1) acquireWakeLock()
    onClientCountChange?.(connectedClients.size)
    debugLog('ws', `client connected: ${req.socket.remoteAddress} total=${connectedClients.size}`)
    const localIp = getLocalIp()
    const tsIp = getTailscaleIp()
    const feedUrl = isFeedRunning() ? getFeedLanUrl(localIp) : null
    const feedUrls = isFeedRunning()
      ? [getFeedLanUrl(localIp), ...(tsIp ? [getFeedLanUrl(tsIp)] : [])]
      : null
    const { macAddress, broadcastAddress } = getMacAndBroadcast(localIp)
    ws.send(JSON.stringify({
      event: 'connected',
      data: {
        version: app.getVersion(),
        feedUrl,
        feedUrls,
        macAddress,
        broadcastAddress,
        mDnsName: getMdnsName(),
        isPackaged: app.isPackaged,
        voiceCapabilities: getVoiceCapabilities(getDatabase()),
      },
    }))

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as WsCommand
        if (msg.token !== currentToken) { ws.close(4001, 'Unauthorized'); return }
        if (msg.command === 'sync:hello' && typeof msg.data?.deviceId === 'string') {
          const versionName = typeof msg.data.appVersion === 'string' && msg.data.appVersion.trim() ? msg.data.appVersion : null
          const rawVersionCode = msg.data.appVersionCode
          const versionCode = typeof rawVersionCode === 'number' && Number.isFinite(rawVersionCode) ? rawVersionCode : null
          const deviceName = typeof msg.data.deviceName === 'string' && msg.data.deviceName.trim() ? msg.data.deviceName : null
          clientDeviceInfo.set(ws, { deviceId: msg.data.deviceId, deviceName, versionName, versionCode })
          onClientCountChange?.(connectedClients.size)
        }
        commandHandler?.(msg.command, { ...(msg.data ?? {}), __connectionId: connectionId }, (event) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event))
        })
      } catch { /* ignore malformed */ }
    })

    ws.on('close', (code, reason) => {
      commandHandler?.('internal:client-disconnected', { __connectionId: connectionId }, () => {})
      connectedClients.delete(ws)
      clientDeviceInfo.delete(ws)
      clientAlive.delete(ws)
      if (connectedClients.size === 0) { releaseWakeLock(); mobileInForeground = false }
      onClientCountChange?.(connectedClients.size)
      debugLog('ws', `client disconnected: code=${code} reason=${reason.toString() || 'none'} remaining=${connectedClients.size}`)
    })
    ws.on('error', (err) => {
      commandHandler?.('internal:client-disconnected', { __connectionId: connectionId }, () => {})
      connectedClients.delete(ws)
      clientDeviceInfo.delete(ws)
      clientAlive.delete(ws)
      if (connectedClients.size === 0) { releaseWakeLock(); mobileInForeground = false }
      onClientCountChange?.(connectedClients.size)
      debugLog('ws', `client error: ${err.message} remaining=${connectedClients.size}`)
    })
  })

  const db = getDatabase()
  const FIXED_PORT = 16717

  return new Promise((resolve, reject) => {
    httpServer!.listen(FIXED_PORT, '0.0.0.0', () => {
      currentPort = (httpServer!.address() as AddressInfo).port
      debugLog('ws', `server started: port=${currentPort} ip=${getLocalIp()} tailscale=${getTailscaleIp() ?? 'none'}`)
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ws_port', ?)").run(String(currentPort))
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ws_enabled', 'true')").run()
      pingInterval = setInterval(() => {
        for (const client of connectedClients) {
          if (client.readyState !== WebSocket.OPEN) continue
          if (clientAlive.get(client) === false) {
            debugLog('ws', 'client missed heartbeat pong — terminating stale connection')
            client.terminate()
            continue
          }
          clientAlive.set(client, false)
          client.ping()
        }
      }, 30_000)

      lastKnownIp = getLocalIp()
      lastKnownTailscaleIp = getTailscaleIp()
      lastKnownAllIps = getAllIpSnapshot()
      ipPollInterval = setInterval(() => {
        const newIp = getLocalIp()
        const newTsIp = getTailscaleIp()
        const newAllIps = getAllIpSnapshot()
        if (newIp !== lastKnownIp || newTsIp !== lastKnownTailscaleIp || newAllIps !== lastKnownAllIps) {
          lastKnownIp = newIp
          lastKnownTailscaleIp = newTsIp
          lastKnownAllIps = newAllIps
          const newUrl = getPairingUrl()
          debugLog('ws', `IP changed: lan=${newIp} tailscale=${newTsIp ?? 'none'} newUrl=${newUrl ?? 'none'}`)
          if (newUrl) onIpChange?.(newUrl)
        }
      }, 5_000)

      try {
        bonjourInstance = new Bonjour()
        mdnsService = bonjourInstance.publish({
          name: 'Nexy Desktop',
          type: 'nexy',
          protocol: 'tcp',
          port: currentPort!,
          txt: { token: currentToken! },
        })
      } catch {
        // mDNS is best-effort; don't fail startup if it errors
      }

      resolve({ port: currentPort, token: currentToken! })
    })

    httpServer!.on('error', (err) => {
      debugLog('ws', `server start failed: ${err.message}`)
      console.error('[ws] server start failed:', err)
      wss = null
      httpServer = null
      reject(err)
    })
  })
}

export function stopWsServer(): void {
  if (pingInterval !== null) { clearInterval(pingInterval); pingInterval = null }
  if (ipPollInterval !== null) { clearInterval(ipPollInterval); ipPollInterval = null }
  try { mdnsService?.stop(); mdnsService = null } catch { /* best-effort */ }
  try { bonjourInstance?.destroy(); bonjourInstance = null } catch { /* best-effort */ }
  for (const client of connectedClients) client.close(1001, 'Server stopping')
  connectedClients.clear()
  clientDeviceInfo.clear()
  clientAlive.clear()
  mobileInForeground = false
  releaseWakeLock()
  wss?.close()
  httpServer?.close()
  wss = null
  httpServer = null
  currentPort = null
  currentCertFingerprint = null
  lastKnownTailscaleIp = null
  lastKnownAllIps = ''
  try {
    const db = getDatabase()
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ws_enabled', 'false')").run()
  } catch { /* best-effort */ }
}

export async function startWsServerIfNeeded(): Promise<void> {
  if (wss !== null) return
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ws_enabled'").get() as { value: string } | undefined
  if (row?.value === 'true') {
    await startWsServer().catch((err) => {
      debugLog('ws', `resume from sleep: restart failed — ${err instanceof Error ? err.message : String(err)}`)
      console.warn('[ws] resumed from sleep, restart failed:', err)
    })
    debugLog('ws', 'resume from sleep: server listening')
  }
}

export function getWakelockEnabled(): boolean {
  return isWakelockEnabled()
}

export function setWakelockEnabled(enabled: boolean): void {
  const db = getDatabase()
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ws_wakelock_enabled', ?)").run(enabled ? 'true' : 'false')
  if (!enabled && wakeLockId !== null) {
    releaseWakeLock()
  } else if (enabled && connectedClients.size > 0 && wakeLockId === null) {
    acquireWakeLock()
  }
}

export function regenerateToken(): string {
  const token = randomBytes(24).toString('hex')
  const db = getDatabase()
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ws_token', ?)").run(token)
  currentToken = token
  for (const client of connectedClients) client.close(4002, 'Token regenerated — re-pair required')
  connectedClients.clear()
  clientAlive.clear()
  return token
}
