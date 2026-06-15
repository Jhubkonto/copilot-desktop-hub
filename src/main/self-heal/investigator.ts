import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'
import { promisify } from 'util'
import type { BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import { getApiKey, getProviderForAgent, sendProviderWithTools, type ProviderMessage } from '../providers'
import { runProviderMcpToolLoop } from '../tool-loop'
import type { ToolDefinition, ToolChoice, ProviderNonStreamResult } from '../provider-types'
import { ClaudeAdapter } from '../cli-adapters/claude'
import type {
  ErrorReportEntry,
  SelfHealInvestigationActivity,
  SelfHealInvestigationResult,
  SelfHealInvestigationSettings,
} from '../../shared/types'
import { broadcastToMobile } from '../ws-server'

const execFileAsync = promisify(execFile)
const MAX_FILE_CHARS = 32000
const MAX_GREP_RESULTS = 50

interface InvestigationCallbacks {
  onChunk: (chunk: string) => void
  onActivity: (activity: SelfHealInvestigationActivity) => void
}

function getWorkspacePath(): string {
  const row = getDatabase()
    .prepare("SELECT value FROM settings WHERE key = 'build_workspace_path'")
    .get() as { value: string } | undefined
  return row?.value || process.cwd()
}

function resolveInsideWorkspace(workspacePath: string, requestedPath: unknown): string {
  const relative = typeof requestedPath === 'string' ? requestedPath : ''
  const resolved = path.resolve(workspacePath, relative)
  const root = path.resolve(workspacePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Path is outside the configured workspace')
  }
  return resolved
}

function readReport(reportId: string): ErrorReportEntry {
  const row = getDatabase()
    .prepare('SELECT * FROM error_reports WHERE id = ?')
    .get(reportId) as ErrorReportEntry | undefined
  if (!row) throw new Error(`Error report ${reportId} was not found`)
  return row
}

function buildToolDefinitions(): ToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a UTF-8 text file from the configured workspace. Paths must be relative to the workspace.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_directory',
        description: 'List files and directories under a workspace-relative path.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'grep',
        description: 'Search workspace files for a literal query using ripgrep.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' }, path: { type: 'string' } },
          required: ['query'],
        },
      },
    },
  ]
}

function buildInlineHandlers(workspacePath: string) {
  return new Map<string, (args: Record<string, unknown>) => Promise<{ success: boolean; result?: string; error?: string }>>([
    ['read_file', async (args) => {
      const filePath = resolveInsideWorkspace(workspacePath, args.path)
      if (!existsSync(filePath) || !statSync(filePath).isFile()) return { success: false, error: 'File not found' }
      const content = readFileSync(filePath, 'utf8')
      return {
        success: true,
        result: content.length > MAX_FILE_CHARS
          ? `${content.slice(0, MAX_FILE_CHARS)}\n...[file truncated]`
          : content,
      }
    }],
    ['list_directory', async (args) => {
      const dirPath = resolveInsideWorkspace(workspacePath, args.path || '.')
      if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) return { success: false, error: 'Directory not found' }
      const rows = readdirSync(dirPath, { withFileTypes: true })
        .slice(0, 200)
        .map((entry) => `${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`)
      return { success: true, result: rows.join('\n') || '(empty)' }
    }],
    ['grep', async (args) => {
      const query = typeof args.query === 'string' ? args.query : ''
      if (!query.trim()) return { success: false, error: 'query is required' }
      const searchPath = resolveInsideWorkspace(workspacePath, args.path || '.')
      const { stdout } = await execFileAsync(
        'rg',
        ['--fixed-strings', '--line-number', '--max-count', String(MAX_GREP_RESULTS), query, searchPath],
        { cwd: workspacePath, timeout: 10000, maxBuffer: 1024 * 1024 },
      ).catch((error: unknown) => {
        const err = error as { code?: number; stdout?: string; message?: string }
        if (err.code === 1) return { stdout: '' }
        throw new Error(err.message ?? 'grep failed')
      })
      return { success: true, result: stdout || '(no matches)' }
    }],
  ])
}

