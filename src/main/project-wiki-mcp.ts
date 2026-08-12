import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { PROJECT_MCP_TOOL_DEFINITIONS, callProjectMcpTool } from './project-mcp-capabilities'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'

const MCP_PATH = '/mcp'
const MAX_BODY_BYTES = 2 * 1024 * 1024

export interface ProjectWikiMcpConnection {
  projectId: string
  url: string
  token: string
  command: string
  args: string[]
  env: Record<string, string>
}

export interface ProjectWikiMcpStatus {
  projectId: string
  running: boolean
  url: string | null
  stdio: { command: string; args: string[]; env: Record<string, string> } | null
}

interface Session {
  server: Server
  transport: StreamableHTTPServerTransport
}

interface Bridge {
  projectId: string
  token: string
  server: HttpServer
  port: number
  webContents: WebContents
  sessions: Map<string, Session>
}

const bridges = new Map<string, Bridge>()

function workerScriptPath(): string {
  return join(__dirname, 'project-wiki-mcp-worker.cjs')
}

function parseRequestBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ''
    let size = 0
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk)
      if (size > MAX_BODY_BYTES) {
        reject(new Error('MCP request body is too large'))
        req.destroy()
        return
      }
      raw += chunk
    })
    req.on('end', () => {
      if (!raw) { resolve(undefined); return }
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return
  const json = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) })
  res.end(json)
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  return req.headers.authorization === `Bearer ${token}`
}

function createMcpServer(bridge: Bridge): Server {
  const server = new Server(
    { name: 'nexy-project', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: PROJECT_MCP_TOOL_DEFINITIONS }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name
    const args = (request.params.arguments ?? {}) as Record<string, unknown>

    try {
      return await callProjectMcpTool(bridge.projectId, bridge.webContents, toolName, args)
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }
    }
  })

  return server
}

async function handleRequest(bridge: Bridge, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isAuthorized(req, bridge.token)) { sendJson(res, 401, { error: 'Unauthorized' }); return }
  if (req.url !== MCP_PATH) { sendJson(res, 404, { error: 'Not found' }); return }

  let body: unknown
  try { body = req.method === 'POST' ? await parseRequestBody(req) : undefined } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
    return
  }

  const sessionId = typeof req.headers['mcp-session-id'] === 'string' ? req.headers['mcp-session-id'] : undefined
  let session = sessionId ? bridge.sessions.get(sessionId) : undefined

  if (!session) {
    if (req.method !== 'POST' || !body || typeof body !== 'object' || (body as { method?: unknown }).method !== 'initialize') {
      sendJson(res, 400, { error: 'A valid MCP initialize request is required' })
      return
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        bridge.sessions.set(id, { server, transport })
      },
    })
    const server = createMcpServer(bridge)
    session = { server, transport }
    transport.onclose = () => {
      if (transport.sessionId) bridge.sessions.delete(transport.sessionId)
    }
    await server.connect(transport)
  }

  try {
    await session.transport.handleRequest(req, res, body)
  } catch (error) {
    if (!res.headersSent) sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

export async function startProjectWikiMcpBridge(projectId: string, webContents: WebContents): Promise<ProjectWikiMcpConnection> {
  const existing = bridges.get(projectId)
  if (existing && !existing.webContents.isDestroyed()) return connectionFor(existing)
  if (existing) await stopProjectWikiMcpBridge(projectId)

  const db = getDatabase()
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId) as { id: string } | undefined
  if (!project) throw new Error('Project not found')

  const token = randomBytes(24).toString('hex')
  const bridge = {} as Bridge
  const server = createServer((req, res) => {
    void handleRequest(bridge, req, res).catch((error) => {
      if (!res.headersSent) sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    })
  })
  bridge.projectId = projectId
  bridge.token = token
  bridge.server = server
  bridge.port = 0
  bridge.webContents = webContents
  bridge.sessions = new Map()

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      bridge.port = (server.address() as { port: number }).port
      resolve()
    })
  })
  bridges.set(projectId, bridge)
  return connectionFor(bridge)
}

function connectionFor(bridge: Bridge): ProjectWikiMcpConnection {
  return {
    projectId: bridge.projectId,
    url: `http://127.0.0.1:${bridge.port}${MCP_PATH}`,
    token: bridge.token,
    command: process.execPath,
    args: [workerScriptPath()],
    env: {
      NEXY_PROJECT_MCP_URL: `http://127.0.0.1:${bridge.port}${MCP_PATH}`,
      NEXY_PROJECT_MCP_TOKEN: bridge.token,
      // Kept for configurations copied by older Nexy versions.
      NEXY_PROJECT_WIKI_MCP_URL: `http://127.0.0.1:${bridge.port}${MCP_PATH}`,
      NEXY_PROJECT_WIKI_MCP_TOKEN: bridge.token,
    },
  }
}

export async function stopProjectWikiMcpBridge(projectId: string): Promise<boolean> {
  const bridge = bridges.get(projectId)
  if (!bridge) return false
  bridges.delete(projectId)
  for (const session of bridge.sessions.values()) await session.transport.close().catch(() => {})
  bridge.sessions.clear()
  await new Promise<void>((resolve) => bridge.server.close(() => resolve()))
  return true
}

export function getProjectWikiMcpStatus(projectId: string): ProjectWikiMcpStatus {
  const bridge = bridges.get(projectId)
  if (!bridge) return { projectId, running: false, url: null, stdio: null }
  const connection = connectionFor(bridge)
  return { projectId, running: true, url: connection.url, stdio: { command: connection.command, args: connection.args, env: connection.env } }
}

export function registerProjectWikiMcpHandlers(): void {
  safeHandle('wiki:mcp-start', async (event, projectId: string) => startProjectWikiMcpBridge(projectId, event.sender))
  safeHandle('wiki:mcp-stop', async (_event, projectId: string) => stopProjectWikiMcpBridge(projectId))
  safeHandle('wiki:mcp-status', (_event, projectId: string) => getProjectWikiMcpStatus(projectId))
}

export async function stopAllProjectWikiMcpBridges(): Promise<void> {
  for (const projectId of [...bridges.keys()]) await stopProjectWikiMcpBridge(projectId)
}
