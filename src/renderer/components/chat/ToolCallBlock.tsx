import { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Pin } from 'lucide-react'
import { stripAnsiEscapes } from '../../../shared/ansi'

interface ToolCallBlockProps {
  toolName: string
  serverName?: string
  args?: Record<string, unknown>
  result?: string
  success?: boolean
  inProgress?: boolean
  resultImages?: { dataUrl: string }[]
  onUseImageAsContext?: (dataUrl: string) => void
}

// How much of the result is always visible without clicking — the rest is available
// via the expand toggle, appended right below rather than replacing this. Two caps
// apply independently: a line-count cap (for normal multi-line output) and a
// character cap (so a single very long line, e.g. a long path or minified JSON,
// still gets truncated instead of rendering unbounded).
const RESULT_PREVIEW_LINES = 3
const RESULT_PREVIEW_CHARS = 240
const RESULT_MAX_CHARS = 2000

function buildResultPreview(result: string): { preview: string; truncated: boolean; remainder: string; hiddenLineCount: number } {
  const lines = result.split('\n')
  const lineLimited = lines.length > RESULT_PREVIEW_LINES
  let preview = lineLimited ? lines.slice(0, RESULT_PREVIEW_LINES).join('\n') : result
  const hiddenLineCount = lineLimited ? lines.length - RESULT_PREVIEW_LINES : 0
  const charLimited = preview.length > RESULT_PREVIEW_CHARS
  if (charLimited) preview = preview.slice(0, RESULT_PREVIEW_CHARS)
  const truncated = lineLimited || charLimited
  let remainder = truncated ? result.slice(preview.length) : ''
  if (remainder.length > RESULT_MAX_CHARS) {
    remainder = `${remainder.slice(0, RESULT_MAX_CHARS)}\n…(truncated)`
  }
  return { preview, truncated, remainder, hiddenLineCount }
}

// Rough line-level diff via multiset comparison — not a real LCS, but close enough
// for "Added N lines" / "Removed N lines" summaries and cheap to compute.
function diffLineCounts(oldText: string, newText: string): { added: number; removed: number } {
  const remaining = new Map<string, number>()
  for (const line of oldText.split('\n')) remaining.set(line, (remaining.get(line) ?? 0) + 1)
  let added = 0
  for (const line of newText.split('\n')) {
    const count = remaining.get(line) ?? 0
    if (count > 0) remaining.set(line, count - 1)
    else added++
  }
  let removed = 0
  for (const count of remaining.values()) removed += count
  return { added, removed }
}

function pluralLines(n: number): string {
  return `${n} line${n === 1 ? '' : 's'}`
}

function editSummary(oldText: string | undefined, newText: string | undefined): string | undefined {
  if (typeof oldText !== 'string' || typeof newText !== 'string') return undefined
  const { added, removed } = diffLineCounts(oldText, newText)
  if (added > 0 && removed > 0) return `Added ${pluralLines(added)}, removed ${pluralLines(removed)}`
  if (added > 0) return `Added ${pluralLines(added)}`
  if (removed > 0) return `Removed ${pluralLines(removed)}`
  return undefined
}

function pathArg(args: Record<string, unknown>): string | undefined {
  const candidate = args.file_path ?? args.path ?? args.notebook_path
  return typeof candidate === 'string' ? candidate : undefined
}

// Strips the `mcp__<server>__` prefix the CLI backends put on MCP tool names so the
// display shows just the tool itself — the server is already shown separately.
function shortToolName(toolName: string): string {
  if (!toolName.startsWith('mcp__')) return toolName
  const parts = toolName.split('__')
  return parts[parts.length - 1] || toolName
}

interface ToolDescription {
  /** Bold header line — verb/tool name plus its primary target, e.g. "Edit foo.ts" or "Bash ls -la". */
  title: string
  /** Grey line replacing the raw result preview entirely (e.g. "Added 12 lines") — used
   *  for tools whose result text ("File written successfully") carries no information
   *  beyond what the summary already says. */
  summary?: string
  /** When true, never show the tool's raw result text/preview — `summary` already covers it. */
  suppressResult?: boolean
}

