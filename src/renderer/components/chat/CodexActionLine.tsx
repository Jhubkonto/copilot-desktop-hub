// Codex CLI's own terminal output shows each reasoning burst / command as a short
// bulleted line ("Running <command>" -> "Ran <command>", indented output beneath) —
// this mirrors that instead of the boxed ThinkingBlock/ToolCallBlock cards used for
// every other backend, so a Codex turn reads like Codex's own CLI session.
import { stripAnsiEscapes } from '../../../shared/ansi'
import { StreamingFadeText } from './StreamingFadeText'

const RESULT_PREVIEW_LINES = 3
const RESULT_PREVIEW_CHARS = 240

function buildPreview(result: string): { preview: string; hiddenLineCount: number } {
  const lines = result.split('\n')
  const lineLimited = lines.length > RESULT_PREVIEW_LINES
  let preview = lineLimited ? lines.slice(0, RESULT_PREVIEW_LINES).join('\n') : result
  const hiddenLineCount = lineLimited ? lines.length - RESULT_PREVIEW_LINES : 0
  if (preview.length > RESULT_PREVIEW_CHARS) preview = `${preview.slice(0, RESULT_PREVIEW_CHARS)}…`
  return { preview, hiddenLineCount }
}

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
  if (props.kind === 'reasoning') {
    if (!props.content) return null
    return (
      <div className="flex items-start gap-1.5 text-xs">
        <span className="mt-px shrink-0 text-gray-400 dark:text-gray-500">•</span>
        <span className="min-w-0 whitespace-pre-wrap break-words text-gray-600 dark:text-gray-400"><StreamingFadeText text={props.content} /></span>
      </div>
    )
  }

  const { toolName, args, result, success = true, inProgress = false } = props
  const arg = primaryArg(args)
  const verb = inProgress ? 'Running' : success ? 'Ran' : 'Failed:'
  const cleanedResult = result ? stripAnsiEscapes(result) : result
  const { preview, hiddenLineCount } = cleanedResult ? buildPreview(cleanedResult) : { preview: '', hiddenLineCount: 0 }
  // Full, untruncated content shown on hover via the native title tooltip — the preview
  // below is capped for layout, this lets the user read the whole tool call without a click.
  const fullContent = [`${verb} ${toolName}${arg ? ` ${arg}` : ''}`, cleanedResult].filter(Boolean).join('\n\n')

  return (
    <div className="text-xs font-mono" title={fullContent}>
      <div className="flex items-start gap-1.5">
        <span className="mt-px shrink-0 text-gray-400 dark:text-gray-500">•</span>
        <span className="min-w-0 truncate">
          <span className={`font-medium ${success ? 'text-gray-800 dark:text-gray-100' : 'text-red-600 dark:text-red-400'}`}>{verb}</span>
          {' '}
          <span className="text-gray-600 dark:text-gray-400">{toolName}</span>
          {arg && <span className="text-gray-500 dark:text-gray-500"> {arg}</span>}
        </span>
      </div>
      {preview && (
        <div className={`whitespace-pre-wrap break-words pl-4 text-[11px] leading-relaxed ${success ? 'text-gray-500 dark:text-gray-500' : 'text-red-600 dark:text-red-400'}`}>
          <span className="text-gray-400 dark:text-gray-600">{'└ '}</span>
          <StreamingFadeText text={preview} />
          {hiddenLineCount > 0 && <span className="text-gray-400 dark:text-gray-600"> (+{hiddenLineCount} more line{hiddenLineCount === 1 ? '' : 's'})</span>}
        </div>
      )}
    </div>
  )
}
