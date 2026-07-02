import type { CodeChangeRequestType } from '@shared/types'
import { Button } from './ui/primitives'

interface CodeChangeNewRequestFormProps {
  open: boolean
  onOpen: () => void
  onClose: () => void
  requestType: CodeChangeRequestType
  onSetRequestType: (type: CodeChangeRequestType) => void
  title: string
  onSetTitle: (title: string) => void
  description: string
  onSetDescription: (description: string) => void
  isWorkspaceConnected: boolean
  creating: boolean
  onCreate: () => void
}

export function CodeChangeNewRequestForm({
  open,
  onOpen,
  onClose,
  requestType,
  onSetRequestType,
  title,
  onSetTitle,
  description,
  onSetDescription,
  isWorkspaceConnected,
  creating,
  onCreate,
}: CodeChangeNewRequestFormProps) {
  if (!open) {
    return (
      <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">New change request</p>
            <p className="mt-0.5 text-[11px] text-gray-500">Describe the outcome you want and review a staged patch before anything changes.</p>
          </div>
          <Button variant="primary" onClick={onOpen} disabled={!isWorkspaceConnected}>
            New request
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">New change request</p>
          <p className="mt-0.5 text-[11px] text-gray-500">Describe the outcome you want. No files are changed until you review and apply a staged patch.</p>
        </div>
        <Button variant="secondary" onClick={onClose} className="text-[11px] px-2 py-1">
          Cancel
        </Button>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-[130px_minmax(180px,0.35fr)_1fr_auto]">
        <select
          value={requestType}
          onChange={(event) => onSetRequestType(event.target.value as CodeChangeRequestType)}
          aria-label="Change request type"
          className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="edit">Edit</option>
          <option value="refactor">Refactor</option>
          <option value="bugfix">Bug fix</option>
          <option value="investigation">Investigation</option>
        </select>
        <input
          value={title}
          onChange={(event) => onSetTitle(event.target.value)}
          placeholder="Short title"
          className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
        />
        <input
          value={description}
          onChange={(event) => onSetDescription(event.target.value)}
          placeholder="What should change, and what should remain unchanged?"
          className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
        />
        <Button
          variant="primary"
          disabled={!isWorkspaceConnected || !title.trim() || creating}
          onClick={onCreate}
        >
          {creating ? 'Creating...' : 'Create request'}
        </Button>
      </div>
    </div>
  )
}
