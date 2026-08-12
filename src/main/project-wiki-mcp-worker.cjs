/* global process, require, URL */

'use strict'

const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')
const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js')

const url = process.env.NEXY_PROJECT_MCP_URL || process.env.NEXY_PROJECT_WIKI_MCP_URL
const token = process.env.NEXY_PROJECT_MCP_TOKEN || process.env.NEXY_PROJECT_WIKI_MCP_TOKEN

if (!url || !token) {
  process.stderr.write('[nexy-project-mcp] connection environment is missing\n')
  process.exit(1)
}

async function main() {
  const client = new Client({ name: 'nexy-project-stdio', version: '1.0.0' }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  await client.connect(transport)

  const server = new Server(
    { name: 'nexy-project', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => client.listTools())
  server.setRequestHandler(CallToolRequestSchema, async (request) => client.callTool({
    name: request.params.name,
    arguments: request.params.arguments,
  }))
  await server.connect(new StdioServerTransport())
}

main().catch((error) => {
  process.stderr.write(`[nexy-project-mcp] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
