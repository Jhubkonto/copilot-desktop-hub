import { useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Globe, Loader2, Pin } from 'lucide-react'

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

export function ToolCallBlock({
  toolName, serverName, args, result, success = true, inProgress = false, resultImages, onUseImageAsContext
}: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false)

  const hasDetails = (args && Object.keys(args).length > 0) || result || resultImages?.length

  return (
    <div className="my-1 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 text-xs dark:border-gray-700 dark:bg-gray-800/60">
      <button
        type="button"
        onClick={() => hasDetails && setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-700/60"
        aria-expanded={expanded}
        disabled={!hasDetails}
      >
        <Globe className="h-3.5 w-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
        <span className="flex-1 truncate font-mono font-medium text-gray-800 dark:text-gray-100">
          {toolName}
          {inProgress && (
            <span className="font-normal text-gray-400 dark:text-gray-500"> (running...)</span>
          )}
          {serverName && (
            <span className="font-normal text-gray-400 dark:text-gray-500"> — {serverName}</span>
          )}
        </span>
        {inProgress ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-400" />
        ) : success ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
        )}
        {hasDetails && (expanded
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />)}
      </button>
      {expanded && hasDetails && (
        <div className="space-y-2 border-t border-gray-200 px-3 py-2 dark:border-gray-700">
          {args && Object.keys(args).length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Arguments</p>
              <pre className="max-h-32 overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded bg-white p-2 text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}
          {result && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Result</p>
              <pre className={`max-h-48 overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded p-2 text-xs ${
                success
                  ? 'bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-300'
                  : 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
              }`}>
                {result.length > 2000 ? `${result.slice(0, 2000)}\n…(truncated)` : result}
              </pre>
            </div>
          )}
          {resultImages && resultImages.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Screenshots</p>
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
            </div>
          )}
        </div>
      )}
    </div>
  )
}
