import { useCallback } from 'react'

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical'
  /** Ref to the panel element being resized. Used for absolute-position sizing. */
  containerRef: React.RefObject<HTMLElement | null>
  /** Called with the new absolute panel size in pixels on every pointer move. */
  onSetSize: (size: number) => void
  /** Which edge the handle sits on. Horizontal: 'start'=left, 'end'=right. Vertical: 'start'=top, 'end'=bottom. Default: 'end'. */
  align?: 'start' | 'end'
}

export function ResizeHandle({ direction, containerRef, onSetSize, align = 'end' }: ResizeHandleProps) {
  const isHorizontal = direction === 'horizontal'

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()

      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return

      // Snapshot the fixed edge of the panel (the edge that stays put during resize).
      // For a left-side panel (align=end): fixed edge = left edge
      // For a right-side panel (align=start): fixed edge = right edge
      // For a top panel (align=end): fixed edge = top edge
      // For a bottom panel (align=start): fixed edge = bottom edge
      const anchorEdge = isHorizontal
        ? (align === 'start' ? rect.right : rect.left)
        : (align === 'start' ? rect.bottom : rect.top)

      document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'

      const onMove = (ev: PointerEvent) => {
        const currentPos = isHorizontal ? ev.clientX : ev.clientY
        // Compute absolute new size from cursor to fixed anchor edge.
        const newSize = align === 'start'
          ? anchorEdge - currentPos   // right/bottom panel: grows as cursor moves toward start
          : currentPos - anchorEdge   // left/top panel: grows as cursor moves toward end
        onSetSize(Math.max(0, newSize))
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [isHorizontal, align, containerRef, onSetSize]
  )

  return (
    <div
      className={`absolute z-10 transition-colors ${
        isHorizontal
          ? `${align === 'start' ? 'left-0' : 'right-0'} top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400/50 active:bg-blue-500/60`
          : `${align === 'start' ? 'top-0' : 'bottom-0'} left-0 right-0 h-1 cursor-row-resize hover:bg-blue-400/50 active:bg-blue-500/60`
      }`}
      onPointerDown={handlePointerDown}
      aria-hidden="true"
    />
  )
}
