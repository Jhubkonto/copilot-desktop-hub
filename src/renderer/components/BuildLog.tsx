import { useEffect, useRef, useState } from 'react'
import { ResizeHandle } from './ResizeHandle'
import { NexyIcon } from './ui/icons'

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
    <div ref={containerRef} className={`relative overflow-hidden rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised shadow-nexy ${className}`} style={styleHeight ? { height: styleHeight } : undefined}>
      {/* Header bar */}
      <div className="flex items-center justify-between border-b-2 border-nexy-border bg-nexy-surface px-3 py-1.5 shrink-0">
        <span className="nexy-font-status flex items-center gap-1.5 text-nexy-muted">
          Output
          {running && <span className="inline-flex items-center gap-1 text-[10px] text-nexy-activity"><NexyIcon name="busy" motion="pulse" className="h-3 w-3" /> running</span>}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-nexy-muted">{lines.length} lines</span>
          <button
            onClick={() => void handleCopy()}
            disabled={lines.length === 0}
            className={`inline-flex items-center gap-1 rounded-nexy-sm border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-40 ${
              copyState === 'copied'
                ? 'border-nexy-success bg-nexy-recessed text-nexy-success'
                : copyState === 'failed'
                  ? 'border-nexy-error bg-nexy-recessed text-nexy-error'
                  : 'border-nexy-border bg-nexy-raised text-nexy-muted hover:bg-nexy-recessed hover:text-nexy-text'
            }`}
          >
            <NexyIcon name={copyState === 'copied' ? 'check' : copyState === 'failed' ? 'error' : 'clipboard'} className="h-3 w-3" />
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Log body */}
      <pre
        ref={scrollRef}
        onScroll={handleScroll}
        className="code-scrollbar overflow-y-auto whitespace-pre-wrap break-words bg-nexy-frame p-2.5 font-mono text-[10px] leading-relaxed text-nexy-highlight selection:bg-nexy-accent/30"
        style={styleHeight ? { height: styleHeight - 34 } : { maxHeight: 'none' }}
      >
        {lines.length === 0 ? (
          <span className="text-nexy-muted">No output yet.</span>
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
          className="absolute bottom-8 right-3 z-10 rounded-nexy-sm border-2 border-nexy-border bg-nexy-accent px-2 py-1 text-[10px] text-nexy-on-accent shadow-nexy hover:brightness-110"
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
