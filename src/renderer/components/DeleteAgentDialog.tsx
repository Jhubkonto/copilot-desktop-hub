import { AlertTriangle } from 'lucide-react'
import type { DeleteAgentImpact } from '../store/types'
import { ConfirmDialog } from './ui/ConfirmDialog'

interface DeleteAgentDialogProps {
  impact: DeleteAgentImpact
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteAgentDialog({ impact, onConfirm, onCancel }: DeleteAgentDialogProps) {
  const { agentName, affectedProjects, affectedConvCount } = impact
  const hasPrimary = affectedProjects.some((p) => p.is_primary === 1)

  return (
    <ConfirmDialog
      title="Delete agent"
      ariaLabel={`Delete ${agentName}`}
      heading={<>Delete &ldquo;{agentName}&rdquo;?</>}
      confirmLabel="Delete Agent"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
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
    </ConfirmDialog>
  )
}