function buildPrompt(report: ErrorReportEntry, workspacePath: string): ProviderMessage[] {
  const logExcerpt = report.log_snapshot ? report.log_snapshot.slice(0, 20000) : '(no log snapshot)'
  return [
    {
      role: 'system',
      content:
        'You are the Nexy self-heal investigator. Investigate the captured bug using only read-only tools. ' +
        'Do not propose code changes yet. Return a concise Markdown investigation report with YAML front matter.',
    },
    {
      role: 'user',
      content:
        `Investigate this bug report.\n\n` +
        `Workspace: ${workspacePath}\n` +
        `Title: ${report.title}\n` +
        `Description:\n${report.description || '(none)'}\n\n` +
        `Log snapshot:\n${logExcerpt}\n\n` +
        `Required YAML front matter keys: confidence, root_cause, affected_files. ` +
        `Then include sections: Summary, Evidence, Recommended Next Steps.`,
    },
  ]
}

function ensureStructuredMarkdown(markdown: string): SelfHealInvestigationResult {
  const frontMatterMatch = /^---\n([\s\S]*?)\n---\n?/.exec(markdown)
  const frontMatter = frontMatterMatch?.[1] ?? ''
  const confidence = /confidence:\s*(.+)/i.exec(frontMatter)?.[1]?.trim() || 'unknown'
  const rootCause = /root_cause:\s*(.+)/i.exec(frontMatter)?.[1]?.trim() || 'unknown'
  const affectedMatch = /affected_files:\s*\[([^\]]*)\]/i.exec(frontMatter)
  const affectedFiles = affectedMatch
    ? affectedMatch[1].split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    : []

  if (frontMatterMatch) {
    return {
      reportId: '',
      status: 'done',
      markdown,
      confidence,
      rootCause,
      affectedFiles,
      completedAt: Date.now(),
    }
  }

  const wrapped = [
    '---',
    'confidence: unknown',
    'root_cause: unknown',
    'affected_files: []',
    '---',
    '',
    markdown,
  ].join('\n')
  return {
    reportId: '',
    status: 'done',
    markdown: wrapped,
    confidence: 'unknown',
    rootCause: 'unknown',
    affectedFiles: [],
    completedAt: Date.now(),
  }
}

