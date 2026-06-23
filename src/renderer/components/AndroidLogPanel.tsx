import { useEffect, useRef, useState } from 'react'
import { X, Trash2, ChevronDown, ChevronUp } from 'lucide-react'

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
    <div className={`fixed bottom-4 right-4 z-50 w-[520px] flex flex-col rounded-xl border border-gray-300 bg-gray-950 shadow-2xl dark:border-gray-700 ${minimized ? '' : 'max-h-[380px]'}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 shrink-0">
        <span className="text-xs font-semibold text-green-400 font-mono">Android Debug Log</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setEntries([])}
            className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300"
            title="Clear"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setMinimized((v) => !v)}
            className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300"
            title={minimized ? 'Expand' : 'Minimize'}
          >
            {minimized ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {!minimized && (
        <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] space-y-0.5">
          {entries.map((e) => (
            <div key={e.id} className="flex gap-2 leading-snug">
              <span className="shrink-0 text-gray-600">{new Date(e.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              <span className="shrink-0 text-yellow-400">[{e.tag}]</span>
              <span className="text-green-300 break-all">{e.message}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  )
}
