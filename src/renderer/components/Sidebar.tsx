import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import { Plus, MessageSquare, Settings, FolderOpen, Bot, Wrench, Package, Bug, SquareArrowOutUpRight, Loader2 } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { ResizeHandle } from './ResizeHandle'
import { Button } from './ui/primitives'

function NavButton({
  icon,
  label,
  onClick,
  badgeCount,
  ariaLabel,
  active,
  modal,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  badgeCount?: number
  ariaLabel?: string
  active?: boolean
  modal?: boolean
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className={`w-full justify-start px-3 py-1.5 ${active ? 'bg-gray-100 dark:bg-gray-800' : ''}`}
      aria-label={ariaLabel ?? label}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {!!badgeCount && badgeCount > 0 && (
        <span className="flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none">
          {badgeCount > 9 ? '9+' : badgeCount}
        </span>
      )}
      {modal && (
        <SquareArrowOutUpRight className="w-3 h-3 text-gray-300 dark:text-gray-600 shrink-0" />
      )}
    </Button>
  )
}

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 480

export function Sidebar() {
  const sidebarRef = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(256)

  const getMaxSize = useCallback(() => Math.min(SIDEBAR_MAX, Math.floor(window.innerWidth * 0.32)), [])

  const handleSetSize = useCallback((size: number) => {
    setWidth(Math.max(SIDEBAR_MIN, Math.min(getMaxSize(), size)))
  }, [getMaxSize])

  const authState = useAppStore((s) => s.authState)

  const newChat = useAppStore((s) => s.newChat)
  const logout = useAppStore((s) => s.logout)
  const setShowSettings = useAppStore((s) => s.setShowSettings)
  const setShowSelfHealPanel = useAppStore((s) => s.setShowSelfHealPanel)
  const setShowArtifactsPanel = useAppStore((s) => s.setShowArtifactsPanel)
  const openBugReport = useAppStore((s) => s.openBugReport)
  const activeSectionPane = useAppStore((s) => s.activeSectionPane)
  const openSectionPane = useAppStore((s) => s.openSectionPane)
  const setHistoryProjectId = useAppStore((s) => s.setHistoryProjectId)
  const setHistoryAgentId = useAppStore((s) => s.setHistoryAgentId)
  const conversations = useAppStore((s) => s.conversations)
  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const selectConversation = useAppStore((s) => s.selectConversation)
  const agents = useAppStore((s) => s.agents)
  const generatingConversationIds = useAppStore((s) => s.generatingConversationIds)
  const unreadConversationIds = useAppStore((s) => s.unreadConversationIds)

  const recentConvs = conversations.slice(0, 5)

  const [openReportCount, setOpenReportCount] = useState(0)
  const [newArtifactCount, setNewArtifactCount] = useState(0)
  const [configuredProviderLabel, setConfiguredProviderLabel] = useState('')

  const showSelfHealPanel = useAppStore((s) => s.showSelfHealPanel)
  const showArtifactsPanel = useAppStore((s) => s.showArtifactsPanel)
  const showSettings = useAppStore((s) => s.showSettings)

  const artifactLastOpenedRef = useRef(Date.now())

  useEffect(() => {
    if (typeof window.api.listErrorReports !== 'function') return
    const refresh = () => {
      window.api.listErrorReports(25)
        .then((reports) => setOpenReportCount(reports.filter((r) => r.status === 'open').length))
        .catch(() => {})
    }
    refresh()
    const interval = setInterval(refresh, 30000)
    return () => clearInterval(interval)
  }, [showSelfHealPanel])

  useEffect(() => {
    const refresh = async () => {
      try {
        const all = await window.api.artifactList()
        const fresh = all.filter((a) => a.status === 'ready' && a.createdAt > artifactLastOpenedRef.current)
        setNewArtifactCount(fresh.length)
      } catch {}
    }
    void refresh()
    const interval = setInterval(() => { void refresh() }, 15000)
    return () => clearInterval(interval)
  }, [showArtifactsPanel])

  useEffect(() => {
    window.api.listProviders()
      .then((providers) => {
        const labels = providers.filter((p) => p.configured).map((p) => p.label)
        setConfiguredProviderLabel(labels.join(' · '))
      })
      .catch(() => {})
  }, [showSettings])

  return (
    <aside
      ref={sidebarRef}
      className="h-full flex flex-col shrink-0 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700/80 relative"
      style={{ width }}
      role="complementary"
      aria-label="Sidebar navigation"
    >
      <ResizeHandle direction="horizontal" containerRef={sidebarRef} onSetSize={handleSetSize} minSize={SIDEBAR_MIN} maxSize={getMaxSize} />
      <div className="flex items-center px-4 h-9 border-b border-gray-200 dark:border-gray-700/80">
        <span className="flex items-center justify-center rounded bg-black px-2 h-[22px] text-[13px] font-bold italic leading-none tracking-tight select-none"><span className="text-purple-400">N</span><span className="text-white">exy</span></span>
      </div>

      <div className="p-3 space-y-2">
        <Button
          variant="primary"
          onClick={() => newChat()}
          className="w-full justify-start px-3 py-2 text-sm"
        >
          <Plus className="w-4 h-4" />
          <span>New Chat</span>
        </Button>
        <hr className="border-gray-200 dark:border-gray-700/80" />
        <NavButton
          icon={<MessageSquare className="w-3.5 h-3.5" />}
          label="Chats"
          onClick={() => openSectionPane('chats')}
          active={activeSectionPane === 'chats'}
          ariaLabel="Open chat history"
        />
        <NavButton
          icon={<FolderOpen className="w-3.5 h-3.5" />}
          label="Projects"
          onClick={() => { setHistoryProjectId(null); openSectionPane('projects') }}
          active={activeSectionPane === 'projects'}
          ariaLabel="Open projects"
        />
        <NavButton
          icon={<Bot className="w-3.5 h-3.5" />}
          label="Agents"
          onClick={() => { setHistoryAgentId(null); openSectionPane('agents') }}
          active={activeSectionPane === 'agents'}
          ariaLabel="Open agents"
        />
        <hr className="border-gray-200 dark:border-gray-700/80" />
        <NavButton
          icon={<Package className="w-3.5 h-3.5" />}
          label="Artifacts"
          onClick={() => { artifactLastOpenedRef.current = Date.now(); setNewArtifactCount(0); setShowArtifactsPanel(true) }}
          badgeCount={newArtifactCount}
          ariaLabel={`Open Artifacts${newArtifactCount > 0 ? ` (${newArtifactCount} new)` : ''}`}
          modal
        />
        <hr className="border-gray-200 dark:border-gray-700/80" />
        <NavButton
          icon={<Wrench className="w-3.5 h-3.5" />}
          label="Self-Heal"
          onClick={() => setShowSelfHealPanel(true)}
          badgeCount={openReportCount}
          ariaLabel={`Open Self-Heal${openReportCount > 0 ? ` (${openReportCount} new report${openReportCount === 1 ? '' : 's'})` : ''}`}
          modal
        />
        <NavButton
          icon={<Bug className="w-3.5 h-3.5" />}
          label="Report a bug"
          onClick={() => openBugReport()}
          ariaLabel="Report a bug"
          modal
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
        {recentConvs.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1 mb-1">
              Recent
            </p>
            <div className="space-y-0.5">
              {recentConvs.map((conv) => {
                const isActive = currentConversationId === conv.id
                const isGenerating = generatingConversationIds.includes(conv.id)
                const isUnread = unreadConversationIds.includes(conv.id)
                const agent = conv.agent_id ? agents.find((a) => a.id === conv.agent_id) : null
                return (
                  <button
                    key={conv.id}
                    onClick={() => selectConversation(conv.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                      isActive
                        ? 'bg-gray-200 dark:bg-gray-700'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    {isGenerating ? (
                      <span title="Generating…"><Loader2 className="w-3 h-3 text-purple-500 animate-spin shrink-0" /></span>
                    ) : isUnread ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
                    ) : (
                      <span className="w-1.5 h-1.5 shrink-0" />
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs text-gray-700 dark:text-gray-200 truncate">{conv.title}</span>
                      {agent && (
                        <span className="block text-[10px] text-gray-400 dark:text-gray-500 truncate">
                          {agent.icon} {agent.name}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-gray-200 dark:border-gray-700/80">
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <div className="min-w-0">
            {(() => {
              const cliLabel = authState.cliInstalled
                ? (authState.clis?.claude && authState.clis?.codex ? 'Claude CLI + Codex CLI' : authState.clis?.codex ? 'Codex CLI' : 'Claude CLI')
                : null
              const hasAny = cliLabel || configuredProviderLabel
              const subtitle = hasAny
                ? (authState.cliInstalled ? 'Ready to chat' : 'BYOK mode is active')
                : 'Add an API key in Settings'
              return (
                <>
                  {cliLabel && (
                    <div className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{cliLabel}</div>
                  )}
                  {configuredProviderLabel && (
                    <div className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate" title={configuredProviderLabel}>{configuredProviderLabel}</div>
                  )}
                  {!hasAny && (
                    <div className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">No provider configured</div>
                  )}
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{subtitle}</div>
                </>
              )
            })()}
          </div>
          {authState.authenticated ? (
            <button
              onClick={logout}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              title="Clear provider mode"
            >
              Clear
            </button>
          ) : (
            <button
              onClick={() => setShowSettings(true)}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              title="Open settings"
            >
              Settings
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
