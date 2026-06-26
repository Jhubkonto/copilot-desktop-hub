import { readFileSync, writeFileSync, existsSync } from 'fs'
import { exec } from 'child_process'
import { BrowserWindow } from 'electron'
import { getDatabase } from './database'
import { randomUUID } from 'crypto'
import { safeHandle } from './safe-handle'
import { broadcastToMobile, hasMobileClients, isMobileInForeground } from './ws-server'
import { sendApprovalPush } from './fcm-sender'
import { registerApprovalResolver } from './ws-handlers'

export interface ToolDefinition {
  name: string
  description: string
  args: { name: string; type: string; required: boolean }[]
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'fileRead',
    description: 'Read the contents of a file',
    args: [{ name: 'path', type: 'string', required: true }]
  },
  {
    name: 'fileWrite',
    description: 'Write content to a file',
    args: [
      { name: 'path', type: 'string', required: true },
      { name: 'content', type: 'string', required: true }
    ]
  },
  {
    name: 'shellExec',
    description: 'Execute a shell command',
    args: [
      { name: 'command', type: 'string', required: true },
      { name: 'cwd', type: 'string', required: false }
    ]
  },
  {
    name: 'webFetch',
    description: 'Fetch content from a URL',
    args: [
      { name: 'url', type: 'string', required: true },
      { name: 'method', type: 'string', required: false }
    ]
  }
]

async function executeFileRead(args: { path: string }): Promise<string> {
  if (!existsSync(args.path)) {
    throw new Error(`File not found: ${args.path}`)
  }
  const content = readFileSync(args.path, 'utf-8')
  if (content.length > 100000) {
    return content.slice(0, 100000) + '\n\n... (truncated, file too large)'
  }
  return content
}

async function executeFileWrite(args: { path: string; content: string }): Promise<string> {
  writeFileSync(args.path, args.content, 'utf-8')
  return `Successfully wrote ${args.content.length} characters to ${args.path}`
}

async function executeShellExec(args: {
  command: string
  cwd?: string
}): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      args.command,
      {
        cwd: args.cwd || undefined,
        timeout: 30000,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error && !stdout && !stderr) {
          reject(new Error(error.message))
        } else {
          let result = ''
          if (stdout) result += stdout
          if (stderr) result += (result ? '\n--- stderr ---\n' : '') + stderr
          resolve(result || '(no output)')
        }
      }
    )
  })
}

