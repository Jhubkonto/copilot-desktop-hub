import { ConfirmDialog } from './ui/ConfirmDialog'

interface DeleteProjectDialogProps {
  projectName: string
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteProjectDialog({ projectName, onConfirm, onCancel }: DeleteProjectDialogProps) {
  return (
    <ConfirmDialog
      title="Delete project"
      ariaLabel={`Delete ${projectName}`}
      heading={<>Delete &ldquo;{projectName}&rdquo;?</>}
      confirmLabel="Delete Project"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
        <p>Deleting this project will remove it and all its settings. Conversations inside the project will be moved to the general chat list.</p>
      </div>
    </ConfirmDialog>
  )
}
