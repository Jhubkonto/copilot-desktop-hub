import { useState } from 'react'
import { Brain, ChevronDown, ChevronRight, Loader2, Maximize2 } from 'lucide-react'
import { ModalShell } from '../ui/primitives'
import { StreamingFadeText } from './StreamingFadeText'

interface ThinkingBlockProps {
  content: string
  done: boolean
  label?: string
}

export function ThinkingBlock({ content, done, label = 'Reasoning' }: ThinkingBlockProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [showFullscreen, setShowFullscreen] = useState(false)

  const charCount = content.length

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
            <pre className="line-clamp-3 whitespace-pre-wrap py-1 text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">
              <StreamingFadeText text={content} />
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
