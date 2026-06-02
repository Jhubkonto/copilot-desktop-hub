import { useEffect, useRef } from 'react'

interface Props {
  sessionId?: string | null
  onSpawn?: (sessionId: string) => void
  onExit?: (code: number | null) => void
}

export function CliTerminalPanel({ sessionId = null, onSpawn, onExit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeSessionRef = useRef<string | null>(sessionId)

  useEffect(() => {
    if (!containerRef.current) return

    let terminal: {
      cols: number
      rows: number
      write: (data: string) => void
      dispose: () => void
    } | null = null
    let fitAddon: { fit: () => void } | null = null
    let resizeObserver: ResizeObserver | null = null
    let unsubData: (() => void) | null = null
    let unsubExit: (() => void) | null = null
    let spawnedSessionId: string | null = null

    async function init() {
      if (!containerRef.current) return

      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ])

      const term = new Terminal({ convertEol: true, cursorBlink: true })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(containerRef.current)
      fit.fit()

      terminal = term
      fitAddon = fit

      let currentSessionId = sessionId
      if (!currentSessionId) {
        const shell = window.api.platform === 'win32' ? 'cmd.exe' : '/bin/bash'
        const cwd = await window.api.getWorkingDirectory()
        const { sessionId: newSessionId } = await window.api.spawnCli(shell, [], cwd, term.cols, term.rows)
        spawnedSessionId = newSessionId
        currentSessionId = newSessionId
        onSpawn?.(newSessionId)
      }

      activeSessionRef.current = currentSessionId

      term.onData((data: string) => {
        if (activeSessionRef.current) {
          void window.api.writeCli(activeSessionRef.current, data)
        }
      })

      unsubData = window.api.onCliData(({ sessionId: dataSessionId, data }) => {
        if (dataSessionId === activeSessionRef.current) {
          terminal?.write(data)
        }
      })

      unsubExit = window.api.onCliExit(({ sessionId: exitSessionId, code }) => {
        if (exitSessionId === activeSessionRef.current) {
          onExit?.(code)
        }
      })

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          if (!terminal || !fitAddon) return
          fitAddon.fit()
          if (activeSessionRef.current) {
            void window.api.resizeCli(activeSessionRef.current, terminal.cols, terminal.rows)
          }
        })
        resizeObserver.observe(containerRef.current)
      }
    }

    void init().catch(console.error)

    return () => {
      resizeObserver?.disconnect()
      unsubData?.()
      unsubExit?.()
      if (spawnedSessionId) {
        void window.api.killCli(spawnedSessionId).catch(() => {})
      }
      terminal?.dispose()
    }
  }, [onExit, onSpawn, sessionId])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