async function executeWebFetch(args: {
  url: string
  method?: string
}): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    const response = await fetch(args.url, {
      method: args.method || 'GET',
      headers: { 'User-Agent': 'Nexy/0.9.0' },
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const text = await response.text()
    const statusLine = `HTTP ${response.status} ${response.statusText}\n\n`
    const truncated = text.length > 50000 ? text.slice(0, 50000) + '\n\n... (truncated)' : text
    return statusLine + truncated
  } finally {
    clearTimeout(timeout)
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; result?: string; error?: string }> {
  try {
    let result: string
    switch (name) {
      case 'fileRead':
        result = await executeFileRead(args as { path: string })
        break
      case 'fileWrite':
        result = await executeFileWrite(args as { path: string; content: string })
        break
      case 'shellExec':
        result = await executeShellExec(args as { command: string; cwd?: string })
        break
      case 'webFetch':
        result = await executeWebFetch(args as { url: string; method?: string })
        break
      default:
        return { success: false, error: `Unknown tool: ${name}` }
    }
    return { success: true, result }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

function getToolPreference(toolName: string): string | null {
  const db = getDatabase()
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(`tool_pref:${toolName}`) as { value: string } | undefined
  return row?.value ?? null
}

function setToolPreference(toolName: string, value: string): void {
  const db = getDatabase()
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    `tool_pref:${toolName}`,
    value
  )
}

const pendingApprovals = new Map<
  string,
  { toolName: string; resolve: (approved: boolean) => void; noRemember?: boolean; onRemember?: (approved: boolean) => void; agentId?: string }
>()

/**
 * Sends a tool approval request to the renderer and waits for the user's response.
 * Pass `noRemember: true` when the approval should not be persisted as a global tool
 * preference (e.g. MCP tools, which have their own per-agent override table).
 * Pass `onRemember` to handle the "Always allow" case with custom persistence logic
 * (e.g. updating an agent's tool approval field instead of writing a global preference).
 * Pass `autoApprove: true` to skip all prompts and resolve immediately (fullAutoApprove mode).
 */
export async function requestApproval(
  webContents: Electron.WebContents,
  toolName: string,
  args: Record<string, unknown>,
  description: string,
  options?: { noRemember?: boolean; onRemember?: (approved: boolean) => void; autoApprove?: boolean; agentId?: string }
): Promise<boolean> {
  if (options?.autoApprove === true) {
    if (!webContents.isDestroyed()) {
      webContents.send('tool:auto-approved', { toolName, args })
    }
    return true
  }
  const requestId = randomUUID()
  webContents.send('tool:request-approval', { requestId, tool: toolName, args, description })
  broadcastToMobile({ event: 'tool:approval-request', data: { requestId, toolName, args, description } })
  if (!isMobileInForeground()) {
    sendApprovalPush(getDatabase(), { requestId, toolName, args, description }).catch(() => {})
  }
  return new Promise<boolean>((resolve) => {
    pendingApprovals.set(requestId, { toolName, resolve, noRemember: options?.noRemember, onRemember: options?.onRemember, agentId: options?.agentId })
    setTimeout(() => {
      if (pendingApprovals.has(requestId)) {
        pendingApprovals.delete(requestId)
        resolve(false)
      }
    }, 60000)
  })
}

export function drainPendingApprovals(agentId: string): void {
  for (const [requestId, pending] of pendingApprovals) {
    if (pending.agentId === agentId) {
      pending.resolve(true)
      pendingApprovals.delete(requestId)
    }
  }
}

export function resolveApprovalFromWs(requestId: string, approved: boolean): boolean {
  const pending = pendingApprovals.get(requestId)
  if (!pending) return false
  pending.resolve(approved)
  pendingApprovals.delete(requestId)
  return true
}

export function registerToolHandlers(): void {
  registerApprovalResolver(resolveApprovalFromWs)
  safeHandle('tool:list', () => TOOL_DEFINITIONS)

  safeHandle(
    'tool:execute',
    async (
      event,
      name: string,
      args: Record<string, unknown>,
      agentToolConfig?: { enabled: boolean; approval: string; instructions: string }
    ) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return { success: false, error: 'No window' }

      const pref = getToolPreference(name)
      if (pref === 'always_deny') {
        return { success: false, error: 'Tool denied by preference' }
      }
      const approvalPolicy = agentToolConfig?.enabled === true && agentToolConfig.approval === 'disabled'
        ? 'always-ask'
        : agentToolConfig?.approval
      if (approvalPolicy === 'disabled') {
        return { success: false, error: 'Tool disabled for this agent' }
      }

      let approved = approvalPolicy === 'auto'
        ? true
        : approvalPolicy === 'always-ask'
          ? false
          : pref === 'always_allow'

      if (!approved) {
        const toolDef = TOOL_DEFINITIONS.find((t) => t.name === name)
        approved = await requestApproval(
          window.webContents,
          name,
          args,
          toolDef?.description || name
        )
      }

      if (!approved) {
        return { success: false, error: 'Tool execution denied by user' }
      }

      return await executeTool(name, args)
    }
  )

  safeHandle(
    'tool:approval-response',
    (_event, requestId: string, approved: boolean, remember: boolean) => {
      const pending = pendingApprovals.get(requestId)
      if (pending) {
        if (remember) {
          if (pending.onRemember) {
            pending.onRemember(approved)
          } else if (!pending.noRemember) {
            setToolPreference(pending.toolName, approved ? 'always_allow' : 'always_deny')
          }
        }
        pending.resolve(approved)
        pendingApprovals.delete(requestId)
      }
      return true
    }
  )

  safeHandle('tool:set-preference', (_event, toolName: string, value: string) => {
    setToolPreference(toolName, value)
    return true
  })

  safeHandle('tool:get-preferences', () => {
    const db = getDatabase()
    const rows = db
      .prepare("SELECT key, value FROM settings WHERE key LIKE 'tool_pref:%'")
      .all() as { key: string; value: string }[]
    const prefs: Record<string, string> = {}
    for (const row of rows) {
      prefs[row.key.replace('tool_pref:', '')] = row.value
    }
    return prefs
  })
}