// Turns a tool call's raw arguments into a short, human title (Claude Code CLI style,
// e.g. "Edit path/to/file.ts") plus an optional grey summary line — instead of dumping
// raw key: value argument pairs, which show JSON braces for anything non-scalar.
function describeToolCall(rawToolName: string, args: Record<string, unknown> | undefined): ToolDescription {
  const toolName = shortToolName(rawToolName)
  const a = args ?? {}

  // The plan itself is already shown in full by the floating exit_plan_mode approval
  // card (ToolApproval.tsx) — folding its `plan` arg into the title here as well would
  // duplicate the entire plan text inline in the transcript.
  if (toolName.toLowerCase() === 'exitplanmode') {
    return { title: 'Plan ready for review', suppressResult: true }
  }

  switch (toolName) {
    case 'Read': {
      const path = pathArg(a)
      const offset = typeof a.offset === 'number' ? a.offset : undefined
      const limit = typeof a.limit === 'number' ? a.limit : undefined
      const range = offset != null && limit != null ? ` (lines ${offset}-${offset + limit - 1})`
        : offset != null ? ` (from line ${offset})` : ''
      return { title: `Read ${path ?? ''}${range}` }
    }
    case 'Write': {
      const path = pathArg(a)
      const content = typeof a.content === 'string' ? a.content : undefined
      return { title: `Write ${path ?? ''}`, summary: content ? pluralLines(content.split('\n').length) : undefined, suppressResult: true }
    }
    case 'Edit': {
      const path = pathArg(a)
      return {
        title: `Edit ${path ?? ''}`,
        summary: editSummary(a.old_string as string | undefined, a.new_string as string | undefined),
        suppressResult: true,
      }
    }
    case 'MultiEdit': {
      const path = pathArg(a)
      const edits = Array.isArray(a.edits) ? a.edits as Array<{ old_string?: string; new_string?: string }> : []
      let added = 0
      let removed = 0
      for (const edit of edits) {
        if (typeof edit.old_string === 'string' && typeof edit.new_string === 'string') {
          const diff = diffLineCounts(edit.old_string, edit.new_string)
          added += diff.added
          removed += diff.removed
        }
      }
      const parts: string[] = []
      if (added > 0) parts.push(`added ${pluralLines(added)}`)
      if (removed > 0) parts.push(`removed ${pluralLines(removed)}`)
      const editCount = edits.length > 0 ? `${edits.length} edit${edits.length === 1 ? '' : 's'}` : undefined
      return {
        title: `Edit ${path ?? ''}`,
        summary: [editCount, parts.join(', ') || undefined].filter(Boolean).join(' · ') || undefined,
        suppressResult: true,
      }
    }
    case 'NotebookEdit': {
      const path = pathArg(a)
      return { title: `Edit ${path ?? ''}` }
    }
    case 'Bash': {
      const command = typeof a.command === 'string' ? a.command : undefined
      return { title: command ? `Bash ${command}` : 'Bash' }
    }
    case 'Grep': {
      const pattern = typeof a.pattern === 'string' ? a.pattern : undefined
      const path = pathArg(a)
      return { title: `Grep "${pattern ?? ''}"${path ? ` ${path}` : ''}` }
    }
    case 'Glob': {
      const pattern = typeof a.pattern === 'string' ? a.pattern : undefined
      const path = pathArg(a)
      return { title: `Glob "${pattern ?? ''}"${path ? ` ${path}` : ''}` }
    }
    case 'WebFetch': {
      const url = typeof a.url === 'string' ? a.url : undefined
      return { title: `Fetch ${url ?? ''}` }
    }
    case 'WebSearch': {
      const query = typeof a.query === 'string' ? a.query : undefined
      return { title: `Search "${query ?? ''}"` }
    }
    case 'TodoWrite': {
      const todos = Array.isArray(a.todos) ? a.todos.length : undefined
      return { title: 'Update todos', summary: todos != null ? `${todos} item${todos === 1 ? '' : 's'}` : undefined, suppressResult: true }
    }
    case 'Task': {
      const description = typeof a.description === 'string' ? a.description : undefined
      return { title: description ? `Task: ${description}` : 'Task' }
    }
    default: {
      // Unknown / MCP tool — fold the first scalar argument into the title, never an
      // object (which would otherwise render as raw JSON braces).
      const entries = Object.entries(a).filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
      const argText = entries.length > 0 ? entries.map(([k, v]) => `${k}: ${String(v)}`).join(', ') : ''
      return { title: argText ? `${toolName} ${argText}` : toolName }
    }
  }
}

