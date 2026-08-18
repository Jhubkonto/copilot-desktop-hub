import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type RectLike = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>

export type TooltipPosition = {
  top: number
  left: number
}

export function getViewportTooltipPosition(
  anchorRect: RectLike,
  tooltipRect: Pick<DOMRect, 'width' | 'height'>,
  viewportWidth: number,
  viewportHeight: number,
  gap = 8,
  padding = 8,
): TooltipPosition {
  const centeredLeft = anchorRect.left + (anchorRect.width - tooltipRect.width) / 2
  const maxLeft = Math.max(padding, viewportWidth - tooltipRect.width - padding)
  const left = Math.min(Math.max(centeredLeft, padding), maxLeft)

  const aboveTop = anchorRect.top - tooltipRect.height - gap
  const belowTop = anchorRect.bottom + gap
  const hasRoomAbove = aboveTop >= padding
  const hasRoomBelow = belowTop + tooltipRect.height <= viewportHeight - padding
  const unclampedTop = hasRoomAbove ? aboveTop : hasRoomBelow ? belowTop : aboveTop
  const maxTop = Math.max(padding, viewportHeight - tooltipRect.height - padding)
  const top = Math.min(Math.max(unclampedTop, padding), maxTop)

  return { top, left }
}

type ViewportTooltipProps = {
  label: string
  children: ReactNode
  className?: string
  dotStyle?: React.CSSProperties
}

export function ViewportTooltip({ label, children, className = '', dotStyle }: ViewportTooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<TooltipPosition | null>(null)
  const tooltipId = useId()

  const show = useCallback(() => {
    setPosition(null)
    setOpen(true)
  }, [])

  const hide = useCallback(() => {
    setOpen(false)
    setPosition(null)
  }, [])

  useLayoutEffect(() => {
    if (!open) return

    const updatePosition = () => {
      const anchor = anchorRef.current
      const tooltip = tooltipRef.current
      if (!anchor || !tooltip) return

      setPosition(getViewportTooltipPosition(
        anchor.getBoundingClientRect(),
        tooltip.getBoundingClientRect(),
        window.innerWidth,
        window.innerHeight,
      ))
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  return (
    <>
      <span
        ref={anchorRef}
        className={className}
        role="img"
        aria-label={label}
        aria-describedby={position ? tooltipId : undefined}
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        style={dotStyle}
      >
        {children}
      </span>
      {open && createPortal(
        <span
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none fixed z-[100] max-w-[calc(100vw-1rem)] whitespace-normal break-words rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 opacity-0 shadow-lg transition-opacity dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            visibility: position ? 'visible' : 'hidden',
            opacity: position ? 1 : 0,
          }}
        >
          {label}
        </span>,
        document.body,
      )}
    </>
  )
}
