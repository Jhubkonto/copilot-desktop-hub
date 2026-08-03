import { useEffect, useRef, useState } from 'react'
import { NexyIcon } from './ui/icons'

interface LogEntry {
  tag: string
  message: string
  ts: number
  id: number
}

let _entryId = 0

export function AndroidLogPanel({ enabled }: { enabled: boolean }) {
  const [visible, setVisible] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [entries, setEntries] = useState<LogEntry[]>([])
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (typeof window.api.onAndroidLog !== 'function') return
    const unsub = window.api.onAndroidLog((data) => {
      setVisible(true)
      setEntries((prev) => {
        const next = [...prev, { ...data, id: ++_entryId }]
        return next.length > 500 ? next.slice(next.length - 500) : next
      })
    })
    return () => unsub()
  }, [enabled])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries])

  if (!enabled || !visible) return null

  return (
    <div className={`fixed bottom-4 right-4 z-50 flex w-[520px] flex-col rounded-nexy-sm border-2 border-nexy-border bg-nexy-frame shadow-nexy ${minimized ? '' : 'max-h-[380px]'}`}>
      <div className="flex shrink-0 items-center justify-between border-b-2 border-nexy-border bg-nexy-surface px-3 py-2">
        <span className="nexy-font-status text-nexy-success">Android Debug Log</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setEntries([])}
            className="rounded-nexy-sm border border-transparent p-1 text-nexy-muted hover:border-nexy-border hover:bg-nexy-recessed hover:text-nexy-text"
            title="Clear"
          >
            <NexyIcon name="delete" className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setMinimized((v) => !v)}
            className="rounded-nexy-sm border border-transparent p-1 text-nexy-muted hover:border-nexy-border hover:bg-nexy-recessed hover:text-nexy-text"
            title={minimized ? 'Expand' : 'Minimize'}
          >
            <NexyIcon name={minimized ? 'expand' : 'minimize'} className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="rounded-nexy-sm border border-transparent p-1 text-nexy-muted hover:border-nexy-border hover:bg-nexy-recessed hover:text-nexy-text"
            title="Dismiss"
          >
            <NexyIcon name="close" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {!minimized && (
        <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] space-y-0.5">
          {entries.map((e) => (
            <div key={e.id} className="flex gap-2 leading-snug">
              <span className="shrink-0 text-nexy-muted">{new Date(e.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              <span className="shrink-0 text-nexy-warning">[{e.tag}]</span>
              <span className="break-all text-nexy-highlight">{e.message}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  )
}
