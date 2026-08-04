import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface DropdownPanelProps {
  open: boolean
  onClose: () => void
  trigger: React.ReactNode
  children: React.ReactNode
  align?: 'left' | 'right'
  width?: string
  className?: string
}

const VIEWPORT_MARGIN = 8
const PANEL_GAP = 4

interface PanelPosition {
  top: number
  left: number
  placement: 'above' | 'below'
}

export function DropdownPanel({
  open,
  onClose,
  trigger,
  children,
  align = 'left',
  width = 'w-56',
  className = '',
}: DropdownPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null)

  // The chat timeline is an overflow container, so the panel must live at the viewport level.
  // Measure its real size, choose the side with room, and keep both axes inside the viewport.
  useLayoutEffect(() => {
    if (!open) {
      setPanelPosition(null)
      return
    }

    const computePosition = () => {
      const container = containerRef.current
      const panel = panelRef.current
      if (!container || !panel) return

      const triggerRect = container.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const spaceAbove = triggerRect.top - VIEWPORT_MARGIN - PANEL_GAP
      const spaceBelow = window.innerHeight - triggerRect.bottom - VIEWPORT_MARGIN - PANEL_GAP
      const placement = panelRect.height > spaceBelow && spaceAbove > spaceBelow ? 'above' : 'below'
      const preferredTop = placement === 'above'
        ? triggerRect.top - PANEL_GAP - panelRect.height
        : triggerRect.bottom + PANEL_GAP
      const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN - panelRect.height)
      const top = Math.max(VIEWPORT_MARGIN, Math.min(preferredTop, maxTop))
      const preferredLeft = align === 'right'
        ? triggerRect.right - panelRect.width
        : triggerRect.left
      const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - panelRect.width)
      const left = Math.max(VIEWPORT_MARGIN, Math.min(preferredLeft, maxLeft))

      setPanelPosition({ top, left, placement })
    }

    computePosition()
    window.addEventListener('resize', computePosition)
    window.addEventListener('scroll', computePosition, true)
    return () => {
      window.removeEventListener('resize', computePosition)
      window.removeEventListener('scroll', computePosition, true)
    }
  }, [align, open])

  // Close on outside mousedown, but ignore clicks landing inside a ModelPicker menu:
  // that menu is portaled to document.body (outside this panel's DOM subtree), so a
  // plain containment check would treat picking a model as an "outside" click and close
  // the whole panel before the selection registers.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target) return
      const container = containerRef.current
      if (container && container.contains(target)) return
      const panel = panelRef.current
      if (panel && panel.contains(target)) return
      if (target instanceof Element && target.closest('[data-model-picker-menu]')) return
      onCloseRef.current()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      {trigger}
      {open && createPortal(
        <div
          ref={panelRef}
          data-dropdown-panel
          data-placement={panelPosition?.placement}
          style={{
            position: 'fixed',
            top: panelPosition?.top ?? 0,
            left: panelPosition?.left ?? 0,
            visibility: panelPosition ? 'visible' : 'hidden',
          }}
          className={`z-50 ${width} rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-hidden ${className}`}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  )
}

