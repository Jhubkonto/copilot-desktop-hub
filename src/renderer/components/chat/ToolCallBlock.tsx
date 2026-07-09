import { useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Globe, Loader2, Pin } from 'lucide-react'
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

function formatArgValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return String(value)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

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

export function ToolCallBlock({
  toolName, serverName, args, result, success = true, inProgress = false, resultImages, onUseImageAsContext
}: ToolCallBlockProps) {
  const argEntries = args ? Object.entries(args) : []
  const cleanedResult = result ? stripAnsiEscapes(result) : result
  const hasDetails = argEntries.length > 0 || !!cleanedResult || !!resultImages?.length
  const resultPreview = cleanedResult?.replace(/\s+/g, ' ').trim()

  const { preview: previewText, truncated: resultTruncated, remainder: remainderText, hiddenLineCount } =
    cleanedResult ? buildResultPreview(cleanedResult) : { preview: '', truncated: false, remainder: '', hiddenLineCount: 0 }
  // Anything the always-visible preview above doesn't already show — more result content,
  // or screenshots (kept behind the toggle since they're visually heavy).
  const hasExpandableContent = resultTruncated || !!resultImages?.length
  const [expanded, setExpanded] = useState(false)

  const handleToggle = () => {
    if (!hasExpandableContent) return
    setExpanded((prev) => !prev)
  }

  const resultTextClass = success
    ? 'text-gray-500 dark:text-gray-500'
    : 'text-red-600 dark:text-red-400'

  return (
    // No border of its own — the parent (ChatMessages) wraps a whole sequence of these
    // (reasoning, tool calls, final text) in one shared left-border-accent container, so
    // they read as a single continuous chained timeline rather than separate segments.
    <div className="text-xs">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-2 py-1 text-left transition-opacity hover:opacity-80 disabled:hover:opacity-100"
        aria-expanded={expanded}
        disabled={!hasExpandableContent}
      >
        <Globe className="h-3.5 w-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
        <span className="min-w-0 flex-1 flex items-center gap-1.5 overflow-hidden">
          <span className="shrink-0 font-mono font-medium text-gray-800 dark:text-gray-100 truncate max-w-[40%]">{toolName}</span>
          {serverName && (
            <span className="shrink-0 rounded bg-gray-200 px-1 py-0 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              {serverName}
            </span>
          )}
          <span className="truncate text-[11px] text-gray-500 dark:text-gray-400">
            {inProgress
              ? 'Running...'
              : success
                ? (resultPreview || 'Done')
                : (resultPreview || 'Failed')}
          </span>
        </span>
        {inProgress ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-400" />
        ) : success ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
        )}
        {hasExpandableContent && (expanded
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />)}
      </button>

      {/* Always visible — args and a short result preview, no click required. */}
      {hasDetails && (
        <div className="space-y-1 pb-1">
          {argEntries.length > 0 && (
            <div className="space-y-0.5">
              {argEntries.map(([key, value]) => (
                <div key={key} className="flex gap-1.5 min-w-0">
                  <span className="shrink-0 font-mono text-gray-500 dark:text-gray-400">{key}:</span>
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-gray-600 dark:text-gray-400"
                    title={formatArgValue(value)}
                  >
                    {formatArgValue(value)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {result && (
            <pre className={`whitespace-pre-wrap font-mono text-[11px] leading-relaxed ${resultTextClass}`}>
              {previewText}
            </pre>
          )}
          {resultTruncated && !expanded && (
            <p className="text-[10px] text-gray-400 dark:text-gray-500">
              {hiddenLineCount > 0 ? `+${hiddenLineCount} more line${hiddenLineCount === 1 ? '' : 's'}` : 'Show more'}
            </p>
          )}
        </div>
      )}

      {/* Beyond the preview — the rest of a long result, and any screenshots. */}
      {hasExpandableContent && (
        <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden">
            <div className="space-y-2 pb-1.5">
              {resultTruncated && (
                <pre className={`max-h-40 overflow-x-auto overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed ${resultTextClass}`}>
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
