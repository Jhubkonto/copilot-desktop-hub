'use strict'
/* global require, process, Buffer */
const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js')
const http = require('http')

const port = Number(process.env.NEXY_SKILL_BRIDGE_PORT || 0)
const secret = process.env.NEXY_SKILL_BRIDGE_SECRET || ''

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: {
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'X-Bridge-Secret': secret,
    } }, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch { reject(new Error('Invalid bridge response')) }
      })
    })
    req.on('error', reject)
    req.end(data)
  })
}

async function main() {
  const listed = await post('/tools', {})
  const server = new Server({ name: 'nexy-skill', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listed.tools || [] }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await post('/call', { toolName: req.params.name, args: req.params.arguments || {} })
      return { isError: !result.success, content: [{ type: 'text', text: result.result || result.error || '(no result)' }] }
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: `Bridge error: ${error.message}` }] }
    }
  })
  await server.connect(new StdioServerTransport())
}

main().catch((error) => { process.stderr.write(`[nexy-skill] ${error.message}\n`); process.exit(1) })
