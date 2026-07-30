import { useLayoutEffect, useState, type ReactNode, type RefObject, type TextareaHTMLAttributes } from 'react'
import { ResizeHandle } from '../ResizeHandle'

interface ResizableChatInputProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'rows'> {
  inputRef: RefObject<HTMLTextAreaElement | null>
  value: string
  leftActions?: ReactNode
  rightActions?: ReactNode
  minHeight?: number
  maxHeight?: number
}

/**
 * Shared chat input surface used by the main conversation and focused chat
 * workflows. It owns the visual treatment, auto-growth, and pointer-resizing
 * contract so secondary composers cannot silently drift from the main chat.
 */
export function ResizableChatInput({
  inputRef,
  value,
  leftActions,
  rightActions,
  minHeight = 40,
  maxHeight = 400,
  onDragOver,
  ...textareaProps
}: ResizableChatInputProps) {
  const [manualHeight, setManualHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    const element = inputRef.current
    if (!element) return

    element.style.height = 'auto'
    const floor = manualHeight ?? minHeight
    element.style.height = `${Math.min(Math.max(floor, element.scrollHeight), maxHeight)}px`
  }, [inputRef, value, manualHeight, minHeight, maxHeight])

  return (
    <div className="relative rounded-xl border border-gray-200 bg-white transition-colors focus-within:border-transparent focus-within:ring-2 focus-within:ring-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:focus-within:ring-gray-500">
      <ResizeHandle
        direction="vertical"
        align="start"
        containerRef={inputRef}
        onSetSize={setManualHeight}
        minSize={minHeight}
        maxSize={maxHeight}
      />
      <textarea
        {...textareaProps}
        ref={inputRef}
        value={value}
        rows={1}
        onDragOver={(event) => {
          event.preventDefault()
          onDragOver?.(event)
        }}
        className="chat-input w-full resize-none overflow-y-auto bg-transparent px-4 pb-2 pt-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-100"
      />
      <div className="flex items-center justify-between px-2 pb-2">
        <div className="flex items-center gap-0.5">{leftActions}</div>
        <div className="flex items-center gap-1">{rightActions}</div>
      </div>
    </div>
  )
}
