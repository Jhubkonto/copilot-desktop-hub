import http from 'http'
import { createReadStream, existsSync, statSync } from 'fs'
import path from 'path'
import type { AddressInfo } from 'net'

let server: http.Server | null = null
let _port = 0
let _feedDir = ''

// Bind to all interfaces by default: the Android companion downloads OTA APKs
// over LAN, and the desktop updater reaches the same server via 127.0.0.1.
export function startFeedServer(feedDir: string, bindAddress = '0.0.0.0'): Promise<number> {
  return new Promise((resolve, reject) => {
    stopFeedServer()
    _feedDir = feedDir

    const s = http.createServer((req, res) => {
      const urlPath = (req.url ?? '/').split('?')[0].replace(/^\/+/, '')
      if (!urlPath || urlPath.includes('..')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not found')
        return
      }
      const filePath = path.join(_feedDir, urlPath)
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not found')
        return
      }
      const ext = path.extname(filePath).toLowerCase()
      const contentType =
        ext === '.yml' || ext === '.yaml' ? 'text/yaml' :
        ext === '.json' ? 'application/json' :
        'application/octet-stream'
      res.writeHead(200, { 'Content-Type': contentType })
      createReadStream(filePath).pipe(res)
    })

    s.on('error', reject)
    s.listen(0, bindAddress, () => {
      server = s
      _port = (s.address() as AddressInfo).port
      resolve(_port)
    })
  })
}

export function stopFeedServer(): void {
  if (server) {
    server.close()
    server = null
    _port = 0
    _feedDir = ''
  }
}

export function getFeedUrl(): string {
  return _port > 0 ? `http://127.0.0.1:${_port}` : ''
}

export function getFeedPort(): number { return _port }
export function isFeedRunning(): boolean { return server !== null }
export function getFeedDir(): string { return _feedDir }
export function getFeedLanUrl(lanIp: string): string {
  return _port > 0 ? `http://${lanIp}:${_port}` : ''
}
