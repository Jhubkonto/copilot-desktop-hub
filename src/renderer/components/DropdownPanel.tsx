import { useEffect, useRef, useState } from 'react'

interface DropdownPanelProps {
  open: boolean
  onClose: () => void
  trigger: React.ReactNode
  children: React.ReactNode
  align?: 'left' | 'right'
  width?: string
  className?: string
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
  const [above, setAbove] = useState(false)

  useEffect(() => {
    if (!open) return
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setAbove(rect.bottom + 280 > window.innerHeight)
    }
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])

  return (
    <div ref={containerRef} className="relative">
      {trigger}
      {open && (
        <div
          className={`absolute z-50 ${width} ${align === 'right' ? 'right-0' : 'left-0'} ${above ? 'bottom-full mb-1' : 'top-full mt-1'} rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-hidden ${className}`}
        >
          {children}
        </div>
      )}
    </div>
  )
}
