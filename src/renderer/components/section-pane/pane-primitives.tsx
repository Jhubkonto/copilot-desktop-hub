import { type ReactNode } from 'react'
import { NexyIcon } from '../ui/icons/NexyIcon'

/**
 * Shared scaffold pieces for the section panes (AgentsPane, ChatsPane, …).
 * Every pane repeats the same header/search/skeleton/empty-state structure —
 * these primitives keep the markup and styling in one place.
 */

export function PaneHeader({ label, actions }: { label: string; actions?: ReactNode }) {
  return (
    <div className="flex h-9 items-center justify-between border-b-2 border-nexy-border bg-nexy-surface px-4">
      <span className="nexy-panel-title text-xs font-bold tracking-wide text-nexy-muted">{label}</span>
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
          ? 'flex items-center gap-1 rounded-nexy-sm border border-transparent px-2 py-1 text-xs font-bold text-nexy-activity hover:border-nexy-activity hover:bg-purple-50 dark:hover:bg-purple-950/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-nexy-accent'
          : 'flex items-center gap-1 rounded-nexy-sm border border-transparent px-2 py-1 text-xs font-bold text-nexy-muted hover:border-nexy-border hover:bg-nexy-recessed hover:text-nexy-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-nexy-accent'
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
    <div className="border-b-2 border-nexy-border px-3 py-2">
      <div className="relative">
        <NexyIcon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-nexy-muted pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed py-1.5 pl-8 pr-7 text-xs text-nexy-text outline-none placeholder:text-nexy-muted focus:bg-nexy-raised focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-nexy-accent"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-nexy-muted hover:text-nexy-text"
            aria-label="Clear search"
          >
            <NexyIcon name="close" className="w-3 h-3" />
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
        <div key={i} className={`${rowHeight} nexy-dither animate-pulse rounded-nexy-sm border border-nexy-border-soft`} />
      ))}
    </div>
  )
}

export function PaneEmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="text-center text-xs text-nexy-muted pt-8 italic">
      {children}
    </p>
  )
}
