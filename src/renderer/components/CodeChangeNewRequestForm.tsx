import type { CodeChangeRequestType } from '@shared/types'
import { Button } from './ui/primitives'

interface CodeChangeNewRequestFormProps {
  onClose: () => void
  requestType: CodeChangeRequestType
  onSetRequestType: (type: CodeChangeRequestType) => void
  customTypeLabel: string
  onSetCustomTypeLabel: (label: string) => void
  title: string
  onSetTitle: (title: string) => void
  description: string
  onSetDescription: (description: string) => void
  isWorkspaceConnected: boolean
  creating: boolean
  onCreate: () => void
  fromChatConversationTitle?: string | null
}

export function CodeChangeNewRequestForm({
  onClose,
  requestType,
  onSetRequestType,
  customTypeLabel,
  onSetCustomTypeLabel,
  title,
  onSetTitle,
  description,
  onSetDescription,
  isWorkspaceConnected,
  creating,
  onCreate,
  fromChatConversationTitle,
}: CodeChangeNewRequestFormProps) {
  const isCustomType = requestType === 'custom'
  const canCreate = isWorkspaceConnected && !!title.trim() && (!isCustomType || !!customTypeLabel.trim()) && !creating

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
      {fromChatConversationTitle && (
        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
          From chat: {fromChatConversationTitle}
        </div>
      )}
      <div className="mt-3 space-y-2">
        <div className="grid gap-2 md:grid-cols-[130px_minmax(180px,0.35fr)_1fr]">
          <select
            value={requestType}
            onChange={(event) => onSetRequestType(event.target.value as CodeChangeRequestType)}
            aria-label="Change request type"
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="edit">Edit</option>
            <option value="refactor">Refactor</option>
            <option value="bugfix">Bug fix</option>
            <option value="feature">Feature</option>
            <option value="investigation">Investigation</option>
            <option value="custom">Custom</option>
          </select>
          <input
            value={title}
            onChange={(event) => onSetTitle(event.target.value)}
            placeholder="Short title"
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
          {isCustomType && (
            <input
              value={customTypeLabel}
              onChange={(event) => onSetCustomTypeLabel(event.target.value)}
              placeholder="Label this request type…"
              aria-label="Custom request type label"
              className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            />
          )}
        </div>
        <textarea
          value={description}
          onChange={(event) => onSetDescription(event.target.value)}
          placeholder="What should change, and what should remain unchanged?"
          rows={3}
          className="w-full resize-y rounded border border-gray-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
        />
        <div className="flex justify-end">
          <Button
            variant="primary"
            disabled={!canCreate}
            onClick={onCreate}
          >
            {creating ? 'Creating...' : 'Create request'}
          </Button>
        </div>
      </div>
    </div>
  )
}
