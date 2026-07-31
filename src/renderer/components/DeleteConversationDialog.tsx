import { ConfirmDialog } from './ui/ConfirmDialog'

interface DeleteConversationDialogProps {
  conversationTitle: string
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConversationDialog({ conversationTitle, onConfirm, onCancel }: DeleteConversationDialogProps) {
  return (
    <ConfirmDialog
      title="Delete chat"
      ariaLabel={`Delete ${conversationTitle}`}
      heading={<>Delete &ldquo;{conversationTitle}&rdquo;?</>}
      confirmLabel="Delete Chat"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p>
        This conversation and all its messages will be permanently removed.
      </p>
    </ConfirmDialog>
  )
}
