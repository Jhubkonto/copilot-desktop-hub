import type { AtContextOption } from '../../hooks/chat-types'

interface AtContextMenuProps {
  show: boolean
  filter: string
  selectedIndex: number
  options: AtContextOption[]
  onSelect: (option: AtContextOption) => void
  onClose: () => void
}

export function AtContextMenu({
  show,
  filter,
  selectedIndex,
  options,
  onSelect,
  onClose,
}: AtContextMenuProps) {
  if (!show) return null

  const visibleOptions = options
    .filter((option) => option.token.slice(1).startsWith(filter.toLowerCase()))
    .slice(0, 6)

  if (visibleOptions.length === 0) {
    return (
      <div className="mb-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        <button
          type="button"
          onClick={onClose}
          className="w-full text-left px-3 py-2 text-xs text-gray-600 dark:text-gray-300"
        >
          No matching context options
        </button>
      </div>
    )
  }

  return (
    <div
      id="at-context-menu"
      role="listbox"
      aria-label="Context options"
      className="mb-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden"
    >
      {visibleOptions.map((option, index) => (
        <button
          key={option.token}
          id={`at-opt-${index}`}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          onClick={() => onSelect(option)}
          className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between ${
            index === selectedIndex
              ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
          }`}
        >
          <span className="font-mono">{option.token}</span>
          <span className="ml-3 text-gray-400">{option.description}</span>
        </button>
      ))}
    </div>
  )
}
