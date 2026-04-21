import { useEffect, useRef, useState } from 'react'
import { Minus, Square, X, Menu, Maximize2, ChevronRight } from 'lucide-react'
import { useAppStore } from '../store/app-store'

// TypeScript doesn't include WebkitAppRegion in CSSProperties
type DragStyle = React.CSSProperties & { WebkitAppRegion: 'drag' | 'no-drag' }
const DRAG: DragStyle = { WebkitAppRegion: 'drag' }
const NO_DRAG: DragStyle = { WebkitAppRegion: 'no-drag' }

type MenuItemDef =
  | { type: 'item'; label: string; shortcut?: string; action: () => void }
  | { type: 'separator' }

type SectionDef = {
  id: string
  label: string
  items: MenuItemDef[]
}

function SubMenuItem({ def }: { def: MenuItemDef }) {
  if (def.type === 'separator') {
    return <div className="my-1 h-px bg-gray-100 dark:bg-gray-700/60" />
  }
  return (
    <button
      type="button"
      onClick={def.action}
      className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md whitespace-nowrap"
    >
      <span>{def.label}</span>
      {def.shortcut && (
        <span className="ml-6 text-xs text-gray-400 dark:text-gray-500">{def.shortcut}</span>
      )}
    </button>
  )
}

function SectionItem({
  section,
  isActive,
  onMouseEnter,
  onMouseLeave,
}: {
  section: SectionDef
  isActive: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  return (
    <div
      className="relative"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        type="button"
        className={`w-full flex items-center justify-between px-3 py-1.5 text-sm rounded-md transition-colors ${
          isActive
            ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
            : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}
      >
        <span>{section.label}</span>
        <ChevronRight className="w-3.5 h-3.5 ml-4 text-gray-400 dark:text-gray-500" />
      </button>

      {isActive && (
        <div className="absolute left-full top-0 ml-0.5 z-50 min-w-[200px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl p-1.5">
          {section.items.map((item, i) => (
            <SubMenuItem key={i} def={item} />
          ))}
        </div>
      )}
    </div>
  )
}

export function TitleBar() {
  const theme = useAppStore((s) => s.theme)
  const showTerminal = useAppStore((s) => s.showTerminal)
  const showAgentPanel = useAppStore((s) => s.showAgentPanel)
  const showSidebar = useAppStore((s) => s.showSidebar)
  const activeAgentId = useAppStore((s) => s.activeAgentId)
  const agents = useAppStore((s) => s.agents)

  const setShowSettings = useAppStore((s) => s.setShowSettings)
  const setShowMcpPanel = useAppStore((s) => s.setShowMcpPanel)
  const openCreateAgent = useAppStore((s) => s.openCreateAgent)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const toggleTerminal = useAppStore((s) => s.toggleTerminal)
  const toggleAgentPanel = useAppStore((s) => s.toggleAgentPanel)
  const newChat = useAppStore((s) => s.newChat)
  const addToast = useAppStore((s) => s.addToast)

  const [menuOpen, setMenuOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const activeAgent = activeAgentId ? agents.find((a) => a.id === activeAgentId) ?? null : null

  useEffect(() => {
    window.api.isWindowMaximized().then(setIsMaximized)
    const unsub = window.api.onMaximizeChange((maximized) => setIsMaximized(maximized))
    return () => { unsub() }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setActiveSection(null)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const close = () => {
    setMenuOpen(false)
    setActiveSection(null)
  }

  const handleAbout = async () => {
    close()
    const version = await window.api.getVersion()
    addToast(`Copilot Desktop Hub v${version}`, 'info')
  }

  const sections: SectionDef[] = [
    {
      id: 'file',
      label: 'File',
      items: [
        { type: 'item', label: 'New Chat', shortcut: 'Ctrl+N', action: () => { close(); newChat() } },
        { type: 'separator' },
        { type: 'item', label: 'Settings', action: () => { close(); setShowSettings(true) } },
        { type: 'separator' },
        { type: 'item', label: 'Quit', action: () => { close(); window.api.closeWindow() } },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        { type: 'item', label: 'Undo', shortcut: 'Ctrl+Z', action: () => { close(); window.api.editAction('undo') } },
        { type: 'item', label: 'Redo', shortcut: 'Ctrl+Y', action: () => { close(); window.api.editAction('redo') } },
        { type: 'separator' },
        { type: 'item', label: 'Cut', shortcut: 'Ctrl+X', action: () => { close(); window.api.editAction('cut') } },
        { type: 'item', label: 'Copy', shortcut: 'Ctrl+C', action: () => { close(); window.api.editAction('copy') } },
        { type: 'item', label: 'Paste', shortcut: 'Ctrl+V', action: () => { close(); window.api.editAction('paste') } },
        { type: 'item', label: 'Select All', shortcut: 'Ctrl+A', action: () => { close(); window.api.editAction('selectAll') } },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        { type: 'item', label: showSidebar ? 'Hide Sidebar' : 'Show Sidebar', action: () => { close(); toggleSidebar() } },
        { type: 'item', label: showTerminal ? 'Hide Terminal' : 'Show Terminal', action: () => { close(); toggleTerminal() } },
        { type: 'item', label: showAgentPanel ? 'Hide Agent Panel' : 'Show Agent Panel', action: () => { close(); toggleAgentPanel() } },
        { type: 'separator' },
        { type: 'item', label: 'Zoom In', shortcut: 'Ctrl+=', action: () => { close(); window.api.zoomIn() } },
        { type: 'item', label: 'Zoom Out', shortcut: 'Ctrl+−', action: () => { close(); window.api.zoomOut() } },
        { type: 'item', label: 'Reset Zoom', shortcut: 'Ctrl+0', action: () => { close(); window.api.resetZoom() } },
      ],
    },
    {
      id: 'window',
      label: 'Window',
      items: [
        { type: 'item', label: 'Minimize', action: () => { close(); window.api.minimizeWindow() } },
        { type: 'item', label: isMaximized ? 'Restore' : 'Maximize', action: () => { close(); window.api.maximizeWindow() } },
        { type: 'separator' },
        { type: 'item', label: 'Agent Builder', action: () => { close(); openCreateAgent() } },
        { type: 'item', label: 'MCP Servers', action: () => { close(); setShowMcpPanel(true) } },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        { type: 'item', label: 'About', action: handleAbout },
        { type: 'item', label: 'Check for Updates', action: () => { close(); window.api.checkForUpdates() } },
      ],
    },
  ]

  return (
    <div
      className={`flex items-center h-9 shrink-0 border-b border-gray-200 dark:border-gray-700/80 select-none ${theme === 'dark' ? 'dark' : ''} bg-white dark:bg-gray-900`}
      style={DRAG}
    >
      {/* Hamburger + flyout menu — entire cluster is no-drag */}
      <div className="relative flex items-center px-1.5" style={NO_DRAG} ref={menuRef}>
        <button
          onClick={() => {
            setMenuOpen((prev) => !prev)
            setActiveSection(null)
          }}
          className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
          aria-label="Open menu"
          aria-expanded={menuOpen}
        >
          <Menu className="w-4 h-4" />
        </button>

        {menuOpen && (
          <div className="absolute left-0 top-8 z-50 w-44 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl p-1.5">
            {sections.map((section) => (
              <SectionItem
                key={section.id}
                section={section}
                isActive={activeSection === section.id}
                onMouseEnter={() => setActiveSection(section.id)}
                onMouseLeave={() => setActiveSection(null)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Active agent badge — also no-drag */}
      {activeAgent && (
        <span
          className="ml-1 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
          style={NO_DRAG}
        >
          {activeAgent.icon} {activeAgent.name}
        </span>
      )}

      {/* Drag region fills remaining space */}
      <div className="flex-1" style={DRAG} />

      {/* Window controls — no-drag */}
      <div className="flex items-stretch h-full" style={NO_DRAG}>
        <button
          onClick={() => window.api.minimizeWindow()}
          className="h-full w-11 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => window.api.maximizeWindow()}
          className="h-full w-11 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <Maximize2 className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={() => window.api.closeWindow()}
          className="h-full w-11 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-red-500 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
