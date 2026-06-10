import { useEffect, useRef } from 'react'
import { Trash2, AlertTriangle } from 'lucide-react'
import type { DeleteAgentImpact } from '../store/types'
import { Button, ModalShell } from './ui/primitives'

interface DeleteAgentDialogProps {
  impact: DeleteAgentImpact
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteAgentDialog({ impact, onConfirm, onCancel }: DeleteAgentDialogProps) {
  const { agentName, affectedProjects, affectedConvCount } = impact
  const hasPrimary = affectedProjects.some((p) => p.is_primary === 1)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Focus Cancel on open; close on Escape
  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <ModalShell
      title="Delete agent"
      ariaLabel={`Delete ${agentName}`}
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
            Delete Agent
          </Button>
        </>
      }
    >
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-red-500" />
          </div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Delete &ldquo;{agentName}&rdquo;?
          </h2>
        </div>

        {/* Impact summary */}
        <div className="text-sm text-gray-600 dark:text-gray-300 space-y-2">
          <p>This will:</p>
          <ul className="space-y-1 pl-2">
            {affectedProjects.length > 0 && (
              <li>
                <span className="font-medium">
                  Remove the agent from {affectedProjects.length} project team{affectedProjects.length !== 1 ? 's' : ''}:
                </span>
                <ul className="mt-1 pl-3 space-y-0.5">
                  {affectedProjects.map((p) => (
                    <li key={p.id} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <span className="text-gray-300 dark:text-gray-600">–</span>
                      <span>{p.name}</span>
                      {p.is_primary === 1 && (
                        <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="w-3 h-3" />
                          <span className="text-[10px] font-medium">was primary agent</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            )}
            {affectedConvCount > 0 && (
              <li>
                <span className="font-medium">Unlink {affectedConvCount} past conversation{affectedConvCount !== 1 ? 's' : ''}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">
                  (history is kept; the agent association is lost)
                </span>
              </li>
            )}
          </ul>
          {hasPrimary && (
            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
              Projects that lose their primary agent will have no leader. You can promote a new primary agent from the project&rsquo;s team list.
            </p>
          )}
        </div>

        <p className="text-xs text-gray-400 dark:text-gray-500 font-medium">
          This action cannot be undone.
        </p>
    </ModalShell>
  )
}
