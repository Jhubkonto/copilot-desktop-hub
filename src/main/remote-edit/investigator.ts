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
import { CodexAdapter } from '../cli-adapters/codex'
import type {
  ErrorReportEntry,
  RemoteEditInvestigationActivity,
  RemoteEditInvestigationResult,
  RemoteEditInvestigationSettings,
} from '../../shared/types'
import { broadcastToMobile } from '../ws-server'
import { parseAffectedFilesFromFrontMatter } from './yaml'
import { createPromptedToolCaller, injectPromptedToolSystemPrompt } from './prompted-tool-caller'

const execFileAsync = promisify(execFile)
const MAX_FILE_CHARS = 32000
const MAX_GREP_RESULTS = 50

interface InvestigationCallbacks {
  onChunk: (chunk: string) => void
  onActivity: (activity: RemoteEditInvestigationActivity) => void
}

export function getWorkspacePath(): string {
  const row = getDatabase()
    .prepare("SELECT value FROM settings WHERE key = 'build_workspace_path'")
    .get() as { value: string } | undefined
  return row?.value || process.cwd()
}

export function resolveInsideWorkspace(workspacePath: string, requestedPath: unknown): string {
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

function normalizeConfirmedPath(workspacePath: string, requestedPath: unknown): string {
  const relative = typeof requestedPath === 'string' ? requestedPath : ''
  return path.relative(workspacePath, path.resolve(workspacePath, relative)).split(path.sep).join('/')
}

export function buildInlineHandlers(workspacePath: string, confirmedPaths?: Set<string>) {
  return new Map<string, (args: Record<string, unknown>) => Promise<{ success: boolean; result?: string; error?: string }>>([
    ['read_file', async (args) => {
      try {
        const filePath = resolveInsideWorkspace(workspacePath, args.path)
        if (!existsSync(filePath) || !statSync(filePath).isFile()) return { success: false, error: 'File not found' }
        const content = readFileSync(filePath, 'utf8')
        confirmedPaths?.add(normalizeConfirmedPath(workspacePath, args.path))
        return {
          success: true,
          result: content.length > MAX_FILE_CHARS
            ? `${content.slice(0, MAX_FILE_CHARS)}\n...[file truncated]`
            : content,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: `read_file failed: ${message}` }
      }
    }],
    ['list_directory', async (args) => {
      try {
        const dirPath = resolveInsideWorkspace(workspacePath, args.path || '.')
        if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) return { success: false, error: 'Directory not found' }
        const rows = readdirSync(dirPath, { withFileTypes: true })
          .slice(0, 200)
          .map((entry) => `${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`)
        return { success: true, result: rows.join('\n') || '(empty)' }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: `list_directory failed: ${message}` }
      }
    }],
    ['grep', async (args) => {
      const query = typeof args.query === 'string' ? args.query : ''
      if (!query.trim()) return { success: false, error: 'query is required' }
      const searchPath = resolveInsideWorkspace(workspacePath, args.path || '.')
      try {
        const { stdout } = await execFileAsync(
          'rg',
          ['--fixed-strings', '--line-number', '--max-count', String(MAX_GREP_RESULTS), query, searchPath],
          { cwd: workspacePath, timeout: 10000, maxBuffer: 1024 * 1024 },
        ).catch((error: unknown) => {
          const err = error as { code?: number; stdout?: string }
          if (err.code === 1) return { stdout: '' }
          throw error
        })
        if (stdout) {
          for (const line of stdout.split('\n')) {
            const match = /^(.+):\d+:/.exec(line)
            if (match) confirmedPaths?.add(normalizeConfirmedPath(workspacePath, match[1]))
          }
        }
        return { success: true, result: stdout || '(no matches)' }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: `grep failed: ${message}` }
      }
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
        'Do not propose code changes yet. Return a concise Markdown investigation report with YAML front matter. ' +
        'Ground every claim in the original log snapshot you were given and in the actual results returned by your tool calls, including failed ones. ' +
        'Never invent files, error messages, stack traces, or other evidence that does not appear in the log snapshot or in a tool result you actually received. ' +
        'Every item in the Evidence section must include a short verbatim quote from the log snapshot or a tool result, copied exactly — if you cannot quote the exact source text an item is based on, do not include that item. ' +
        'Do not report errors, timestamps, or symptoms from outside this specific bug report — for example, do not describe unrelated runtime/console errors unless they appear verbatim in this report\'s log snapshot or tool results. ' +
        'If a tool fails or is unavailable, say so plainly in the report instead of fabricating a substitute explanation. ' +
        'Never guess a file path for read_file. Use list_directory and/or grep first to locate the real file that is actually relevant to the log snapshot, and only call read_file on a path you have confirmed exists. ' +
        'A "File not found" result is not evidence of anything about the bug — it only means your guessed path was wrong; do not cite it in the report or list that path under affected_files. ' +
        'Only list a path under affected_files if a read_file or grep call on that exact path actually succeeded — never list a path solely because it seems plausible. ' +
        'Your response must begin with exactly one YAML front matter block delimited by --- lines, appearing once, at the very start of the response, before any other text — do not duplicate it later and do not also restate it inside a fenced ```yaml block. ' +
        'The front matter block must contain ONLY the three keys confidence, root_cause, and affected_files — nothing else. ' +
        'Summary, Evidence, and Recommended Next Steps are Markdown sections that come AFTER the closing --- of the front matter, each as a "## Heading" followed by prose or a bullet list — never as additional YAML keys inside the front matter block.',
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

const DASH_BLOCK_RE = /^---\n([\s\S]*?)\n---\s*\n?/gm
const YAML_FENCE_RE = /```ya?ml\s*\n([\s\S]*?)```/gi

interface FrontMatterCandidate {
  index: number
  confidence: string
  rootCause: string
  affectedFiles: string[]
  score: number
}

function scoreBlock(confidence: string, rootCause: string, affectedFiles: string[]): number {
  let score = 0
  if (confidence && !['unknown', 'none'].includes(confidence.toLowerCase())) score += 1
  if (rootCause && rootCause.toLowerCase() !== 'unknown' && rootCause.trim().length > 3) score += 1
  if (affectedFiles.length > 0) score += 1
  return score
}

function buildCandidate(index: number, body: string): FrontMatterCandidate {
  const confidence = /confidence:\s*(.+)/i.exec(body)?.[1]?.trim() || 'unknown'
  const rootCause = /root_cause:\s*(.+)/i.exec(body)?.[1]?.trim() || 'unknown'
  const affectedFiles = parseAffectedFilesFromFrontMatter(body)
  return { index, confidence, rootCause, affectedFiles, score: scoreBlock(confidence, rootCause, affectedFiles) }
}

function extractFrontMatterCandidates(markdown: string): FrontMatterCandidate[] {
  const candidates: FrontMatterCandidate[] = []
  for (const match of markdown.matchAll(DASH_BLOCK_RE)) {
    candidates.push(buildCandidate(match.index ?? 0, match[1]))
  }
  for (const match of markdown.matchAll(YAML_FENCE_RE)) {
    candidates.push(buildCandidate(match.index ?? 0, match[1]))
  }
  return candidates
}

function pickBestCandidate(candidates: FrontMatterCandidate[]): FrontMatterCandidate | undefined {
  let best: FrontMatterCandidate | undefined
  for (const candidate of candidates) {
    if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.index > best.index)) {
      best = candidate
    }
  }
  return best
}

function filterToConfirmedPaths(affectedFiles: string[], confirmedPaths?: Set<string>): string[] {
  if (!confirmedPaths) return affectedFiles
  return affectedFiles.filter((file) => confirmedPaths.has(file.split('\\').join('/').replace(/^\.?\//, '')))
}

function ensureStructuredMarkdown(markdown: string, confirmedPaths?: Set<string>): RemoteEditInvestigationResult {
  const best = pickBestCandidate(extractFrontMatterCandidates(markdown))

  if (best) {
    return {
      reportId: '',
      status: 'done',
      markdown,
      confidence: best.confidence,
      rootCause: best.rootCause,
      affectedFiles: filterToConfirmedPaths(best.affectedFiles, confirmedPaths),
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

function persistResult(reportId: string, result: RemoteEditInvestigationResult): RemoteEditInvestigationResult {
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

function persistError(reportId: string, error: unknown): RemoteEditInvestigationResult {
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

export function loadInvestigationSettings(): RemoteEditInvestigationSettings {
  const rows = getDatabase()
    .prepare("SELECT key, value FROM settings WHERE key IN ('remote_edit_backend', 'remote_edit_model', 'remote_edit_retry_limit', 'remote_edit_auto_approve_tools')")
    .all() as { key: string; value: string }[]
  const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  const backend = settings.remote_edit_backend === 'claude-cli' || settings.remote_edit_backend === 'codex-cli'
    ? settings.remote_edit_backend
    : 'byok'
  return {
    backend,
    model: settings.remote_edit_model || 'gpt-5-mini',
    retryLimit: Math.max(0, Math.min(Number.parseInt(settings.remote_edit_retry_limit || '1', 10) || 1, 5)),
    autoApproveTools: settings.remote_edit_auto_approve_tools === 'true',
  }
}

export function saveInvestigationSettings(input: RemoteEditInvestigationSettings): RemoteEditInvestigationSettings {
  const backend = input.backend === 'claude-cli' || input.backend === 'codex-cli'
    ? input.backend
    : 'byok'
  const settings: RemoteEditInvestigationSettings = {
    backend,
    model: String(input.model || 'gpt-5-mini'),
    retryLimit: Math.max(0, Math.min(Number(input.retryLimit) || 0, 5)),
    autoApproveTools: !!input.autoApproveTools,
  }
  const stmt = getDatabase().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  stmt.run('remote_edit_backend', settings.backend)
  stmt.run('remote_edit_model', settings.model)
  stmt.run('remote_edit_retry_limit', String(settings.retryLimit))
  stmt.run('remote_edit_auto_approve_tools', String(settings.autoApproveTools))
  return settings
}

export async function runInvestigation(
  win: BrowserWindow,
  reportId: string,
  callbacks: InvestigationCallbacks,
): Promise<RemoteEditInvestigationResult> {
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
    let confirmedPaths: Set<string> | undefined
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
    } else if (settings.backend === 'codex-cli') {
      if (!CodexAdapter.isAvailable()) throw new Error('Codex CLI is not available')
      markdown = await CodexAdapter.send(
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
      confirmedPaths = new Set<string>()
      const caller = async (messages: ProviderMessage[], tools: ToolDefinition[] | undefined, toolChoice: ToolChoice): Promise<ProviderNonStreamResult> => {
        try {
          return await sendProviderWithTools(provider, apiKey, model, messages, tools ?? [], toolChoice, { maxTokens: 4096, temperature: 0.2 })
        } catch (err) {
          if (err instanceof Error && err.message.includes('No endpoints found that support tool use')) {
            try {
              const promptedCaller = createPromptedToolCaller(provider, apiKey, model, { maxTokens: 4096, temperature: 0.2 })
              const promptedMessages = toolChoice === 'none' ? messages : injectPromptedToolSystemPrompt(messages, tools ?? [])
              return await promptedCaller(promptedMessages, tools, toolChoice)
            } catch {
              return sendProviderWithTools(provider, apiKey, model, messages, [], 'none', { maxTokens: 4096, temperature: 0.2 })
            }
          }
          throw err
        }
      }
      markdown = await runProviderMcpToolLoop(
        caller,
        buildPrompt(report, workspacePath),
        toolDefs,
        new Map(),
        `self-heal-${randomUUID()}`,
        null,
        win.webContents,
        (chunk) => {
          callbacks.onChunk(chunk)
        },
        undefined,
        true,
        buildInlineHandlers(workspacePath, confirmedPaths),
        'Use the read-only workspace tools when useful. Investigate root cause and evidence. Do not write files.',
        (event) => {
          if (event.type === 'thinking') callbacks.onActivity({ reportId, type: 'thinking', label: 'Thinking' })
          else callbacks.onActivity({ reportId, type: 'tool', label: `Running ${event.name}`, toolName: event.name })
        },
        settings.autoApproveTools,
      )
    }
    const structured = ensureStructuredMarkdown(markdown, confirmedPaths)
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
  channel: 'remote-edit:investigation-activity' | 'remote-edit:investigation-chunk' | 'remote-edit:investigation-done',
  payload: unknown,
): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
  broadcastToMobile({ event: channel, data: payload })
}
