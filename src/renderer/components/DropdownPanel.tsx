import { useLayoutEffect, useRef, useState } from 'react'
import { useClickOutside } from '../hooks/useClickOutside'

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
  const [above, setAbove] = useState(false)
  const [horizontalOffset, setHorizontalOffset] = useState(0)

  // Measure the panel's real rendered size (not a guessed height) and clamp it back inside the
  // viewport on both axes — runs before paint so no flash to the wrong position.
  useLayoutEffect(() => {
    if (!open) return
    const container = containerRef.current
    const panel = panelRef.current
    if (container && panel) {
      const containerRect = container.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()

      setAbove(containerRect.bottom + panelRect.height > window.innerHeight - VIEWPORT_MARGIN)

      let offset = 0
      if (panelRect.right > window.innerWidth - VIEWPORT_MARGIN) {
        offset -= panelRect.right - (window.innerWidth - VIEWPORT_MARGIN)
      } else if (panelRect.left < VIEWPORT_MARGIN) {
        offset += VIEWPORT_MARGIN - panelRect.left
      }
      setHorizontalOffset(offset)
    }
  }, [open])

  useClickOutside(containerRef, onClose, open)

  return (
    <div ref={containerRef} className="relative">
      {trigger}
      {open && (
        <div
          ref={panelRef}
          style={horizontalOffset ? { transform: `translateX(${horizontalOffset}px)` } : undefined}
          className={`absolute z-50 ${width} ${align === 'right' ? 'right-0' : 'left-0'} ${above ? 'bottom-full mb-1' : 'top-full mt-1'} rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-hidden ${className}`}
        >
          {children}
        </div>
      )}
    </div>
  )
}

