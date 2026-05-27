import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'

interface DeleteProjectDialogProps {
  projectName: string
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteProjectDialog({ projectName, onConfirm, onCancel }: DeleteProjectDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={`Delete ${projectName}`}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-red-500" />
          </div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Delete &ldquo;{projectName}&rdquo;?
          </h2>
        </div>

        <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
          <p>Deleting this project will remove it and all its settings. Conversations inside the project will be moved to the general chat list.</p>
        </div>

        <p className="text-xs text-gray-400 dark:text-gray-500 font-medium">
          This action cannot be undone.
        </p>

        <div className="flex justify-end gap-3 pt-1">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors"
          >
            Delete Project
          </button>
        </div>
      </div>
    </div>
  )
}
