import { useEffect, useRef, useState, KeyboardEvent } from 'react'
import { Loader2, Square } from 'lucide-react'

interface TerminalInputProps {
  isGenerating: boolean
  onSend: (text: string) => void
  onStop: () => void
}

export function TerminalInput({ isGenerating, onSend, onStop }: TerminalInputProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isGenerating) inputRef.current?.focus()
  }, [isGenerating])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const text = value.trim()
      if (!text || isGenerating) return
      onSend(text)
      setValue('')
    }
    if (e.key === 'c' && e.ctrlKey && isGenerating) {
      e.preventDefault()
      onStop()
    }
  }

  return (
    <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-800 bg-gray-950 shrink-0">
      <span className="text-green-400 font-mono text-sm select-none">$</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isGenerating}
        placeholder={isGenerating ? 'Generating… (Ctrl+C to stop)' : 'Type a message and press Enter'}
        className="flex-1 bg-transparent font-mono text-sm text-gray-100 placeholder-gray-600 outline-none disabled:opacity-50"
        autoComplete="off"
        spellCheck={false}
      />
      {isGenerating && (
        <button
          type="button"
          onClick={onStop}
          title="Stop (Ctrl+C)"
          className="text-gray-400 hover:text-red-400 transition-colors"
        >
          <Square className="w-4 h-4" />
        </button>
      )}
      {!isGenerating && value.trim() && (
        <Loader2 className="w-3.5 h-3.5 text-gray-600 invisible" aria-hidden />
      )}
    </div>
  )
}
