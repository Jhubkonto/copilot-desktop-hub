import { useEffect, useRef, useState } from 'react'
import { Minus, Square, X, Menu, Maximize2, ChevronRight, FolderOpen, Pencil, Settings, KeyRound } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { DirectoryPicker } from './DirectoryPicker'
import { ProjectSettingsPanel } from './ProjectSettingsPanel'

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
  const showAgentPanel = useAppStore((s) => s.showAgentPanel)
  const showSidebar = useAppStore((s) => s.showSidebar)
  const activeAgentId = useAppStore((s) => s.activeAgentId)
  const agents = useAppStore((s) => s.agents)
  const conversations = useAppStore((s) => s.conversations)
  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const projects = useAppStore((s) => s.projects)
  const projectConfigs = useAppStore((s) => s.projectConfigs)

  const setShowSettings = useAppStore((s) => s.setShowSettings)
  const setSettingsInitialTab = useAppStore((s) => s.setSettingsInitialTab)
  const pendingKeyHandoffProvider = useAppStore((s) => s.pendingKeyHandoffProvider)
  const setShowMcpPanel = useAppStore((s) => s.setShowMcpPanel)
  const openCreateAgent = useAppStore((s) => s.openCreateAgent)
  const openEditAgent = useAppStore((s) => s.openEditAgent)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const toggleAgentPanel = useAppStore((s) => s.toggleAgentPanel)
  const newChat = useAppStore((s) => s.newChat)
  const addToast = useAppStore((s) => s.addToast)

  const [menuOpen, setMenuOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const [showDirPicker, setShowDirPicker] = useState(false)
  const [showProjectSettings, setShowProjectSettings] = useState(false)
  const [projectSettingsInitialTab, setProjectSettingsInitialTab] = useState<'general' | 'scope' | 'milestones'>('general')
  const [mobileClientCount, setMobileClientCount] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const projSettingsRef = useRef<HTMLDivElement>(null)

  const activeAgent = activeAgentId ? agents.find((a) => a.id === activeAgentId) ?? null : null
  const rootDir = activeAgent?.rootDirectory ?? ''
  const segments = rootDir ? rootDir.replace(/\\/g, '/').split('/').filter(Boolean) : []
  const crumb = segments.length >= 2
    ? `…/${segments.at(-2)}/${segments.at(-1)}`
    : segments[0] ?? ''

  // Determine active project from the current conversation
  const currentConv = currentConversationId ? conversations.find((c) => c.id === currentConversationId) : null
  const activeProjectId = currentConv?.project_id ?? null
  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) ?? null : null
  const projCfg = activeProjectId ? projectConfigs[activeProjectId] : null
  const showProjectBadge = activeProject != null && projCfg?.instructionsEnabled === true && projCfg.instructions?.trim().length > 0
  const activeMilestone = projCfg?.milestones?.find((m) => m.status === 'active') ?? null

  const PROJECT_BADGE_COLORS: Record<string, { bg: string; text: string; border: string; hover: string }> = {
    blue:   { bg: 'bg-blue-50 dark:bg-blue-900/30',     text: 'text-blue-600 dark:text-blue-400',     border: 'border-blue-200 dark:border-blue-700',     hover: 'hover:bg-blue-100 dark:hover:bg-blue-900/50' },
    green:  { bg: 'bg-green-50 dark:bg-green-900/30',   text: 'text-green-600 dark:text-green-400',   border: 'border-green-200 dark:border-green-700',   hover: 'hover:bg-green-100 dark:hover:bg-green-900/50' },
    red:    { bg: 'bg-red-50 dark:bg-red-900/30',       text: 'text-red-600 dark:text-red-400',       border: 'border-red-200 dark:border-red-700',       hover: 'hover:bg-red-100 dark:hover:bg-red-900/50' },
    purple: { bg: 'bg-purple-50 dark:bg-purple-900/30', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-200 dark:border-purple-700', hover: 'hover:bg-purple-100 dark:hover:bg-purple-900/50' },
    orange: { bg: 'bg-orange-50 dark:bg-orange-900/30', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-700', hover: 'hover:bg-orange-100 dark:hover:bg-orange-900/50' },
    pink:   { bg: 'bg-pink-50 dark:bg-pink-900/30',     text: 'text-pink-600 dark:text-pink-400',     border: 'border-pink-200 dark:border-pink-700',     hover: 'hover:bg-pink-100 dark:hover:bg-pink-900/50' },
    yellow: { bg: 'bg-yellow-50 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-400', border: 'border-yellow-200 dark:border-yellow-500', hover: 'hover:bg-yellow-100 dark:hover:bg-yellow-900/50' },
    gray:   { bg: 'bg-gray-100 dark:bg-gray-800',       text: 'text-gray-600 dark:text-gray-400',     border: 'border-gray-200 dark:border-gray-700',     hover: 'hover:bg-gray-200 dark:hover:bg-gray-700' },
  }
  const badgeColors = PROJECT_BADGE_COLORS[activeProject?.color ?? 'blue'] ?? PROJECT_BADGE_COLORS.blue

  useEffect(() => {
    window.api.isWindowMaximized().then(setIsMaximized)
    const unsub = window.api.onMaximizeChange((maximized) => setIsMaximized(maximized))
    return () => { unsub() }
  }, [])

  useEffect(() => {
    const unsub = window.api.onMobileClientCount((count) => setMobileClientCount(count))
    return () => { unsub() }
  }, [])

  // Close project settings popover on outside click
  useEffect(() => {
    if (!showProjectSettings) return
    const handler = (e: MouseEvent) => {
      if (projSettingsRef.current && !projSettingsRef.current.contains(e.target as Node)) {
        setShowProjectSettings(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showProjectSettings])

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
    addToast(`Nexy v${version}`, 'info')
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

      {/* Quick access to settings — no-drag */}
      <button
        onClick={() => setShowSettings(true)}
        className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
        style={NO_DRAG}
        aria-label="Open settings"
        title="Settings"
      >
        <Settings className="w-4 h-4" />
      </button>

      {/* Key-handoff request indicator — clickable, opens Providers so the user can approve/reject */}
      {pendingKeyHandoffProvider && (
        <button
          onClick={() => {
            setSettingsInitialTab('providers')
            setShowSettings(true)
          }}
          className="ml-1 h-7 w-7 inline-flex items-center justify-center rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 transition-colors relative"
          style={NO_DRAG}
          aria-label={`Android is requesting the ${pendingKeyHandoffProvider} API key — review request`}
          title={`Android is requesting the ${pendingKeyHandoffProvider} API key — click to review`}
        >
          <KeyRound className="w-4 h-4" />
          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-blue-500" />
        </button>
      )}

      {/* Active agent badge — also no-drag */}
      {activeAgent && (
        <span
          className="ml-1 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
          style={NO_DRAG}
        >
          {activeAgent.icon} {activeAgent.name}
        </span>
      )}

      {activeAgent && (
        <button
          type="button"
          onClick={() => openEditAgent(activeAgentId!)}
          className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          style={NO_DRAG}
          aria-label="Edit agent"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}

      {crumb && (
        <>
          <button
            type="button"
            onClick={() => setShowDirPicker(true)}
            className="ml-1 inline-flex items-center gap-1 rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            style={NO_DRAG}
            aria-label="Change directory"
            data-directory-breadcrumb="true"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span>{crumb}</span>
          </button>
          {showDirPicker && (
            <DirectoryPicker
              agentId={activeAgentId ?? null}
              onClose={() => setShowDirPicker(false)}
            />
          )}
        </>
      )}

      {/* Project badge + milestone badge + Android connected badge cluster */}
      <div className="flex items-center gap-1.5" style={NO_DRAG}>
        {(showProjectBadge || activeMilestone) && activeProject && (
          <div className="relative flex items-center gap-1.5" ref={projSettingsRef}>
            {showProjectBadge && (
              <button
                type="button"
                onClick={() => { setProjectSettingsInitialTab('general'); setShowProjectSettings((v) => !v) }}
                className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border transition-colors ${badgeColors.bg} ${badgeColors.text} ${badgeColors.border} ${badgeColors.hover}`}
                aria-label="Project settings"
              >
                <span>📁</span>
                <span className="max-w-[120px] truncate">{activeProject.name}</span>
              </button>
            )}

            {activeMilestone && (
              <button
                type="button"
                onClick={() => { setProjectSettingsInitialTab('milestones'); setShowProjectSettings(true) }}
                title={activeMilestone.description ?? activeMilestone.title}
                className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border transition-colors ${badgeColors.bg} ${badgeColors.text} ${badgeColors.border} ${badgeColors.hover}`}
                aria-label={`Active milestone: ${activeMilestone.title}`}
              >
                <span>🎯</span>
                <span className="max-w-[100px] truncate">{activeMilestone.title}</span>
              </button>
            )}

            {showProjectSettings && (
              <div className="absolute left-0 top-8 z-50 w-96 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl overflow-hidden">
                <ProjectSettingsPanel
                  key={`${activeProject.id}-${projectSettingsInitialTab}`}
                  projectId={activeProject.id}
                  initialTab={projectSettingsInitialTab}
                  onClose={() => setShowProjectSettings(false)}
                />
              </div>
            )}
          </div>
        )}

        {/* Android connected indicator badge */}
        {mobileClientCount > 0 && (
          <div className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border transition-colors bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-700" title={`${mobileClientCount} Android client${mobileClientCount === 1 ? '' : 's'} connected`} aria-label={`${mobileClientCount} Android client${mobileClientCount === 1 ? '' : 's'} connected`}>
            <span>📱</span>
            <span>{mobileClientCount}</span>
          </div>
        )}
      </div>

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