function persistResult(reportId: string, result: SelfHealInvestigationResult): SelfHealInvestigationResult {
  const completedAt = Date.now()
  getDatabase()
    .prepare(
      `UPDATE error_reports
       SET status = 'investigated',
           investigation_markdown = ?,
           investigation_confidence = ?,
           investigation_root_cause = ?,
           investigation_affected_files = ?,
           investigation_completed_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      result.markdown,
      result.confidence,
      result.rootCause,
      JSON.stringify(result.affectedFiles),
      completedAt,
      completedAt,
      reportId,
    )
  return { ...result, reportId, completedAt }
}

function persistError(reportId: string, error: unknown): SelfHealInvestigationResult {
  const completedAt = Date.now()
  const message = error instanceof Error ? error.message : String(error)
  const markdown = [
    '---',
    'confidence: none',
    'root_cause: investigation_failed',
    'affected_files: []',
    '---',
    '',
    `# Investigation failed\n\n${message}`,
  ].join('\n')
  getDatabase()
    .prepare(
      `UPDATE error_reports
       SET status = 'open',
           investigation_markdown = ?,
           investigation_confidence = 'none',
           investigation_root_cause = 'investigation_failed',
           investigation_affected_files = '[]',
           investigation_completed_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(markdown, completedAt, completedAt, reportId)
  return {
    reportId,
    status: 'error',
    markdown,
    confidence: 'none',
    rootCause: 'investigation_failed',
    affectedFiles: [],
    error: message,
    completedAt,
  }
}

export function loadInvestigationSettings(): SelfHealInvestigationSettings {
  const rows = getDatabase()
    .prepare("SELECT key, value FROM settings WHERE key IN ('self_heal_backend', 'self_heal_model', 'self_heal_retry_limit', 'self_heal_auto_approve_tools')")
    .all() as { key: string; value: string }[]
  const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  return {
    backend: settings.self_heal_backend === 'claude-cli' ? 'claude-cli' : 'byok',
    model: settings.self_heal_model || 'gpt-5-mini',
    retryLimit: Math.max(0, Math.min(Number.parseInt(settings.self_heal_retry_limit || '1', 10) || 1, 5)),
    autoApproveTools: settings.self_heal_auto_approve_tools === 'true',
  }
}

export function saveInvestigationSettings(input: SelfHealInvestigationSettings): SelfHealInvestigationSettings {
  const settings: SelfHealInvestigationSettings = {
    backend: input.backend === 'claude-cli' ? 'claude-cli' : 'byok',
    model: String(input.model || 'gpt-5-mini'),
    retryLimit: Math.max(0, Math.min(Number(input.retryLimit) || 0, 5)),
    autoApproveTools: !!input.autoApproveTools,
  }
  const stmt = getDatabase().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  stmt.run('self_heal_backend', settings.backend)
  stmt.run('self_heal_model', settings.model)
  stmt.run('self_heal_retry_limit', String(settings.retryLimit))
  stmt.run('self_heal_auto_approve_tools', String(settings.autoApproveTools))
  return settings
}

export async function runInvestigation(
  win: BrowserWindow,
  reportId: string,
  callbacks: InvestigationCallbacks,
): Promise<SelfHealInvestigationResult> {
  const report = readReport(reportId)
  const settings = loadInvestigationSettings()
  const workspacePath = getWorkspacePath()
  const startedAt = Date.now()
  getDatabase()
    .prepare("UPDATE error_reports SET status = 'investigating', investigation_started_at = ?, updated_at = ? WHERE id = ?")
    .run(startedAt, startedAt, reportId)

  const activity = (label: string, toolName?: string) => {
    callbacks.onActivity({ reportId, type: toolName ? 'tool' : 'status', label, toolName })
  }

  activity('Investigation started')
  for (let attempt = 0; attempt <= settings.retryLimit; attempt++) {
    try {
      if (attempt > 0) activity(`Retrying investigation (${attempt}/${settings.retryLimit})`)
    let markdown = ''
    if (settings.backend === 'claude-cli') {
      if (!ClaudeAdapter.isAvailable()) throw new Error('Claude CLI is not available')
      markdown = await ClaudeAdapter.send(
        win,
        {
          conversationId: `self-heal-${reportId}`,
          cwd: workspacePath,
          model: settings.model,
          messages: buildPrompt(report, workspacePath),
          systemPrompt: 'Investigate only. Return YAML front matter followed by Markdown.',
        },
        (chunk) => {
          callbacks.onChunk(chunk)
        },
        (event) => {
          if (event.type === 'tool_start') activity(`Running ${event.name}`, event.name)
        },
      )
    } else {
      const { provider, model } = getProviderForAgent(settings.model)
      const apiKey = getApiKey(provider)
      const toolDefs = buildToolDefinitions()
      const caller = (messages: ProviderMessage[], tools: ToolDefinition[] | undefined, toolChoice: ToolChoice): Promise<ProviderNonStreamResult> =>
        sendProviderWithTools(provider, apiKey, model, messages, tools ?? [], toolChoice, { maxTokens: 4096, temperature: 0.2 })
      markdown = await runProviderMcpToolLoop(
        caller,
        buildPrompt(report, workspacePath),
        toolDefs,
        new Map(),
        `self-heal-${randomUUID()}`,
        win.webContents,
        (chunk) => {
          callbacks.onChunk(chunk)
        },
        undefined,
        true,
        buildInlineHandlers(workspacePath),
        'Use the read-only workspace tools when useful. Investigate root cause and evidence. Do not write files.',
        (event) => {
          if (event.type === 'thinking') callbacks.onActivity({ reportId, type: 'thinking', label: 'Thinking' })
          else callbacks.onActivity({ reportId, type: 'tool', label: `Running ${event.name}`, toolName: event.name })
        },
        settings.autoApproveTools,
      )
    }
    const structured = ensureStructuredMarkdown(markdown)
    const result = persistResult(reportId, structured)
    callbacks.onActivity({ reportId, type: 'status', label: 'Investigation complete' })
    return result
    } catch (error) {
      if (attempt < settings.retryLimit) continue
      const result = persistError(reportId, error)
      callbacks.onActivity({ reportId, type: 'status', label: `Investigation failed: ${result.error}` })
      return result
    }
  }

  const result = persistError(reportId, new Error('Investigation failed without returning a result'))
  callbacks.onActivity({ reportId, type: 'status', label: `Investigation failed: ${result.error}` })
  return result
}

export function emitInvestigationEvent(
  win: BrowserWindow | undefined,
  channel: 'self-heal:investigation-activity' | 'self-heal:investigation-chunk' | 'self-heal:investigation-done',
  payload: unknown,
): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
  broadcastToMobile({ event: channel, data: payload })
}
