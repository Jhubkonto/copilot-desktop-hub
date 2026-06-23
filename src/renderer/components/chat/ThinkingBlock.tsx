import { useEffect, useRef, useState } from 'react'
import { Brain, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

interface ThinkingBlockProps {
  content: string
  done: boolean
  label?: string
  isResponseStreaming?: boolean
}

const AUTO_COLLAPSE_DELAY = 2000

export function ThinkingBlock({ content, done, label = 'Reasoning', isResponseStreaming = false }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const userCollapsedRef = useRef(false)
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const charCount = content.length

  // Collapse immediately when response starts streaming
  useEffect(() => {
    if (isResponseStreaming) {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current)
      setExpanded(false)
      userCollapsedRef.current = false
    }
  }, [isResponseStreaming])

  // Auto-expand when block goes live; auto-collapse after done (unless user collapsed it)
  useEffect(() => {
    if (!done) {
      if (!userCollapsedRef.current && content.length > 0) {
        setExpanded(true)
      }
    } else {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = setTimeout(() => {
        setExpanded(false)
      }, AUTO_COLLAPSE_DELAY)
    }

    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current)
    }
  }, [done, content.length])

  const handleToggle = () => {
    if (content.length === 0) return
    const next = !expanded
    setExpanded(next)
    // If user explicitly collapses a live block, remember that choice
    if (!next && !done) {
      userCollapsedRef.current = true
    }
    // If user manually expands, clear the override so auto-collapse can still fire
    if (next) {
      userCollapsedRef.current = false
    }
  }

  return (
    <div className="my-1 overflow-hidden rounded-lg border border-purple-200 bg-purple-50 text-xs shadow-sm dark:border-purple-900/60 dark:bg-purple-950/30">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-purple-100 dark:hover:bg-purple-900/30"
        aria-expanded={expanded}
        disabled={content.length === 0}
      >
        <Brain className="h-3.5 w-3.5 shrink-0 text-purple-500 dark:text-purple-400" />
        <span className="flex-1 font-medium text-purple-700 dark:text-purple-300">
          {done
            ? `${label} · ${charCount > 2000 ? `>${Math.floor(charCount / 1000)}k` : `~${Math.max(100, Math.round(charCount / 100) * 100)}`} chars`
            : `${label}…`}
        </span>
        {!done && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-purple-400" />}
        {content.length > 0 && (expanded
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-purple-400" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-purple-400" />)}
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: expanded && content.length > 0 ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-purple-200 px-3 py-2 dark:border-purple-900/60">
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-purple-800 dark:text-purple-200">
              {content}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
