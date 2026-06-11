import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ModalShell } from './ui/primitives'

interface DeleteConversationDialogProps {
  conversationTitle: string
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConversationDialog({ conversationTitle, onConfirm, onCancel }: DeleteConversationDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <ModalShell
      title={`Delete "${conversationTitle}"?`}
      maxWidth="max-w-md"
      height=""
      bodyClassName="p-6 space-y-4"
      onClose={onCancel}
      footer={
        <>
          <Button ref={cancelRef} onClick={onCancel} className="px-4 py-2 text-sm">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 dark:text-white"
          >
            Delete Chat
          </Button>
        </>
      }
    >
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-red-500" />
          </div>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-300">
          This conversation and all its messages will be permanently removed.
        </p>

        <p className="text-xs text-gray-400 dark:text-gray-500 font-medium">
          This action cannot be undone.
        </p>
    </ModalShell>
  )
}
