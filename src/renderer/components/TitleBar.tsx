import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/app-store'
import { DirectoryPicker } from './DirectoryPicker'
import { ProjectSettingsPanel } from './ProjectSettingsPanel'
import { useClickOutside } from '../hooks/useClickOutside'
import { PROJECT_BADGE_COLOR_MAP } from './section-pane/shared'
import { NexyIcon } from './ui/icons'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { useEmergencyStop } from '../hooks/useEmergencyStop'

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

type WindowCaptionIconKind = 'minimize' | 'maximize' | 'restore'

/** Windows 10 caption glyphs, kept separate from content-level expand/minimize icons. */
function WindowCaptionIcon({ kind }: { kind: WindowCaptionIconKind }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-window-caption-icon={kind}
    >
      {kind === 'minimize' && <path d="M1 9h10v1H1z" />}
      {kind === 'maximize' && (
        <path fillRule="evenodd" d="M1 1h10v10H1V1zm1 1v8h8V2H2z" />
      )}
      {kind === 'restore' && (
        <path fillRule="evenodd" d="M3 1h8v8h-1V2H3V1zM1 3h8v8H1V3zm1 1v6h6V4H2z" />
      )}
    </svg>
  )
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
        <NexyIcon name="chevron-right" size={14} className="ml-4 text-gray-400 dark:text-gray-500" />
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
  const emergencyStop = useEmergencyStop()
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
  const buildNotifications = useAppStore((s) => s.buildNotifications)
  const clearBuildNotifications = useAppStore((s) => s.clearBuildNotifications)
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
  const [showEmergencyStopConfirmation, setShowEmergencyStopConfirmation] = useState(false)
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

  const badgeColors = PROJECT_BADGE_COLOR_MAP[activeProject?.color ?? 'blue'] ?? PROJECT_BADGE_COLOR_MAP.blue

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
  useClickOutside(projSettingsRef, () => setShowProjectSettings(false), showProjectSettings)

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

  const handleCheckForUpdates = async () => {
    close()
    const result = await window.api.checkForUpdates()
    if (result.updateAvailable) {
      addToast(`Update v${result.latestVersion} is available`, 'info')
    } else {
      addToast(`You're up to date${result.currentVersion ? ` (v${result.currentVersion})` : ''}`, 'info')
    }
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
        { type: 'item', label: 'Check for Updates', action: () => { void handleCheckForUpdates() } },
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
          <NexyIcon name="menu" />
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
        <NexyIcon name="settings" />
      </button>

      {/* Emergency stop / resume — compact, but always available beside Settings. */}
      <button
        onClick={() => {
          if (emergencyStop.active) void emergencyStop.resume()
          else setShowEmergencyStopConfirmation(true)
        }}
        disabled={emergencyStop.busy}
        className={`h-7 w-7 inline-flex items-center justify-center rounded transition-colors disabled:cursor-wait disabled:opacity-60 ${
          emergencyStop.active
            ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-900/50'
            : 'text-gray-500 hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-950/40 dark:hover:text-red-400'
        }`}
        style={NO_DRAG}
        aria-label={emergencyStop.active ? 'Resume conversations' : 'Emergency stop all conversations'}
        aria-pressed={emergencyStop.active}
        title={emergencyStop.active ? 'Resume conversations' : 'Emergency stop'}
      >
        <NexyIcon name={emergencyStop.active ? 'play' : 'stop'} />
      </button>

      {/* Build/package completion indicator — the one notification kind that lives in the top bar
          instead of next to a sidebar section, since it's triggered from Settings rather than
          from a project/agent-style list. */}
      {buildNotifications.length > 0 && (
        <button
          onClick={() => {
            setSettingsInitialTab('developer')
            setShowSettings(true)
            clearBuildNotifications()
          }}
          className={`ml-1 h-7 w-7 inline-flex items-center justify-center rounded transition-colors relative ${
            buildNotifications.some((n) => n.status === 'failed')
              ? 'hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400'
              : 'hover:bg-green-100 dark:hover:bg-green-900/40 text-green-600 dark:text-green-400'
          }`}
          style={NO_DRAG}
          aria-label={`${buildNotifications.length} build notification${buildNotifications.length === 1 ? '' : 's'} — click to review`}
          title={buildNotifications.map((n) => n.label).join(', ')}
        >
          <NexyIcon name="tool" />
          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-current" />
        </button>
      )}

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
          <NexyIcon name="key" />
          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-blue-500" />
        </button>
      )}

      {showEmergencyStopConfirmation && (
        <ConfirmDialog
          title="Emergency stop all conversations?"
          ariaLabel="Confirm emergency stop"
          confirmLabel="Emergency stop"
          irreversible={false}
          busy={emergencyStop.busy}
          icon={<NexyIcon name="stop" size={20} />}
          onCancel={() => setShowEmergencyStopConfirmation(false)}
          onConfirm={() => {
            void emergencyStop.activate().then(() => setShowEmergencyStopConfirmation(false))
          }}
        >
          This immediately cancels every active response and blocks new messages until you explicitly resume.
        </ConfirmDialog>
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
          <NexyIcon name="edit" size={14} />
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
            <NexyIcon name="project" size={14} />
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
                <NexyIcon name="project" size={14} />
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
                <NexyIcon name="milestone" size={14} />
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
            <NexyIcon name="mobile" size={14} />
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
          <WindowCaptionIcon kind="minimize" />
        </button>
        <button
          onClick={() => window.api.maximizeWindow()}
          className="h-full w-11 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          <WindowCaptionIcon kind={isMaximized ? 'restore' : 'maximize'} />
        </button>
        <button
          onClick={() => window.api.closeWindow()}
          className="h-full w-11 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-red-500 hover:text-white transition-colors"
          aria-label="Close"
        >
          <NexyIcon name="close" size={14} />
        </button>
      </div>
    </div>
  )
}
