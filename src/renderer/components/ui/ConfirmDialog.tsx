import { useEffect, useRef, type ReactNode } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
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
      maxWidth="max-w-[30rem]"
      height=""
      compactHeader
      panelClassName="rounded-nexy-lg border-nexy-border shadow-nexy"
      bodyClassName="px-6 pb-6 pt-7"
      footerClassName="bg-nexy-surface px-6 py-4"
      onClose={busy ? () => {} : onCancel}
      footer={
        <>
          <Button ref={cancelRef} onClick={onCancel} disabled={busy} className="min-w-20 px-4 py-2.5 text-sm">
            Cancel
          </Button>
          <Button
            variant="dangerSolid"
            onClick={onConfirm}
            disabled={busy}
            className="min-w-28 px-4 py-2.5 text-sm"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-4 pr-8">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-nexy-md border-2 border-nexy-error bg-red-50 text-nexy-error dark:bg-red-950/40">
          {icon ?? <Trash2 className="h-5 w-5" strokeWidth={2} />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-lg font-semibold leading-6 text-gray-900 dark:text-gray-100">
            {heading ?? title}
          </h2>

          {children && (
            <div className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
              {children}
            </div>
          )}

          {irreversible && (
            <div className="mt-4 flex items-center gap-2 rounded-nexy-sm border-2 border-nexy-error bg-red-50/70 px-3 py-2 text-xs font-bold text-red-800 dark:bg-red-950/30 dark:text-red-200">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              <span>This action cannot be undone.</span>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  )
}
