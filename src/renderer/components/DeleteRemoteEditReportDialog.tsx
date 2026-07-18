import { ConfirmDialog } from './ui/ConfirmDialog'

interface DeleteRemoteEditReportDialogProps {
  reportTitle: string
  deleting: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteRemoteEditReportDialog({
  reportTitle,
  deleting,
  onConfirm,
  onCancel,
}: DeleteRemoteEditReportDialogProps) {
  return (
    <ConfirmDialog
      title="Delete change request"
      ariaLabel={`Delete ${reportTitle}`}
      heading={<>Delete &ldquo;{reportTitle}&rdquo;?</>}
      confirmLabel={deleting ? 'Deleting...' : 'Delete request'}
      busy={deleting}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
        <p>This removes the request, investigation notes, staged diffs, verification history, and generated artifacts.</p>
      </div>
    </ConfirmDialog>
  )
}
