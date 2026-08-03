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
      <div className="mb-2 overflow-hidden rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised text-nexy-text shadow-nexy">
        <button
          type="button"
          onClick={onClose}
          className="w-full px-3 py-2 text-left text-xs text-nexy-muted"
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
      className="mb-2 overflow-hidden rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised text-nexy-text shadow-nexy"
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
              ? 'bg-nexy-accent text-nexy-on-accent'
              : 'text-nexy-muted hover:bg-nexy-recessed hover:text-nexy-text'
          }`}
        >
          <span className="font-mono">{option.token}</span>
          <span className="ml-3 text-nexy-muted">{option.description}</span>
        </button>
      ))}
    </div>
  )
}
