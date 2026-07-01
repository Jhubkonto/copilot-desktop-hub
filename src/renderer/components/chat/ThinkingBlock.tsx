import { useEffect, useRef, useState } from 'react'
import { Brain, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

interface ThinkingBlockProps {
  content: string
  done: boolean
  label?: string
}

// Cap on the reasoning viewport — roughly six lines. Short content sizes to itself;
// once content exceeds this height it scrolls within the window instead of the
// bubble growing further, so the surrounding layout never shifts unboundedly while
// reasoning streams in, and stays exactly the same size once done — no auto-collapse,
// so there's no jarring shrink right as the answer arrives.
const VIEWPORT_CLASS = 'max-h-[7.5rem]'

export function ThinkingBlock({ content, done, label = 'Reasoning' }: ThinkingBlockProps) {
  const [collapsed, setCollapsed] = useState(false)
  const contentRef = useRef<HTMLPreElement | null>(null)

  const charCount = content.length

  // Keep the viewport scrolled to the latest reasoning text as it streams in.
  useEffect(() => {
    const el = contentRef.current
    if (!el || done || collapsed) return
    el.scrollTop = el.scrollHeight
  }, [content, done, collapsed])

  const handleToggle = () => {
    if (content.length === 0) return
    setCollapsed((prev) => !prev)
  }

  return (
    <div className="message-enter my-1 overflow-hidden rounded-lg border border-purple-200 bg-purple-50 text-xs shadow-sm dark:border-purple-900/60 dark:bg-purple-950/30">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-purple-100 dark:hover:bg-purple-900/30"
        aria-expanded={!collapsed}
        disabled={content.length === 0}
      >
        <Brain className="h-3.5 w-3.5 shrink-0 text-purple-500 dark:text-purple-400" />
        <span className="flex-1 font-medium text-purple-700 dark:text-purple-300">
          {done
            ? `${label} · ${charCount > 2000 ? `>${Math.floor(charCount / 1000)}k` : `~${Math.max(100, Math.round(charCount / 100) * 100)}`} chars`
            : `${label}…`}
        </span>
        {!done && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-purple-400" />}
        {content.length > 0 && (collapsed
          ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-purple-400" />
          : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-purple-400" />)}
      </button>
      {!collapsed && content.length > 0 && (
        <div className="border-t border-purple-200 px-3 py-2 dark:border-purple-900/60">
          <pre
            ref={contentRef}
            className={`${VIEWPORT_CLASS} overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-purple-800 dark:text-purple-200`}
          >
            {content}
          </pre>
        </div>
      )}
    </div>
  )
}
