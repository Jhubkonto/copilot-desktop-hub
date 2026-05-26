import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, FolderOpen } from 'lucide-react'

interface DirectoryPickerProps {
  agentId: string | null
  onClose: () => void
}

export function DirectoryPicker({ agentId, onClose }: DirectoryPickerProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [recentDirs, setRecentDirs] = useState<string[]>([])
  const [currentCwd, setCurrentCwd] = useState('')
  const [manualInput, setManualInput] = useState('')
  const [position, setPosition] = useState({ top: 44, left: 16 })

  useEffect(() => {
    window.api.getRecentDirs().then((dirs) => setRecentDirs((dirs as string[]).slice(0, 5)))
    window.api.getWorkingDirectory().then((cwd) => setCurrentCwd(String(cwd ?? '')))
  }, [])

  useEffect(() => {
    const updatePosition = () => {
      const anchor = document.querySelector('[data-directory-breadcrumb="true"]') as HTMLElement | null
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      setPosition({
        top: rect.bottom + 8,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 352))
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [])

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) {
        onClose()
      }
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [onClose])

  const visibleRecentDirs = useMemo(
    () => recentDirs.filter((dir) => dir && dir !== currentCwd).slice(0, 5),
    [recentDirs, currentCwd]
  )

  const selectDirectory = async (path: string) => {
    const nextPath = path.trim()
    if (!nextPath) return
    await window.api.setWorkingDirectory(nextPath)
    await window.api.addRecentDir(nextPath)
    if (agentId) {
      const currentConfig = await window.api.getAgent(agentId)
      if (currentConfig && typeof currentConfig === 'object') {
        await window.api.updateAgent(agentId, {
          ...(currentConfig as Record<string, unknown>),
          rootDirectory: nextPath
        })
      }
    }
    onClose()
  }

  const handleBrowse = async () => {
    const result = await window.api.openDirectoryDialog()
    if (Array.isArray(result) && result[0]) {
      await selectDirectory(result[0])
    }
  }

  return (
    <div
      ref={popoverRef}
      className="fixed z-[60] w-80 rounded-xl border border-gray-200 bg-white p-3 shadow-2xl dark:border-gray-700 dark:bg-gray-800"
      style={position}
      role="dialog"
      aria-label="Directory picker"
    >
      <div className="mb-3">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Directories</p>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">Switch the app working directory or this agent root.</p>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => selectDirectory(currentCwd)}
          className="flex w-full items-start gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700/60"
        >
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
          <div className="min-w-0">
            <div className="font-medium">Current working directory</div>
            <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">{currentCwd || 'Not set'}</div>
          </div>
        </button>

        {visibleRecentDirs.length > 0 && (
          <div className="space-y-1">
            <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">Recent</p>
            {visibleRecentDirs.map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => selectDirectory(dir)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                <span className="truncate">{dir}</span>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
          <input
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void selectDirectory(manualInput)
              }
            }}
            placeholder="Enter path manually"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-900 outline-none ring-0 focus:border-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void selectDirectory(manualInput)}
              className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => void handleBrowse()}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Browse
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
