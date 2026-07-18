import { useEffect, useRef, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ModalShell } from './primitives'

interface ConfirmDialogProps {
  title: string
  ariaLabel?: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  /** Bold heading rendered beside the icon badge (e.g. `Delete "Name"?`). */
  heading?: ReactNode
  /** Replaces the default red Trash2 badge. */
  icon?: ReactNode
  /** Extra body content rendered between the icon row and the "cannot be undone" note. */
  children?: ReactNode
  /** Set false for confirmations that are recoverable. */
  irreversible?: boolean
  /** Disables both buttons and blocks Escape/backdrop close while the action runs. */
  busy?: boolean
}

export function ConfirmDialog({
  title,
  ariaLabel,
  confirmLabel,
  onConfirm,
  onCancel,
  heading,
  icon,
  children,
  irreversible = true,
  busy = false,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Focus Cancel on open; close on Escape (unless busy)
  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  return (
    <ModalShell
      title={title}
      ariaLabel={ariaLabel}
      maxWidth="max-w-md"
      height=""
      bodyClassName="p-6 space-y-4"
      onClose={busy ? () => {} : onCancel}
      footer={
        <>
          <Button ref={cancelRef} onClick={onCancel} disabled={busy} className="px-4 py-2 text-sm">
            Cancel
          </Button>
          <Button
            variant="dangerSolid"
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 text-sm"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          {icon ?? <Trash2 className="w-5 h-5 text-red-500" />}
        </div>
        {heading && (
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {heading}
          </h2>
        )}
      </div>

      {children}

      {irreversible && (
        <p className="text-xs text-gray-400 dark:text-gray-500 font-medium">
          This action cannot be undone.
        </p>
      )}
    </ModalShell>
  )
}
