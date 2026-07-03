import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { BookOpen, X } from 'lucide-react'
import { Button, useFocusTrap } from './ui/primitives'
import { ResizeHandle } from './ResizeHandle'
import { VoiceInputButton } from './chat/VoiceInputButton'
import { PromptLibraryModal } from './PromptLibraryModal'

const DEFAULT_HEIGHT = 480
const MIN_HEIGHT = 320
const MAX_HEIGHT = () => Math.floor(window.innerHeight * 0.9)

export function RevisePlanControl({
  reportId,
  projectId,
  disabled,
  running,
  onRevise,
  modelPicker,
  planPreview,
  triggerClassName,
}: {
  reportId: string
  projectId?: string | null
  disabled: boolean
  running: boolean
  onRevise: (reportId: string, notes: string) => void
  modelPicker?: ReactNode
  planPreview?: ReactNode
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [view, setView] = useState<'revise' | 'plan'>('revise')
  const [showPromptLibrary, setShowPromptLibrary] = useState(false)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const panelRef = useRef<HTMLDivElement>(null)
  const notesRef = useRef<HTMLTextAreaElement>(null)
  useFocusTrap(open ? panelRef : { current: null })

  const close = () => { setOpen(false); setNotes(''); setView('revise') }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={
          triggerClassName ??
          'text-[11px] px-2 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800/60'
        }
      >
        {running ? 'Revising...' : 'Revise plan'}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          data-testid="revise-plan-backdrop"
          onClick={close}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Revise plan"
            className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800"
            style={{ height }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 px-5 py-3 dark:border-gray-700">
              <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900">
                <button
                  type="button"
                  onClick={() => setView('revise')}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    view === 'revise'
                      ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  Revise plan
                </button>
                {planPreview && (
                  <button
                    type="button"
                    onClick={() => setView('plan')}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      view === 'plan'
                        ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                  >
                    View current plan
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={close}
                className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {view === 'plan' ? (
              <>
                <div className="flex-1 min-h-0 overflow-y-auto p-5">{planPreview}</div>
                <div className="flex shrink-0 justify-end border-t border-gray-200 px-5 py-3 dark:border-gray-700">
                  <Button variant="secondary" onClick={() => setView('revise')}>
                    Back to revise plan
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex-1 min-h-0 p-5">
                  <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300" htmlFor={`revise-notes-${reportId}`}>
                    What should the plan do differently?
                  </label>
                  <div className="flex h-[calc(100%-1.75rem)] flex-col rounded-xl border border-gray-200 bg-white focus-within:border-transparent focus-within:ring-2 focus-within:ring-gray-400 dark:border-gray-600 dark:bg-gray-900 dark:focus-within:ring-gray-500">
                    <textarea
                      ref={notesRef}
                      id={`revise-notes-${reportId}`}
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="e.g. Look in src/android instead of the desktop code"
                      autoFocus
                      className="chat-input min-h-0 w-full flex-1 resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:text-gray-100"
                    />
                    <div className="flex shrink-0 items-center justify-between px-2 pb-2">
                      {projectId !== undefined ? (
                        <button
                          type="button"
                          onClick={() => setShowPromptLibrary(true)}
                          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                          title="Insert prompt from library"
                          aria-label="Insert prompt from library"
                        >
                          <BookOpen className="h-4 w-4" />
                        </button>
                      ) : <span />}
                      <div className="flex items-center gap-1">
                        {modelPicker}
                        <VoiceInputButton
                          onText={(text) => setNotes((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text))}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-700">
                  <Button variant="ghost" onClick={close}>
                    Cancel
                  </Button>
                  <button
                    onClick={() => { onRevise(reportId, notes); close() }}
                    className="rounded-md border border-blue-300 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
                  >
                    Send revision
                  </button>
                </div>
              </>
            )}

            <ResizeHandle
              direction="vertical"
              align="end"
              containerRef={panelRef}
              onSetSize={setHeight}
              minSize={MIN_HEIGHT}
              maxSize={MAX_HEIGHT}
            />
          </div>
        </div>
      )}
      {showPromptLibrary && (
        <PromptLibraryModal
          projectId={projectId ?? null}
          draftContent={notes}
          onInsert={(content) => {
            setNotes((prev) => (prev ? `${prev}\n${content}` : content))
            setShowPromptLibrary(false)
            notesRef.current?.focus()
          }}
          onClose={() => setShowPromptLibrary(false)}
        />
      )}
    </>
  )
}
