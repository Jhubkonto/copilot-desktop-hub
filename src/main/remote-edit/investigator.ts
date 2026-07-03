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
import { getProjectRootDirectory } from '../project-handlers'
import { getCachedCatalog } from '../model-catalog'
import { resolveToolsSupported } from '../../shared/models'

const execFileAsync = promisify(execFile)
const MAX_FILE_CHARS = 32000
const MAX_GREP_RESULTS = 50

interface InvestigationCallbacks {
  onChunk: (chunk: string) => void
  onActivity: (activity: RemoteEditInvestigationActivity) => void
}

/**
 * Resolves the workspace directory a Code Changes request operates on. Requests are created
 * from within a project going forward, so `project_id` is the primary source of truth (and
 * reflects the project's *current* rootDirectory, even if it was edited after the request was
 * created). `workspace_root` is a per-request snapshot kept for requests without a linked
 * project (build-failure/Android origin). `process.cwd()` is a last-resort fallback that should
 * not normally be reached.
 */
export function getWorkspacePathForReport(reportId: string): string {
  const report = getDatabase()
    .prepare('SELECT workspace_root, project_id FROM error_reports WHERE id = ?')
    .get(reportId) as { workspace_root: string | null; project_id: string | null } | undefined

  if (report?.project_id) {
    const projectRoot = getProjectRootDirectory(report.project_id)
    if (projectRoot) return projectRoot
  }
  if (report?.workspace_root) return report.workspace_root
  return process.cwd()
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

const BUGFIX_REQUEST_TYPES = new Set<ErrorReportEntry['request_type']>(['bugfix', 'investigation', null, undefined])

function buildPrompt(report: ErrorReportEntry, workspacePath: string, revisionNotes?: string): ProviderMessage[] {
  const isBugfix = BUGFIX_REQUEST_TYPES.has(report.request_type)
  const logExcerpt = report.log_snapshot ? report.log_snapshot.slice(0, 20000) : '(no log snapshot)'
  const revisionSection = revisionNotes?.trim()
    ? `\nThe previous plan was reviewed and needs revision. Guidance from the reviewer:\n${revisionNotes.trim()}\n\nIncorporate this guidance into the new plan.\n`
    : ''

  const subject = isBugfix ? 'bug' : 'change request'
  const taskVerb = isBugfix ? 'Investigate the captured bug' : 'Plan this change request'
  // "Evidence" fits a bug investigation (verbatim log/tool-result quotes proving a root cause) but
  // reads oddly for a plain change request, where the same section is really "what I found while
  // looking at the codebase" rather than proof of a bug.
  const evidenceSectionLabel = isBugfix ? 'Evidence' : 'Findings'
  const rootCauseInstruction = isBugfix
    ? 'Ground every claim in the original log snapshot you were given and in the actual results returned by your tool calls, including failed ones. ' +
      'Never invent files, error messages, stack traces, or other evidence that does not appear in the log snapshot or in a tool result you actually received. ' +
      `Every item in the ${evidenceSectionLabel} section must include a short verbatim quote from the log snapshot or a tool result, copied exactly — if you cannot quote the exact source text an item is based on, do not include that item. ` +
      'Do not report errors, timestamps, or symptoms from outside this specific bug report — for example, do not describe unrelated runtime/console errors unless they appear verbatim in this report\'s log snapshot or tool results. '
    : 'Ground every claim in the actual results returned by your tool calls, including failed ones — read the relevant files and directory structure before proposing a plan. ' +
      'Never invent files, functions, or code that does not appear in a tool result you actually received. ' +
      `Every item in the ${evidenceSectionLabel} section must include a short verbatim quote from a tool result (e.g. a snippet of the file you read), copied exactly — if you cannot quote the exact source text an item is based on, do not include that item. `
  // The YAML key the model is asked to emit differs by request type — root_cause implies
  // something is broken, which is misleading for a plain change request — but both keys are
  // parsed into the same internal rootCause field / investigation_root_cause column (see
  // buildCandidate's parser), so this only affects what the model writes, not storage.
  const rootCauseField = isBugfix ? 'root_cause' : 'approach'
  const rootCauseFieldDescription = isBugfix
    ? 'a one-sentence root cause'
    : 'a one-sentence summary of the planned approach'
  const confidenceFieldDescription = 'a whole number from 0 to 100 (no % sign, no words) reflecting how confident you are in this ' +
    (isBugfix ? 'root cause' : 'plan')
  const reportOrPlanNoun = isBugfix ? 'report' : 'plan'
  const reportNoun = isBugfix ? 'investigation report' : reportOrPlanNoun
  const lastSectionLabel = isBugfix ? 'Recommended Next Steps' : 'Plan'
  const lastSectionInstruction = isBugfix
    ? lastSectionLabel
    : 'Plan (the concrete steps you propose to make this change, in the order you\'d make them — not steps to go gather more information)'

  return [
    {
      role: 'system',
      content:
        `You are the Nexy Code Changes planner. ${taskVerb} using only read-only tools. ` +
        `Do not propose code changes yet. Return a concise Markdown ${reportNoun} with YAML front matter. ` +
        rootCauseInstruction +
        `If a tool fails or is unavailable, say so plainly in the ${reportOrPlanNoun} instead of fabricating a substitute explanation. ` +
        `Never guess a file path for read_file. Use list_directory and/or grep first to locate the real file that is actually relevant to the ${subject}, and only call read_file on a path you have confirmed exists. ` +
        `A "File not found" result is not evidence of anything about the ${subject} — it only means your guessed path was wrong; do not cite it in the ${reportOrPlanNoun} or list that path under affected_files. ` +
        'Only list a path under affected_files if a read_file or grep call on that exact path actually succeeded — never list a path solely because it seems plausible. ' +
        'Your response must begin with exactly one YAML front matter block delimited by --- lines, appearing once, at the very start of the response, before any other text — do not duplicate it later and do not also restate it inside a fenced ```yaml block. ' +
        `The front matter block must contain ONLY the three keys confidence, ${rootCauseField}, and affected_files — nothing else. ` +
        `confidence must be ${confidenceFieldDescription}. ` +
        `Summary, ${evidenceSectionLabel}, and ${lastSectionLabel} are Markdown sections that come AFTER the closing --- of the front matter, each as a "## Heading" followed by prose or a bullet list — never as additional YAML keys inside the front matter block.`,
    },
    {
      role: 'user',
      content:
        `${taskVerb}.\n\n` +
        `Workspace: ${workspacePath}\n` +
        `Title: ${report.title}\n` +
        `Description:\n${report.description || '(none)'}\n\n` +
        `Log snapshot:\n${logExcerpt}\n${revisionSection}\n` +
        `Required YAML front matter keys: confidence (${confidenceFieldDescription}), ${rootCauseField} (${rootCauseFieldDescription}), affected_files. ` +
        `Then include sections: Summary, ${evidenceSectionLabel}, ${lastSectionInstruction}.`,
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
  // root_cause is the bugfix-path key; approach is the non-bugfix-path key (see buildPrompt) —
  // only one is ever requested for a given report, but the parser accepts either since it has no
  // access to the report's request_type.
  const rootCause = (/root_cause:\s*(.+)/i.exec(body)?.[1] ?? /approach:\s*(.+)/i.exec(body)?.[1])?.trim() || 'unknown'
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

function ensureStructuredMarkdown(markdown: string, isBugfix: boolean, confirmedPaths?: Set<string>): RemoteEditInvestigationResult {
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
    `${isBugfix ? 'root_cause' : 'approach'}: unknown`,
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
  // status stays 'investigating' here rather than advancing straight to 'investigated' — a
  // completed plan still needs an explicit human Accept before it's treated as approved (via
  // remote-edit:set-report-status). Only the accept action itself sets status to 'investigated'.
  getDatabase()
    .prepare(
      `UPDATE error_reports
       SET investigation_markdown = ?,
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
    `# Planning failed\n\n${message}`,
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
  revisionNotes?: string,
): Promise<RemoteEditInvestigationResult> {
  const report = readReport(reportId)
  const isBugfix = BUGFIX_REQUEST_TYPES.has(report.request_type)
  const settings = loadInvestigationSettings()
  const workspacePath = getWorkspacePathForReport(reportId)
  const startedAt = Date.now()
  if (revisionNotes?.trim()) {
    getDatabase()
      .prepare("UPDATE error_reports SET status = 'investigating', investigation_started_at = ?, investigation_revision_notes = ?, updated_at = ? WHERE id = ?")
      .run(startedAt, revisionNotes.trim(), startedAt, reportId)
  } else {
    getDatabase()
      .prepare("UPDATE error_reports SET status = 'investigating', investigation_started_at = ?, updated_at = ? WHERE id = ?")
      .run(startedAt, startedAt, reportId)
  }

  const activity = (label: string, toolName?: string) => {
    callbacks.onActivity({ reportId, type: toolName ? 'tool' : 'status', label, toolName })
  }

  activity('Planning started')
  for (let attempt = 0; attempt <= settings.retryLimit; attempt++) {
    try {
      if (attempt > 0) activity(`Retrying plan (${attempt}/${settings.retryLimit})`)
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
          messages: buildPrompt(report, workspacePath, revisionNotes),
          systemPrompt: isBugfix
            ? 'Investigate only. Return YAML front matter followed by Markdown.'
            : 'Plan only. Return YAML front matter followed by Markdown.',
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
          messages: buildPrompt(report, workspacePath, revisionNotes),
          systemPrompt: isBugfix
            ? 'Investigate only. Return YAML front matter followed by Markdown.'
            : 'Plan only. Return YAML front matter followed by Markdown.',
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
      // Some models (e.g. Hermes/Nous-family models via OpenRouter) accept a `tools` payload
      // without erroring but never populate a structured tool-call response — they emit their
      // own pretrained pseudo-tool-call syntax as plain text instead, which nothing here parses,
      // silently producing an investigation with no evidence gathered rather than a clear error.
      // Proactively route those to the prompted (JSON-in-text) tool-calling path instead of
      // relying solely on the reactive "No endpoints found that support tool use" fallback below,
      // which only catches models that actually reject the request.
      const nativeToolsSupported = resolveToolsSupported(provider, model, getCachedCatalog())
      const caller = async (messages: ProviderMessage[], tools: ToolDefinition[] | undefined, toolChoice: ToolChoice): Promise<ProviderNonStreamResult> => {
        if (!nativeToolsSupported) {
          const promptedCaller = createPromptedToolCaller(provider, apiKey, model, { maxTokens: 4096, temperature: 0.2 })
          const promptedMessages = toolChoice === 'none' ? messages : injectPromptedToolSystemPrompt(messages, tools ?? [])
          return promptedCaller(promptedMessages, tools, toolChoice)
        }
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
        buildPrompt(report, workspacePath, revisionNotes),
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
        isBugfix
          ? 'Use the read-only workspace tools when useful. Investigate root cause and evidence. Do not write files.'
          : 'Use the read-only workspace tools when useful. Gather evidence for the plan. Do not write files.',
        (event) => {
          if (event.type === 'thinking') callbacks.onActivity({ reportId, type: 'thinking', label: 'Thinking' })
          else callbacks.onActivity({ reportId, type: 'tool', label: `Running ${event.name}`, toolName: event.name })
        },
        settings.autoApproveTools,
      )
    }
    const structured = ensureStructuredMarkdown(markdown, isBugfix, confirmedPaths)
    const result = persistResult(reportId, structured)
    callbacks.onActivity({ reportId, type: 'status', label: 'Planning complete' })
    return result
    } catch (error) {
      if (attempt < settings.retryLimit) continue
      const result = persistError(reportId, error)
      callbacks.onActivity({ reportId, type: 'status', label: `Planning failed: ${result.error}` })
      return result
    }
  }

  const result = persistError(reportId, new Error('Planning failed without returning a result'))
  callbacks.onActivity({ reportId, type: 'status', label: `Planning failed: ${result.error}` })
  return result
}

// The Android client's WsEventParser only recognizes the "self-heal:*" event names (its original
// naming, from before this was renamed to "Code Changes" on desktop) — broadcasting under
// "remote-edit:*" here silently drops the update on mobile. Desktop's webContents.send still uses
// the "remote-edit:*" channel param as-is; only the mobile broadcast needs translating.
const MOBILE_EVENT_NAMES: Record<string, string> = {
  'remote-edit:investigation-activity': 'self-heal:investigation-activity',
  'remote-edit:investigation-chunk': 'self-heal:investigation-chunk',
  'remote-edit:investigation-done': 'self-heal:investigation-done',
}

export function emitInvestigationEvent(
  win: BrowserWindow | undefined,
  channel: 'remote-edit:investigation-activity' | 'remote-edit:investigation-chunk' | 'remote-edit:investigation-done',
  payload: unknown,
): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
  broadcastToMobile({ event: MOBILE_EVENT_NAMES[channel], data: payload })
}
