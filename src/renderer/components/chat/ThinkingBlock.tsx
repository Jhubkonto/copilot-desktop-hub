import { useEffect, useRef, useState } from 'react'
import { Brain, ChevronDown, ChevronRight, Loader2, Maximize2 } from 'lucide-react'
import { ModalShell } from '../ui/primitives'

interface ThinkingBlockProps {
  content: string
  done: boolean
  label?: string
}

// Cap on the reasoning viewport — roughly four lines (13px text, leading-relaxed ≈ 21px/line).
// Short content sizes to itself; once content exceeds this height it scrolls within the window
// instead of the bubble growing further, so the surrounding layout never shifts unboundedly while
// reasoning streams in, and stays exactly the same size once done — no auto-collapse, so there's
// no jarring shrink right as the answer arrives. The fullscreen viewer below (mirrors Android's
// ThinkingFullscreenDialog) is the only way to read a long completed block past this cap.
const VIEWPORT_CLASS = 'max-h-[5.25rem]'

export function ThinkingBlock({ content, done, label = 'Reasoning' }: ThinkingBlockProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [showFullscreen, setShowFullscreen] = useState(false)
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
    // No border of its own — the parent (ChatMessages) wraps a whole sequence of these
    // (reasoning, tool calls, final text) in one shared left-border-accent container, so
    // they read as a single continuous chained timeline rather than separate segments.
    <div className="message-enter text-xs">
      <div className="flex w-full items-center gap-2 py-1">
        <button
          type="button"
          onClick={handleToggle}
          className="flex flex-1 min-w-0 items-center gap-2 text-left transition-opacity hover:opacity-80 disabled:hover:opacity-100"
          aria-expanded={!collapsed}
          disabled={content.length === 0}
        >
          <Brain className="h-3.5 w-3.5 shrink-0 text-purple-500 dark:text-purple-400" />
          <span className="flex-1 font-medium text-gray-800 dark:text-gray-100">
            {done
              ? `${label} · ${charCount > 2000 ? `>${Math.floor(charCount / 1000)}k` : `~${Math.max(100, Math.round(charCount / 100) * 100)}`} chars`
              : `${label}…`}
          </span>
          {!done && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-purple-400" />}
        </button>
        {!collapsed && content.length > 0 && (
          <button
            type="button"
            onClick={() => setShowFullscreen(true)}
            className="shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            aria-label="View full reasoning text"
            title="View full reasoning text"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        )}
        {content.length > 0 && (
          <button type="button" onClick={handleToggle} className="shrink-0 text-gray-400" aria-label={collapsed ? 'Expand reasoning' : 'Collapse reasoning'}>
            {collapsed
              ? <ChevronRight className="h-3.5 w-3.5" />
              : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      {content.length > 0 && (
        <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}>
          <div className="overflow-hidden">
            <pre
              ref={contentRef}
              className={`${VIEWPORT_CLASS} overflow-y-auto whitespace-pre-wrap py-1 text-[13px] leading-relaxed text-gray-600 dark:text-gray-400`}
            >
              {content}
            </pre>
          </div>
        </div>
      )}
      {showFullscreen && (
        <ModalShell
          title={label}
          ariaLabel={`Full ${label.toLowerCase()} text`}
          maxWidth="max-w-3xl"
          height="h-[80vh]"
          bodyClassName="flex-1 min-h-0 overflow-y-auto p-5"
          onClose={() => setShowFullscreen(false)}
        >
          <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">
            {content}
          </pre>
        </ModalShell>
      )}
    </div>
  )
}
