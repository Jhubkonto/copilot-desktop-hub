import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Button } from './ui/primitives'

export function RevisePlanControl({
  reportId,
  disabled,
  running,
  onRevise,
  modelPicker,
}: {
  reportId: string
  disabled: boolean
  running: boolean
  onRevise: (reportId: string, notes: string) => void
  modelPicker?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (containerRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-model-picker-menu]')) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        className="text-[11px] px-2 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800/60"
      >
        {running ? 'Revising...' : 'Revise plan'}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1.5 w-72 space-y-1.5 rounded-md border border-gray-300 bg-white p-2 shadow-lg dark:border-gray-600 dark:bg-gray-900">
          <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-300" htmlFor={`revise-notes-${reportId}`}>
            What should the plan do differently?
          </label>
          <textarea
            id={`revise-notes-${reportId}`}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="e.g. Look in src/android instead of the desktop code"
            rows={2}
            autoFocus
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-800 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100"
          />
          {modelPicker}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { onRevise(reportId, notes); setOpen(false); setNotes('') }}
              className="text-[11px] px-2 py-1 rounded-md border border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
            >
              Send revision
            </button>
            <Button variant="ghost" onClick={() => { setOpen(false); setNotes('') }} className="text-[11px] px-2 py-1">
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
