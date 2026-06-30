import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import { getApiKey, getProviderForAgent, sendProviderWithTools } from '../providers'
import { runProviderMcpToolLoop } from '../tool-loop'
import type { ToolDefinition, ToolChoice, ProviderNonStreamResult } from '../provider-types'
import { ClaudeAdapter } from '../cli-adapters/claude'
import { CodexAdapter } from '../cli-adapters/codex'
import { broadcastToMobile } from '../ws-server'
import type { ProviderMessage } from '../providers'
import type {
  RemoteEditFixEvent,
  RemoteEditFixDone,
  RemoteEditStagedFileEntry,
  DiffLine,
  DiffHunk,
} from '../../shared/types'
import { getWorkspacePath, resolveInsideWorkspace, loadInvestigationSettings } from './investigator'
import { parseAffectedFilesFromFrontMatter } from './yaml'

const MAX_FILE_CHARS = 32000

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function getStagingDir(reportId: string): string {
  return path.join(app.getPath('userData'), 'remote-edit', 'staging', reportId)
}

export function getBackupDir(reportId: string): string {
  return path.join(app.getPath('userData'), 'remote-edit', 'backups', reportId)
}

// ---------------------------------------------------------------------------
// Context guard (E4.3)
// ---------------------------------------------------------------------------

function guardedReadFile(workspacePath: string, relativePath: string): string {
  try {
    const abs = resolveInsideWorkspace(workspacePath, relativePath)
    if (!existsSync(abs) || !statSync(abs).isFile()) return '(file not found)'
    const raw = readFileSync(abs, 'utf8')
    return raw.length > MAX_FILE_CHARS
      ? `${raw.slice(0, MAX_FILE_CHARS)}\n...[file truncated at ${MAX_FILE_CHARS} chars]`
      : raw
  } catch {
    return '(file not readable)'
  }
}

// ---------------------------------------------------------------------------
// LCS-based line diff (E4.4) — no external dependency
// ---------------------------------------------------------------------------

function buildLcsTable(a: string[], b: string[]): number[][] {
  const m = a.length
  const n = b.length
  const table: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1])
    }
  }
  return table
}

