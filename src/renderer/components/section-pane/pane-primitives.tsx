import { type ReactNode } from 'react'
import { Search, X } from 'lucide-react'

/**
 * Shared scaffold pieces for the section panes (AgentsPane, ChatsPane, …).
 * Every pane repeats the same header/search/skeleton/empty-state structure —
 * these primitives keep the markup and styling in one place.
 */

export function PaneHeader({ label, actions }: { label: string; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 h-9 border-b border-gray-100 dark:border-gray-800">
      <span className="text-xs text-gray-400 dark:text-gray-500">{label}</span>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  )
}

/** Standard header action button (New / Import / Generate …). */
export function PaneHeaderButton({
  onClick,
  icon,
  label,
  ariaLabel,
  accent,
}: {
  onClick: () => void
  icon: ReactNode
  label: string
  ariaLabel: string
  /** Indigo accent styling used for AI-generate actions. */
  accent?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={
        accent
          ? 'flex items-center gap-1 text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors'
          : 'flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
      }
      aria-label={ariaLabel}
    >
      {icon}
      {label}
    </button>
  )
}

export function PaneSearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-8 pr-7 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-blue-400 focus:bg-white dark:focus:bg-gray-900 rounded-lg outline-none transition-colors placeholder:text-gray-400"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            aria-label="Clear search"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  )
}

export function PaneSkeleton({ rows = 4, rowHeight = 'h-9' }: { rows?: number; rowHeight?: string }) {
  return (
    <div className="p-2 space-y-0.5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`${rowHeight} rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse`} />
      ))}
    </div>
  )
}

export function PaneEmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="text-center text-xs text-gray-400 dark:text-gray-500 pt-8 italic">
      {children}
    </p>
  )
}
