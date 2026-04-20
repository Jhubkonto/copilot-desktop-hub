import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { X } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'

interface TerminalPanelProps {
  visible: boolean
  onClose: () => void
}

export function TerminalPanel({ visible, onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const termIdRef = useRef<string | null>(null)
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!visible || !containerRef.current || initializedRef.current) return

    const term = new Terminal({
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        cursorAccent: '#1e1e2e',
        selectionBackground: '#585b7066',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8'
      },
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      convertEol: true
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)

    requestAnimationFrame(() => {
      fitAddon.fit()
    })

    xtermRef.current = term
    fitRef.current = fitAddon
    initializedRef.current = true

    const termId = crypto.randomUUID()
    termIdRef.current = termId
    ;window.api.createTerminal(termId)

    term.onData((data: string) => {
      ;window.api.writeTerminal(termId, data)
    })

    const unsubscribe = window.api.onTerminalData(
      (id: string, data: string) => {
        if (id === termId) {
          term.write(data)
        }
      }
    )

    const unsubscribeExit = window.api.onTerminalExit(
      (id: string, code: number | null) => {
        if (id === termId) {
          term.writeln(`\r\n[Process exited with code ${code ?? 'unknown'}]`)
        }
      }
    )

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
      } catch {
        // Ignore fit errors during resize
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      unsubscribe()
      unsubscribeExit()
      resizeObserver.disconnect()
      ;window.api.disposeTerminal(termId)
      term.dispose()
      initializedRef.current = false
      xtermRef.current = null
      fitRef.current = null
      termIdRef.current = null
    }
  }, [visible])

  useEffect(() => {
    if (visible && fitRef.current) {
      requestAnimationFrame(() => {
        fitRef.current?.fit()
      })
    }
  }, [visible])

  if (!visible) return null

  return (
    <div
      className="border-t border-gray-200 dark:border-gray-700"
      style={{ height: '250px', backgroundColor: '#1e1e2e' }}
    >
      <div className="flex items-center justify-between px-3 py-1 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
          Terminal
        </span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
          title="Close terminal"
          aria-label="Close terminal"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div ref={containerRef} className="h-[calc(100%-28px)] w-full" />
    </div>
  )
}
