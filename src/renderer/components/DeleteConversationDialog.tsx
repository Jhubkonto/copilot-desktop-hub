import { ConfirmDialog } from './ui/ConfirmDialog'

interface DeleteConversationDialogProps {
  conversationTitle: string
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConversationDialog({ conversationTitle, onConfirm, onCancel }: DeleteConversationDialogProps) {
  return (
    <ConfirmDialog
      title={`Delete "${conversationTitle}"?`}
      confirmLabel="Delete Chat"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p className="text-sm text-gray-600 dark:text-gray-300">
        This conversation and all its messages will be permanently removed.
      </p>
    </ConfirmDialog>
  )
}