export function ToolCallBlock({
  toolName, serverName, args, result, success = true, inProgress = false, resultImages, onUseImageAsContext
}: ToolCallBlockProps) {
  const { title, summary, suppressResult } = describeToolCall(toolName, args)
  const cleanedResult = !suppressResult && result ? stripAnsiEscapes(result) : undefined

  const { preview: previewText, truncated: resultTruncated, remainder: remainderText, hiddenLineCount } =
    cleanedResult ? buildResultPreview(cleanedResult) : { preview: '', truncated: false, remainder: '', hiddenLineCount: 0 }
  // Anything not already covered by the title/summary line — the rest of a long
  // result, or screenshots (kept behind the toggle since they're visually heavy).
  const hasExpandableContent = resultTruncated || !!resultImages?.length
  const [expanded, setExpanded] = useState(false)

  const handleToggle = () => {
    if (!hasExpandableContent) return
    setExpanded((prev) => !prev)
  }

  const detailTextClass = success
    ? 'text-gray-500 dark:text-gray-500'
    : 'text-red-600 dark:text-red-400'

  return (
    // No bullet or icon of its own — the parent (ChatMessages) already places a
    // status-colored dot on the shared timeline border, so this reads as a single
    // compact line (title + optional grey detail) matching Claude Code's own CLI output.
    <div className="text-xs font-mono">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full min-w-0 items-start gap-1.5 py-0.5 text-left transition-opacity hover:opacity-80 disabled:hover:opacity-100"
        aria-expanded={expanded}
        disabled={!hasExpandableContent}
      >
        <span className="min-w-0 flex-1 truncate" title={title}>
          <span className={`font-medium ${success ? 'text-gray-800 dark:text-gray-100' : 'text-red-600 dark:text-red-400'}`}>{title}</span>
          {serverName && (
            <span className="ml-1.5 rounded bg-gray-200 px-1 py-0 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              {serverName}
            </span>
          )}
        </span>
        {inProgress && <Loader2 className="mt-px h-3 w-3 shrink-0 animate-spin text-gray-400" />}
        {hasExpandableContent && (expanded
          ? <ChevronDown className="mt-px h-3 w-3 shrink-0 text-gray-400" />
          : <ChevronRight className="mt-px h-3 w-3 shrink-0 text-gray-400" />)}
      </button>

      {summary && (
        <div className={`whitespace-pre-wrap break-words text-[11px] leading-relaxed ${detailTextClass}`}>{summary}</div>
      )}

      {!suppressResult && previewText && (
        <div className={`whitespace-pre-wrap break-words text-[11px] leading-relaxed ${detailTextClass}`}>
          {previewText}
        </div>
      )}
      {!suppressResult && resultTruncated && !expanded && (
        <p className="text-[10px] text-gray-400 dark:text-gray-500">
          {hiddenLineCount > 0 ? `+${hiddenLineCount} more line${hiddenLineCount === 1 ? '' : 's'}` : 'Show more'}
        </p>
      )}

      {/* Beyond the summary line — the rest of a long result, and any screenshots. */}
      {hasExpandableContent && (
        <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden">
            <div className="space-y-2 pt-1 pb-1.5">
              {resultTruncated && (
                <pre className={`max-h-40 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed ${detailTextClass}`}>
                  {remainderText}
                </pre>
              )}
              {resultImages && resultImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {resultImages.map((img, idx) => (
                    <div key={idx} className="flex flex-col gap-1">
                      <img
                        src={img.dataUrl}
                        alt={`Screenshot ${idx + 1}`}
                        className="max-w-[320px] rounded border border-gray-200 dark:border-gray-600"
                      />
                      {onUseImageAsContext && (
                        <button
                          type="button"
                          onClick={() => onUseImageAsContext(img.dataUrl)}
                          className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
                        >
                          <Pin className="h-3 w-3" />
                          Use as context
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
