import { ConfirmDialog } from '../ui/ConfirmDialog'

interface DiscardWorkflowRunDialogProps {
  runTitle: string
  onConfirm: () => void
  onCancel: () => void
}

export function DiscardWorkflowRunDialog({ runTitle, onConfirm, onCancel }: DiscardWorkflowRunDialogProps) {
  return (
    <ConfirmDialog
      title={`Discard "${runTitle || 'this workflow'}"?`}
      confirmLabel="Discard Workflow"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p className="text-sm text-gray-600 dark:text-gray-300">
        This plan and its step progress will be permanently removed.
      </p>
    </ConfirmDialog>
  )
}
