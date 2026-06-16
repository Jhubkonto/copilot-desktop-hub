import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ModalShell } from './ui/primitives'

interface DeleteSelfHealReportDialogProps {
  reportTitle: string
  deleting: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteSelfHealReportDialog({
  reportTitle,
  deleting,
  onConfirm,
  onCancel,
}: DeleteSelfHealReportDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleting) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [deleting, onCancel])

  return (
    <ModalShell
      title="Delete Self-Heal report"
      ariaLabel={`Delete ${reportTitle}`}
      maxWidth="max-w-md"
      height=""
      bodyClassName="p-6 space-y-4"
      onClose={deleting ? () => {} : onCancel}
      footer={
        <>
          <Button ref={cancelRef} onClick={onCancel} disabled={deleting} className="px-4 py-2 text-sm">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            disabled={deleting}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 dark:text-white"
          >
            {deleting ? 'Deleting...' : 'Delete Report'}
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <Trash2 className="w-5 h-5 text-red-500" />
        </div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Delete &ldquo;{reportTitle}&rdquo;?
        </h2>
      </div>

      <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
        <p>This will remove the captured report, investigation notes, Self-Heal run history, staged diffs, and generated report artifacts.</p>
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 font-medium">
        This action cannot be undone.
      </p>
    </ModalShell>
  )
}
