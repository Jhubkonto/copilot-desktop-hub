import { useState } from 'react'
import { Brain, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

interface ThinkingBlockProps {
  content: string
  done: boolean
  label?: string
}

export function ThinkingBlock({ content, done, label = 'Reasoning' }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false)

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length

  return (
    <div className="my-1 overflow-hidden rounded-lg border border-purple-200 bg-purple-50 text-xs shadow-sm dark:border-purple-900/60 dark:bg-purple-950/30">
      <button
        type="button"
        onClick={() => content.length > 0 && setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-purple-100 dark:hover:bg-purple-900/30"
        aria-expanded={expanded}
        disabled={content.length === 0}
      >
        <Brain className="h-3.5 w-3.5 shrink-0 text-purple-500 dark:text-purple-400" />
        <span className="flex-1 font-medium text-purple-700 dark:text-purple-300">
          {done
            ? `${label} · ${wordCount} word${wordCount !== 1 ? 's' : ''}`
            : `${label}…`}
        </span>
        {!done && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-purple-400" />}
        {content.length > 0 && (expanded
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-purple-400" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-purple-400" />)}
      </button>
      {expanded && content.length > 0 && (
        <div className="border-t border-purple-200 px-3 py-2 dark:border-purple-900/60">
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-purple-800 dark:text-purple-200">
            {content}
          </pre>
        </div>
      )}
    </div>
  )
}
