import { useEffect, useRef, useState } from 'react'
import { Check, Clipboard, XCircle } from 'lucide-react'
import { ResizeHandle } from './ResizeHandle'

const ANSI_RE = new RegExp(String.raw`\x1b\[[0-9;]*m`, 'g')
type CopyState = 'idle' | 'copied' | 'failed'

function stripAnsi(line: string): string {
  return line.replace(ANSI_RE, '')
}

interface BuildLogProps {
  lines: string[]
  running?: boolean
  /** Max height in px. Defaults to 320. Pass 0 for free-grow (no max-height). */
  maxHeightPx?: number
  /** Show a vertical ResizeHandle at the bottom. */
  resizable?: boolean
  className?: string
}

export function BuildLog({ lines, running = false, maxHeightPx = 320, resizable = false, className = '' }: BuildLogProps) {
  const scrollRef = useRef<HTMLPreElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [height, setHeight] = useState(maxHeightPx || 320)
  const [copyState, setCopyState] = useState<CopyState>('idle')

  useEffect(() => {
    if (maxHeightPx !== 0) setHeight(maxHeightPx)
  }, [maxHeightPx])

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines.length, autoScroll])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (!atBottom) setAutoScroll(false)
  }

  const jumpToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    setAutoScroll(true)
  }

  useEffect(() => {
    if (copyState === 'idle') return
    const timeout = window.setTimeout(() => setCopyState('idle'), 1600)
    return () => window.clearTimeout(timeout)
  }, [copyState])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const styleHeight = maxHeightPx === 0 ? undefined : height

  return (
    <div ref={containerRef} className={`relative rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden ${className}`} style={styleHeight ? { height: styleHeight } : undefined}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
          Output
          {running && <span className="text-blue-500 animate-pulse text-[10px]">● running</span>}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400">{lines.length} lines</span>
          <button
            onClick={() => void handleCopy()}
            disabled={lines.length === 0}
            className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border transition-colors disabled:opacity-40 ${
              copyState === 'copied'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                : copyState === 'failed'
                  ? 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300'
                  : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {copyState === 'copied' ? <Check className="h-3 w-3" /> : copyState === 'failed' ? <XCircle className="h-3 w-3" /> : <Clipboard className="h-3 w-3" />}
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Log body */}
      <pre
        ref={scrollRef}
        onScroll={handleScroll}
        className="code-scrollbar overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-gray-100 bg-gray-950 p-2.5 selection:bg-blue-500/30"
        style={styleHeight ? { height: styleHeight - 34 } : { maxHeight: 'none' }}
      >
        {lines.length === 0 ? (
          <span className="text-gray-500">No output yet.</span>
        ) : (
          lines.map((line, i) => (
            <span key={i} className="block">{stripAnsi(line)}</span>
          ))
        )}
      </pre>

      {/* Jump to bottom button */}
      {!autoScroll && (
        <button
          onClick={jumpToBottom}
          className="absolute bottom-8 right-3 z-10 px-2 py-1 rounded-md bg-blue-600 text-white text-[10px] shadow-md hover:bg-blue-700"
        >
          ↓ Bottom
        </button>
      )}

      {/* Resize handle */}
      {resizable && (
        <ResizeHandle
          direction="vertical"
          containerRef={containerRef}
          onSetSize={setHeight}
          align="end"
          minSize={80}
          maxSize={() => window.innerHeight * 0.7}
        />
      )}
    </div>
  )
}
