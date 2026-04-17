import { readFileSync, writeFileSync, existsSync } from 'fs'
import { exec } from 'child_process'
import { ipcMain, BrowserWindow } from 'electron'
import { getDatabase } from './database'
import { randomUUID } from 'crypto'

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
  const response = await fetch(args.url, {
    method: args.method || 'GET',
    headers: { 'User-Agent': 'CopilotDesktopHub/0.1.0' }
  })
  const text = await response.text()
  const statusLine = `HTTP ${response.status} ${response.statusText}\n\n`
  const truncated = text.length > 50000 ? text.slice(0, 50000) + '\n\n... (truncated)' : text
  return statusLine + truncated
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
  { toolName: string; resolve: (approved: boolean) => void }
>()

export function registerToolHandlers(): void {
  ipcMain.handle('tool:list', () => TOOL_DEFINITIONS)

  ipcMain.handle(
    'tool:execute',
    async (event, name: string, args: Record<string, unknown>) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return { success: false, error: 'No window' }

      // Check stored preference
      const pref = getToolPreference(name)
      if (pref === 'always_deny') {
        return { success: false, error: 'Tool denied by preference' }
      }

      let approved = pref === 'always_allow'

      if (!approved) {
        const requestId = randomUUID()
        const toolDef = TOOL_DEFINITIONS.find((t) => t.name === name)

        window.webContents.send('tool:request-approval', {
          requestId,
          tool: name,
          args,
          description: toolDef?.description || name
        })

        approved = await new Promise<boolean>((resolve) => {
          pendingApprovals.set(requestId, { toolName: name, resolve })
          setTimeout(() => {
            if (pendingApprovals.has(requestId)) {
              pendingApprovals.delete(requestId)
              resolve(false)
            }
          }, 60000)
        })
      }

      if (!approved) {
        return { success: false, error: 'Tool execution denied by user' }
      }

      return await executeTool(name, args)
    }
  )

  ipcMain.handle(
    'tool:approval-response',
    (_event, requestId: string, approved: boolean, remember: boolean) => {
      const pending = pendingApprovals.get(requestId)
      if (pending) {
        if (remember) {
          setToolPreference(pending.toolName, approved ? 'always_allow' : 'always_deny')
        }
        pending.resolve(approved)
        pendingApprovals.delete(requestId)
      }
      return true
    }
  )

  ipcMain.handle('tool:set-preference', (_event, toolName: string, value: string) => {
    setToolPreference(toolName, value)
    return true
  })

  ipcMain.handle('tool:get-preferences', () => {
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
