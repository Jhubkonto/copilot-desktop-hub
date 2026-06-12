import { X } from 'lucide-react'
import type { Milestone } from '../../store/types'

interface Props {
  milestone: Milestone
  onChange: (id: string, field: 'title' | 'description', val: string) => void
  onStatus: (id: string, status: Milestone['status']) => void
  onRemove: (id: string) => void
}

export function MilestoneCard({ milestone, onChange, onStatus, onRemove }: Props) {
  return (
    <div
      className={`mt-1 rounded-lg border p-2 space-y-1 ${
        milestone.status === 'active'
          ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/10'
          : milestone.status === 'completed'
            ? 'border-gray-200 dark:border-gray-700 opacity-60'
            : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      <div className="flex gap-1 items-center">
        <input
          value={milestone.title}
          onChange={(e) => onChange(milestone.id, 'title', e.target.value)}
          placeholder="Milestone title"
          className="flex-1 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
          aria-label="Milestone title"
        />
        <button
          type="button"
          onClick={() => onRemove(milestone.id)}
          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
          aria-label={`Remove milestone ${milestone.title || ''}`}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <input
        value={milestone.description ?? ''}
        onChange={(e) => onChange(milestone.id, 'description', e.target.value)}
        placeholder="Description (optional)"
        className="w-full text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        aria-label="Milestone description"
      />
      <div className="flex gap-1 pt-0.5">
        {milestone.status !== 'active' && (
          <button
            type="button"
            onClick={() => onStatus(milestone.id, 'active')}
            className="text-[10px] px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50"
            aria-label={`Set ${milestone.title} as active`}
          >
            Set active
          </button>
        )}
        {milestone.status === 'active' && (
          <button
            type="button"
            onClick={() => onStatus(milestone.id, 'completed')}
            className="text-[10px] px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50"
            aria-label={`Mark ${milestone.title} as complete`}
          >
            Mark complete
          </button>
        )}
        {milestone.status === 'completed' && (
          <button
            type="button"
            onClick={() => onStatus(milestone.id, 'upcoming')}
            className="text-[10px] px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
            aria-label={`Reopen ${milestone.title}`}
          >
            Reopen
          </button>
        )}
      </div>
    </div>
  )
}
