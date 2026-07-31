import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { getModelLabel } from '../../../shared/models'
import type { AvailableModelEntry, CatalogModel } from '../../../shared/types'
import { useClickOutside } from '../../hooks/useClickOutside'

const MENU_WIDTH = 240
const MENU_MAX_HEIGHT = 280
const MENU_MARGIN = 4

interface CliLockedModelBadgeProps {
  backend: 'claude-cli' | 'codex-cli' | 'hermes-cli'
  modelId: string | null
  models: AvailableModelEntry[]
  catalogModels: CatalogModel[]
  onSelectModel: (modelId: string) => void
}

export function CliLockedModelBadge({
  backend,
  modelId,
  models,
  catalogModels,
  onSelectModel,
}: CliLockedModelBadgeProps) {
  const backendLabel = backend === 'claude-cli' ? 'Claude CLI' : backend === 'codex-cli' ? 'Codex CLI' : 'Hermes Agent'
  const modelLabel = modelId ? getModelLabel(modelId, catalogModels) : 'default'

  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; openUpward: boolean } | null>(null)

  useClickOutside([menuRef, buttonRef], () => setOpen(false), open)

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) { setMenuPosition(null); return }
    const computePosition = () => {
      const rect = buttonRef.current!.getBoundingClientRect()
      const openUpward = rect.bottom + MENU_MAX_HEIGHT > window.innerHeight && rect.top - MENU_MAX_HEIGHT > 0
      const left = Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - MENU_MARGIN)
      const top = openUpward ? rect.top - MENU_MARGIN : rect.bottom + MENU_MARGIN
      setMenuPosition({ top, left: Math.max(left, MENU_MARGIN), openUpward })
    }
    computePosition()
    window.addEventListener('resize', computePosition)
    window.addEventListener('scroll', computePosition, true)
    return () => {
      window.removeEventListener('resize', computePosition)
      window.removeEventListener('scroll', computePosition, true)
    }
  }, [open])

  return (
    <div className="relative flex items-center">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex max-w-[220px] items-center gap-1 rounded-md px-1.5 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100"
        aria-label={`Conversation model: ${modelLabel} · ${backendLabel}`}
        title={`${modelLabel} · ${backendLabel}. Agent settings lock this chat to this backend.`}
      >
        <span className="min-w-0 max-w-[140px] truncate">{modelLabel}</span>
        <span className="shrink-0 text-gray-400 dark:text-gray-500 opacity-80">· {backendLabel}</span>
        <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
      </button>
      {open && menuPosition && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: menuPosition.openUpward ? undefined : menuPosition.top,
            bottom: menuPosition.openUpward ? window.innerHeight - menuPosition.top : undefined,
            left: menuPosition.left,
            width: MENU_WIDTH,
            maxHeight: MENU_MAX_HEIGHT,
          }}
          className="z-50 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-auto p-1"
        >
          <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {backendLabel}
          </div>
          {models.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                m.id === modelId
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setOpen(false)
                onSelectModel(m.id)
              }}
            >
              {m.label}
            </button>
          ))}
          {models.length === 0 && (
            <p className="px-2 py-2 text-xs text-gray-400 dark:text-gray-500">No models available</p>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

