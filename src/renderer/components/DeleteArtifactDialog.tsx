import { ConfirmDialog } from './ui/ConfirmDialog'

interface DeleteArtifactDialogProps {
  artifactTitle: string
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteArtifactDialog({ artifactTitle, onConfirm, onCancel }: DeleteArtifactDialogProps) {
  return (
    <ConfirmDialog
      title={`Delete "${artifactTitle}"?`}
      confirmLabel="Delete Artifact"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p className="text-sm text-gray-600 dark:text-gray-300">
        This artifact and all its versions will be permanently removed.
      </p>
    </ConfirmDialog>
  )
}