function tracebackLcs(table: number[][], a: string[], b: string[]): DiffLine[] {
  const lines: DiffLine[] = []
  let i = a.length
  let j = b.length

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      lines.unshift({ type: 'context', lineNumber: { before: i, after: j }, content: a[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      lines.unshift({ type: 'added', lineNumber: { before: null, after: j }, content: b[j - 1] })
      j--
    } else {
      lines.unshift({ type: 'removed', lineNumber: { before: i, after: null }, content: a[i - 1] })
      i--
    }
  }
  return lines
}

function groupIntoHunks(lines: DiffLine[], context = 3): DiffHunk[] {
  if (lines.length === 0) return []

  // Find indices of changed lines
  const changedIndices = lines
    .map((l, idx) => (l.type !== 'context' ? idx : -1))
    .filter((idx) => idx !== -1)

  if (changedIndices.length === 0) return []

  // Build hunk ranges (start, end) with context padding
  const ranges: Array<{ start: number; end: number }> = []
  let start = Math.max(0, changedIndices[0] - context)
  let end = Math.min(lines.length - 1, changedIndices[0] + context)

  for (let k = 1; k < changedIndices.length; k++) {
    const nextStart = Math.max(0, changedIndices[k] - context)
    if (nextStart <= end + 1) {
      end = Math.min(lines.length - 1, changedIndices[k] + context)
    } else {
      ranges.push({ start, end })
      start = nextStart
      end = Math.min(lines.length - 1, changedIndices[k] + context)
    }
  }
  ranges.push({ start, end })

  return ranges.map(({ start: s, end: e }) => {
    const hunkLines = lines.slice(s, e + 1)
    const firstBefore = hunkLines.find((l) => l.lineNumber.before !== null)?.lineNumber.before ?? 1
    const firstAfter = hunkLines.find((l) => l.lineNumber.after !== null)?.lineNumber.after ?? 1
    const beforeCount = hunkLines.filter((l) => l.type !== 'added').length
    const afterCount = hunkLines.filter((l) => l.type !== 'removed').length
    const header = `@@ -${firstBefore},${beforeCount} +${firstAfter},${afterCount} @@`
    return { header, lines: hunkLines }
  })
}

export function computeLineDiff(before: string, after: string): DiffHunk[] {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const table = buildLcsTable(beforeLines, afterLines)
  const diffLines = tracebackLcs(table, beforeLines, afterLines)
  return groupIntoHunks(diffLines, 3)
}

// ---------------------------------------------------------------------------
// Output parser
// ---------------------------------------------------------------------------

interface ParsedFile {
  relativePath: string
  content: string
  error?: string
}

function parseFixOutput(output: string): ParsedFile[] {
  const results: ParsedFile[] = []
  const fileRegex = /<<<NEXY_FIX_FILE:([^>]+)>>>([\s\S]*?)<<<NEXY_FIX_END>>>/g
  const errorRegex = /<<<NEXY_FIX_ERROR:([^>]+)>>>(.*)/g
  let match: RegExpExecArray | null
  while ((match = fileRegex.exec(output)) !== null) {
    results.push({ relativePath: match[1].trim(), content: match[2].replace(/^\n/, '').replace(/\n$/, '') })
  }
  while ((match = errorRegex.exec(output)) !== null) {
    if (!results.some((r) => r.relativePath === match![1].trim())) {
      results.push({ relativePath: match[1].trim(), content: '', error: match[2].trim() || 'Unknown error' })
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// LLM prompt
// ---------------------------------------------------------------------------

function buildFixPrompt(
  report: { title: string; description: string; investigation_markdown: string | null },
  affectedFiles: string[],
  workspacePath: string,
): ProviderMessage[] {
  const fileContexts = affectedFiles
    .map((rel) => `### File: ${rel}\n\`\`\`\n${guardedReadFile(workspacePath, rel)}\n\`\`\``)
    .join('\n\n')

  return [
    {
      role: 'system',
      content:
        'You are the Nexy code changes agent. ' +
        'Based on the investigation report, produce a complete corrected version of every affected file. ' +
        'For each file output it in this EXACT format (no other text before or after):\n\n' +
        '<<<NEXY_FIX_FILE:relative/path/to/file.ts>>>\n' +
        '<complete corrected file content — no truncation, no ellipsis placeholders>\n' +
        '<<<NEXY_FIX_END>>>\n\n' +
        'If a file cannot be fixed, output:\n' +
        '<<<NEXY_FIX_ERROR:relative/path/to/file.ts>>>one-line reason\n\n' +
        'Output ONLY the file blocks. No explanation, no prose.',
    },
    {
      role: 'user',
      content:
        `Bug title: ${report.title}\n` +
        `Description: ${report.description || '(none)'}\n\n` +
        `## Investigation report\n${report.investigation_markdown ?? '(none)'}\n\n` +
        `## Affected files (current content)\n${fileContexts}\n\n` +
        `Workspace root: ${workspacePath}\n` +
        `Produce the corrected file(s) in the specified format.`,
    },
  ]
}

// ---------------------------------------------------------------------------
// Emit helper
// ---------------------------------------------------------------------------

export function emitFixEvent(
  win: BrowserWindow | undefined,
  channel: 'remote-edit:fix-event' | 'remote-edit:fix-done',
  payload: unknown,
): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
  broadcastToMobile({ event: channel, data: payload })
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

interface FixCallbacks {
  onEvent: (event: RemoteEditFixEvent) => void
}

export async function runFix(
  win: BrowserWindow,
  reportId: string,
  callbacks: FixCallbacks,
): Promise<RemoteEditFixDone> {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM error_reports WHERE id = ?').get(reportId) as Record<string, unknown> | undefined
  if (!row) throw new Error(`Report ${reportId} not found`)

  // Parse affected_files from YAML front matter.
  const markdown = typeof row.investigation_markdown === 'string' ? row.investigation_markdown : ''
  const frontMatterMatch = /^---\n([\s\S]*?)\n---\n?/.exec(markdown)
  const frontMatter = frontMatterMatch?.[1] ?? ''
  const affectedFiles = parseAffectedFilesFromFrontMatter(frontMatter)

  if (affectedFiles.length === 0) {
    throw new Error('No affected files found in investigation report — accept the investigation first')
  }

  const workspacePath = getWorkspacePath()
  const stagingDir = getStagingDir(reportId)
  mkdirSync(stagingDir, { recursive: true })

  const now = Date.now()
  db.prepare(
    `UPDATE error_reports SET fix_status = 'staging', fix_started_at = ?, updated_at = ? WHERE id = ?`,
  ).run(now, now, reportId)

  callbacks.onEvent({ reportId, type: 'status', label: 'Fix agent started' })

  const report = {
    title: String(row.title),
    description: String(row.description ?? ''),
    investigation_markdown: markdown,
  }
  const settings = loadInvestigationSettings()
  const messages = buildFixPrompt(report, affectedFiles, workspacePath)

  // --- LLM call (no tools — all context is in-prompt) ---
  let rawOutput = ''
  try {
    if (settings.backend === 'claude-cli') {
      if (!ClaudeAdapter.isAvailable()) throw new Error('Claude CLI is not available')
      rawOutput = await ClaudeAdapter.send(
        win,
        {
          conversationId: `remote-edit-fix-${reportId}`,
          cwd: workspacePath,
          model: settings.model,
          messages,
          systemPrompt: '',
        },
        () => { /* chunks not streamed for fix — delimiters only parse when complete */ },
        () => {},
      )
    } else if (settings.backend === 'codex-cli') {
      if (!CodexAdapter.isAvailable()) throw new Error('Codex CLI is not available')
      rawOutput = await CodexAdapter.send(
        win,
        {
          conversationId: `remote-edit-fix-${reportId}`,
          cwd: workspacePath,
          model: settings.model,
          messages,
          systemPrompt: 'Return patched file blocks only using the specified delimiters. No prose.',
        },
        () => { /* chunks not streamed for fix — delimiters only parse when complete */ },
        () => {},
      )
    } else {
      const { provider, model } = getProviderForAgent(settings.model)
      const apiKey = getApiKey(provider)
      const caller = (
        msgs: ProviderMessage[],
        tools: ToolDefinition[] | undefined,
        toolChoice: ToolChoice,
      ): Promise<ProviderNonStreamResult> =>
        sendProviderWithTools(provider, apiKey, model, msgs, tools ?? [], toolChoice, {
          maxTokens: 8192,
          temperature: 0.1,
        })
      rawOutput = await runProviderMcpToolLoop(
        caller,
        messages,
        [],
        new Map(),
        `remote-edit-fix-${randomUUID()}`,
        null,
        win.webContents,
        () => {},
        undefined,
        false,
        undefined,
        'Return patched file blocks only using the specified delimiters. No prose.',
      )
    }
  } catch (err) {
    throw new Error(`LLM call failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  callbacks.onEvent({ reportId, type: 'status', label: 'Parsing fix output' })

  const parsed = parseFixOutput(rawOutput)
  const stagedFiles: RemoteEditStagedFileEntry[] = []
  const diffRows: Array<{ relativePath: string; diffJson: string; createdAt: number }> = []

  for (const file of parsed) {
    if (file.error) {
      callbacks.onEvent({
        reportId,
        type: 'file-error',
        relativePath: file.relativePath,
        error: file.error,
        label: `Error patching ${file.relativePath}: ${file.error}`,
      })
      continue
    }

    // Write to staging dir only — workspace is NOT touched (E4.8)
    const stagingFilePath = path.join(stagingDir, file.relativePath)
    mkdirSync(path.dirname(stagingFilePath), { recursive: true })
    writeFileSync(stagingFilePath, file.content, 'utf8')

    // Compute diff (before = workspace file, after = staged content)
    const beforeContent = guardedReadFile(workspacePath, file.relativePath)
    const hunks = computeLineDiff(beforeContent, file.content)
    const diffLineCount = hunks.reduce((sum, h) => sum + h.lines.length, 0)

    stagedFiles.push({
      relativePath: file.relativePath,
      stagingPath: stagingFilePath,
      backupPath: null,
      diffLineCount,
      reviewed: false,
    })

    diffRows.push({
      relativePath: file.relativePath,
      diffJson: JSON.stringify({ hunks }),
      createdAt: Date.now(),
    })

    callbacks.onEvent({
      reportId,
      type: 'file-patched',
      relativePath: file.relativePath,
      label: `Patched ${file.relativePath}`,
    })
  }

  // Persist diffs and staged file list
  const completedAt = Date.now()

  if (diffRows.length > 0) {
    const diffInsert = db.prepare(
      `INSERT OR REPLACE INTO remote_edit_diffs (report_id, relative_path, diff_json, created_at) VALUES (?, ?, ?, ?)`,
    )
    const insertMany = db.transaction((rows: typeof diffRows) => {
      for (const r of rows) diffInsert.run(reportId, r.relativePath, r.diffJson, r.createdAt)
    })
    insertMany(diffRows)
  }

  db.prepare(
    `UPDATE error_reports SET fix_status = 'staged', fix_staged_files = ?, fix_completed_at = ?, updated_at = ? WHERE id = ?`,
  ).run(JSON.stringify(stagedFiles), completedAt, completedAt, reportId)

  callbacks.onEvent({ reportId, type: 'status', label: 'Staged patch ready' })

  return {
    reportId,
    status: stagedFiles.length > 0 ? 'done' : 'error',
    stagedFiles,
    error: stagedFiles.length === 0 ? 'No files were successfully patched' : undefined,
    completedAt,
  }
}
