import { useState } from 'react'
import { ConfirmDialog } from './ui/ConfirmDialog'

interface DeleteProjectDialogProps {
  projectName: string
  onConfirm: (deleteChats: boolean) => void
  onCancel: () => void
}

export function DeleteProjectDialog({ projectName, onConfirm, onCancel }: DeleteProjectDialogProps) {
  const [deleteChats, setDeleteChats] = useState(false)

  return (
    <ConfirmDialog
      title="Delete project"
      ariaLabel={`Delete ${projectName}`}
      heading={<>Delete &ldquo;{projectName}&rdquo;?</>}
      confirmLabel="Delete Project"
      onConfirm={() => onConfirm(deleteChats)}
      onCancel={onCancel}
    >
      <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
        <p>Deleting this project will remove it and all its settings. Conversations inside the project will be moved to the general chat list.</p>
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={deleteChats}
          onChange={(e) => setDeleteChats(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-nexy-error focus:ring-nexy-error"
        />
        <span>Also delete conversations that belong to this project</span>
      </label>
    </ConfirmDialog>
  )
}
