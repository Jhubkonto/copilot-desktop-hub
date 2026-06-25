/**
 * Desktop Navigator MCP stdio bridge worker.
 *
 * Spawned by Claude CLI / Codex CLI as their MCP stdio server child process.
 * Receives tool calls over MCP stdio, forwards them to the Nexy main process
 * via an HTTP loopback server (port passed in NEXY_DN_BRIDGE_PORT env var),
 * and returns results back to the CLI.
 */

/* global require, process, Buffer */

'use strict'

const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js')
const http = require('http')

const BRIDGE_PORT = parseInt(process.env.NEXY_DN_BRIDGE_PORT ?? '0', 10)
const BRIDGE_SECRET = process.env.NEXY_DN_BRIDGE_SECRET ?? ''

if (!BRIDGE_PORT) {
  process.stderr.write('[dn-bridge-worker] NEXY_DN_BRIDGE_PORT not set\n')
  process.exit(1)
}

// Tool definitions sent from Nexy via HTTP on startup
let tools = []

async function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: BRIDGE_PORT,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'X-Bridge-Secret': BRIDGE_SECRET,
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk) => { raw += chunk })
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw))
          } catch {
            reject(new Error(`Invalid JSON from bridge: ${raw.slice(0, 200)}`))
          }
        })
      }
    )
    req.on('error', reject)
    req.end(data)
  })
}

async function main() {
  // Fetch tool definitions from Nexy
  try {
    const res = await httpPost('/tools', {})
    tools = Array.isArray(res.tools) ? res.tools : []
  } catch (err) {
    process.stderr.write(`[dn-bridge-worker] failed to fetch tools: ${err.message}\n`)
    process.exit(1)
  }

  const server = new Server(
    { name: 'nexy-desktop-navigator', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema ?? { type: 'object', properties: {}, required: [] },
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const toolName = req.params.name
    const args = req.params.arguments ?? {}

    let result
    try {
      result = await httpPost('/call', { toolName, args })
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Bridge error: ${err.message}` }],
      }
    }

    const content = []
    if (result.result) {
      content.push({ type: 'text', text: result.result })
    }
    if (Array.isArray(result.images)) {
      for (const img of result.images) {
        const comma = img.dataUrl.indexOf(',')
        if (comma !== -1) {
          content.push({
            type: 'image',
            data: img.dataUrl.slice(comma + 1),
            mimeType: img.mimeType,
          })
        }
      }
    }
    if (content.length === 0) {
      content.push({
        type: 'text',
        text: result.success ? '(done)' : `Error: ${result.error ?? 'unknown'}`,
      })
    }

    return { isError: !result.success, content }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  process.stderr.write(`[dn-bridge-worker] fatal: ${err.message}\n`)
  process.exit(1)
})
