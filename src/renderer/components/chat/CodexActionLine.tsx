// Codex CLI's own terminal output shows each reasoning burst / command as a short
// bulleted line ("Running <command>" -> "Ran <command>", indented output beneath) —
// this mirrors that instead of the boxed ThinkingBlock/ToolCallBlock cards used for
// every other backend, so a Codex turn reads like Codex's own CLI session.
import { useEffect, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { estimateTextTokens, formatEstimatedTokens } from '../../../shared/token-estimate'
import { ModalShell } from '../ui/primitives'
import { StreamingFadeText } from './StreamingFadeText'
import { buildToolResultPreview } from './tool-result-preview'

function primaryArg(args: Record<string, unknown> | undefined): string {
  if (!args) return ''
  if (typeof args.command === 'string') return args.command
  if (typeof args.path === 'string') return args.path
  const entries = Object.entries(args).filter(([, v]) => v !== null && v !== undefined)
  if (entries.length === 0) return ''
  return entries.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')
}

interface CodexReasoningLineProps {
  kind: 'reasoning'
  content: string
}

interface CodexToolLineProps {
  kind: 'tool'
  toolName: string
  args?: Record<string, unknown>
  result?: string
  success?: boolean
  inProgress?: boolean
}

type CodexActionLineProps = CodexReasoningLineProps | CodexToolLineProps

export function CodexActionLine(props: CodexActionLineProps) {
  const [showFullContent, setShowFullContent] = useState(false)

  useEffect(() => {
    if (!showFullContent) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowFullContent(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showFullContent])

  if (props.kind === 'reasoning') {
    if (!props.content) return null
    const tokenLabel = formatEstimatedTokens(estimateTextTokens(props.content))
    return (
      <div className="text-xs">
        <div className="flex items-start gap-1.5" aria-live="polite">
          <span className="mt-px shrink-0 text-gray-400 dark:text-gray-500">•</span>
          <span className="font-medium text-gray-500 dark:text-gray-400">Reasoning summary · {tokenLabel}</span>
        </div>
        <div className="flex items-start gap-1.5 pl-4">
          <span className="sr-only">Reasoning content:</span>
          <span className="min-w-0 whitespace-pre-wrap break-words text-gray-600 dark:text-gray-400"><StreamingFadeText text={props.content} /></span>
        </div>
      </div>
    )
  }

  const { toolName, args, result, success = true, inProgress = false } = props
  const arg = primaryArg(args)
  const verb = inProgress ? 'Running' : success ? 'Ran' : 'Failed:'
  // Only the bounded prefix is processed during normal transcript rendering. The
  // complete result is stripped when the details modal is explicitly opened.
  const { preview, hiddenLineCount, cleanedResult } = result
    ? buildToolResultPreview(result, showFullContent)
    : { preview: '', hiddenLineCount: 0, cleanedResult: undefined }
  const invocation = `${verb} ${toolName}${arg ? ` ${arg}` : ''}`

  return (
    <div className="text-xs font-mono">
      <div className="flex items-start gap-1.5">
        <span className="mt-px shrink-0 text-gray-400 dark:text-gray-500">•</span>
        <span className="min-w-0 flex-1 truncate">
          <span className={`font-medium ${success ? 'text-gray-800 dark:text-gray-100' : 'text-red-600 dark:text-red-400'}`}>{verb}</span>
          {' '}
          <span className="text-gray-600 dark:text-gray-400">{toolName}</span>
          {arg && <span className="text-gray-500 dark:text-gray-500"> {arg}</span>}
        </span>
        <button
          type="button"
          onClick={() => setShowFullContent(true)}
          className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          aria-label={`View full details for ${toolName}`}
          title="View full command"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {preview && (
        <div className={`whitespace-pre-wrap break-words pl-4 text-[11px] leading-relaxed ${success ? 'text-gray-500 dark:text-gray-500' : 'text-red-600 dark:text-red-400'}`}>
          <span className="text-gray-400 dark:text-gray-600">{'└ '}</span>
          <StreamingFadeText text={preview} />
          {hiddenLineCount > 0 && <span className="text-gray-400 dark:text-gray-600"> (+{hiddenLineCount} more line{hiddenLineCount === 1 ? '' : 's'})</span>}
        </div>
      )}
      {showFullContent && (
        <ModalShell
          title={`${toolName} details`}
          description={inProgress ? 'Command in progress' : success ? 'Command completed' : 'Command failed'}
          ariaLabel={`Full details for ${toolName}`}
          maxWidth="max-w-4xl"
          height="h-[84vh]"
          bodyClassName="flex-1 min-h-0 overflow-y-auto p-5"
          onClose={() => setShowFullContent(false)}
        >
          <div className="space-y-5">
            <section>
              <h3 className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                Invocation
              </h3>
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-4 text-xs leading-relaxed text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                {invocation}
              </pre>
            </section>
            <section>
              <h3 className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                Output
              </h3>
              {cleanedResult ? (
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-4 text-xs leading-relaxed text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                  {cleanedResult}
                </pre>
              ) : (
                <p className="font-sans text-xs text-gray-400 dark:text-gray-500">No output yet.</p>
              )}
            </section>
          </div>
        </ModalShell>
      )}
    </div>
  )
}
