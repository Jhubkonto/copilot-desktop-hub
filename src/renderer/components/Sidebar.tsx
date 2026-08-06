import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { ResizeHandle } from './ResizeHandle'
import { Button } from './ui/primitives'
import { PROJECT_COLOR_MAP, projectColorHex } from './section-pane/shared'
import { NexyIcon } from './ui/icons'
import { useEmergencyStop } from '../hooks/useEmergencyStop'
import { isApiError } from '../../shared/types'

function NavButton({
  icon,
  label,
  onClick,
  badgeCount,
  ariaLabel,
  active,
  modal,
  running,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  badgeCount?: number
  ariaLabel?: string
  active?: boolean
  modal?: boolean
  running?: boolean
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className={`w-full justify-start px-3 py-1.5 ${active ? 'bg-gray-100 dark:bg-gray-800' : ''}`}
      aria-label={running ? `${ariaLabel ?? label} (working…)` : ariaLabel ?? label}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {running && (
        <span title="Working…"><Loader2 className="w-3 h-3 text-blue-500 animate-spin shrink-0" /></span>
      )}
      {!!badgeCount && badgeCount > 0 && (
        <span className="flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none">
          {badgeCount > 9 ? '9+' : badgeCount}
        </span>
      )}
      {modal && (
        <NexyIcon name="external" size={12} className="text-gray-300 dark:text-gray-600" />
      )}
    </Button>
  )
}

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 480

export function Sidebar() {
  const emergencyStop = useEmergencyStop()
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
  const activeSectionPane = useAppStore((s) => s.activeSectionPane)
  const openSectionPane = useAppStore((s) => s.openSectionPane)
  const setHistoryProjectId = useAppStore((s) => s.setHistoryProjectId)
  const setHistoryAgentId = useAppStore((s) => s.setHistoryAgentId)
  const conversations = useAppStore((s) => s.conversations)
  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const selectConversation = useAppStore((s) => s.selectConversation)
  const agents = useAppStore((s) => s.agents)
  const projects = useAppStore((s) => s.projects)
  const generatingConversationIds = useAppStore((s) => s.generatingConversationIds)
  const unreadConversationIds = useAppStore((s) => s.unreadConversationIds)
  const pendingConversationIds = useAppStore((s) => s.pendingConversationIds)
  const sectionNewCounts = useAppStore((s) => s.sectionNewCounts)
  const clearSectionNewCount = useAppStore((s) => s.clearSectionNewCount)
  const backgroundActivities = useAppStore((s) => s.backgroundActivities)
  const setShowActivityFeed = useAppStore((s) => s.setShowActivityFeed)
  const loadConversations = useAppStore((s) => s.loadConversations)
  const addToast = useAppStore((s) => s.addToast)

  const existingConvIds = new Set(conversations.map((c) => c.id))
  const pendingNew = pendingConversationIds.filter((id) => !existingConvIds.has(id))
  const pinnedConvs = conversations.filter((c) => c.pinned === 1)
  const visiblePinnedConvs = pinnedConvs.slice(0, 5)
  const recentConvs = conversations
    .filter((c) => c.pinned !== 1)
    .slice(0, Math.max(0, 5 - pendingNew.length))

  const [newArtifactCount, setNewArtifactCount] = useState(0)
  const [configuredProviderLabel, setConfiguredProviderLabel] = useState('')
  const [unpinningId, setUnpinningId] = useState<string | null>(null)

  const showSettings = useAppStore((s) => s.showSettings)

  const artifactLastOpenedRef = useRef(Date.now())

  const artifactsPaneOpen = activeSectionPane === 'artifacts'

  useEffect(() => {
    const refresh = async () => {
      try {
        const all = await window.api.artifactList()
        const fresh = all.filter((a) => a.status === 'ready' && a.createdAt > artifactLastOpenedRef.current)
        setNewArtifactCount(fresh.length)
      } catch {
        // Ignore badge refresh failures; the artifacts pane can still load on demand.
      }
    }
    void refresh()
    const interval = setInterval(() => { void refresh() }, 15000)
    return () => clearInterval(interval)
  }, [artifactsPaneOpen])

  useEffect(() => {
    window.api.listProviders()
      .then((providers) => {
        const labels = providers.filter((p) => p.configured).map((p) => p.label)
        setConfiguredProviderLabel(labels.join(' · '))
      })
      .catch(() => {})
  }, [showSettings])

  const unpinConversation = useCallback(async (id: string) => {
    if (unpinningId) return
    setUnpinningId(id)
    try {
      const result = await window.api.setConversationPinned(id, false)
      if (isApiError(result)) throw new Error(result.error)
      await loadConversations()
    } catch {
      addToast('Failed to unpin conversation', 'error')
    } finally {
      setUnpinningId(null)
    }
  }, [addToast, loadConversations, unpinningId])

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
          disabled={emergencyStop.active}
          className="w-full justify-start px-3 py-2 text-sm"
        >
          <NexyIcon name="add" />
          <span>New Chat</span>
        </Button>
        {emergencyStop.active && (
          <p className="px-2 text-[11px] font-medium text-red-600 dark:text-red-400" role="status">
            Conversation starts are frozen
          </p>
        )}
        {backgroundActivities.length > 0 && (
          <NavButton
            icon={<NexyIcon name="spark" size={14} />}
            label="Activity"
            onClick={() => setShowActivityFeed(true)}
            badgeCount={backgroundActivities.length}
            running
            modal
            ariaLabel="Open activity feed"
          />
        )}
        {pinnedConvs.length > 0 && (
          <section aria-labelledby="pinned-chats-heading" className="pt-1">
            <div className="flex items-center justify-between gap-2 px-1 mb-1">
              <p id="pinned-chats-heading" className="nexy-panel-title text-[10px] text-cyan-700 dark:text-cyan-300 uppercase">
                Pinned
              </p>
              <span className="text-[10px] text-cyan-700/70 dark:text-cyan-300/70">{pinnedConvs.length}</span>
            </div>
            <div className="space-y-0.5">
              {visiblePinnedConvs.map((conv) => {
                const isActive = currentConversationId === conv.id
                const isGenerating = generatingConversationIds.includes(conv.id)
                const isUnread = unreadConversationIds.includes(conv.id)
                const project = conv.project_id ? projects.find((p) => p.id === conv.project_id) : null
                const colors = project ? (PROJECT_COLOR_MAP[project.color] ?? PROJECT_COLOR_MAP.blue) : null
                return (
                  <div
                    key={conv.id}
                    className={`group flex items-stretch rounded-md overflow-hidden transition-colors ${
                      isActive
                        ? 'bg-cyan-100 dark:bg-cyan-950/60'
                        : 'hover:bg-cyan-50 dark:hover:bg-cyan-950/30'
                    }`}
                  >
                    {colors ? <span className={`w-1 shrink-0 ${colors.dot}`} style={{ backgroundColor: projectColorHex(project?.color ?? 'blue') }} /> : <span className="w-1 shrink-0 bg-cyan-500/50" />}
                    <button
                      onClick={() => selectConversation(conv.id)}
                      className="flex items-center gap-2 px-2 py-1.5 flex-1 min-w-0 text-left"
                      aria-label={`Open pinned chat ${conv.title}`}
                    >
                      {isGenerating ? (
                        <Loader2 className="w-3 h-3 text-cyan-600 dark:text-cyan-300 animate-spin shrink-0" />
                      ) : isUnread ? (
                        <span className="nexy-notification-dot w-1.5 h-1.5 bg-cyan-500 animate-pulse shrink-0" />
                      ) : (
                        <NexyIcon name="pin" size={11} className="text-cyan-700 dark:text-cyan-300 shrink-0" />
                      )}
                      <span className="text-xs text-gray-700 dark:text-gray-200 truncate">{conv.title}</span>
                    </button>
                    <button
                      onClick={() => { void unpinConversation(conv.id) }}
                      disabled={unpinningId !== null}
                      className="w-7 flex items-center justify-center text-cyan-700 dark:text-cyan-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-40"
                      aria-label={`Unpin ${conv.title}`}
                      title="Unpin"
                    >
                      <NexyIcon name={unpinningId === conv.id ? 'busy' : 'unpin'} size={11} />
                    </button>
                  </div>
                )
              })}
            </div>
            {pinnedConvs.length > visiblePinnedConvs.length && (
              <button
                onClick={() => openSectionPane('chats')}
                className="w-full px-2 pt-1.5 text-left text-[10px] font-medium text-cyan-700 hover:text-cyan-900 dark:text-cyan-300 dark:hover:text-cyan-100"
              >
                View all {pinnedConvs.length}…
              </button>
            )}
          </section>
        )}
        <hr className="border-gray-200 dark:border-gray-700/80" />
        <NavButton
          icon={<NexyIcon name="chat" size={14} />}
          label="Chats"
          badgeCount={unreadConversationIds.length}
          onClick={() => openSectionPane('chats')}
          active={activeSectionPane === 'chats'}
          ariaLabel={`Open chat history${unreadConversationIds.length > 0 ? ` (${unreadConversationIds.length} unread)` : ''}`}
        />
        <NavButton
          icon={<NexyIcon name="project" size={14} />}
          label="Projects"
          badgeCount={sectionNewCounts.projects}
          onClick={() => { setHistoryProjectId(null); openSectionPane('projects'); clearSectionNewCount('projects') }}
          active={activeSectionPane === 'projects'}
          ariaLabel="Open projects"
        />
        <NavButton
          icon={<NexyIcon name="agent" size={14} />}
          label="Agents"
          badgeCount={sectionNewCounts.agents}
          onClick={() => { setHistoryAgentId(null); openSectionPane('agents'); clearSectionNewCount('agents') }}
          active={activeSectionPane === 'agents'}
          ariaLabel="Open agents"
        />
        <NavButton
          icon={<NexyIcon name="skill" size={14} />}
          label="Skills"
          badgeCount={sectionNewCounts.skills}
          onClick={() => { openSectionPane('skills'); clearSectionNewCount('skills') }}
          active={activeSectionPane === 'skills'}
          ariaLabel="Open skills"
        />
        <NavButton
          icon={<NexyIcon name="scheduled" size={14} />}
          label="Schedules"
          badgeCount={sectionNewCounts.scheduled}
          onClick={() => { openSectionPane('scheduled'); clearSectionNewCount('scheduled') }}
          active={activeSectionPane === 'scheduled'}
          ariaLabel="Open schedules"
        />
        <NavButton
          icon={<NexyIcon name="workflow" size={14} />}
          label="Workflows"
          badgeCount={sectionNewCounts.workflows}
          onClick={() => { openSectionPane('workflows'); clearSectionNewCount('workflows') }}
          active={activeSectionPane === 'workflows'}
          ariaLabel="Open automated workflows"
        />
        <hr className="border-gray-200 dark:border-gray-700/80" />
        <NavButton
          icon={<NexyIcon name="artifact" size={14} />}
          label="Artifacts"
          onClick={() => { artifactLastOpenedRef.current = Date.now(); setNewArtifactCount(0); openSectionPane('artifacts') }}
          badgeCount={newArtifactCount}
          active={activeSectionPane === 'artifacts'}
          ariaLabel={`Open Artifacts${newArtifactCount > 0 ? ` (${newArtifactCount} new)` : ''}`}
        />
        <NavButton
          icon={<NexyIcon name="rating" size={14} />}
          label="Ratings"
          onClick={() => openSectionPane('ratings')}
          active={activeSectionPane === 'ratings'}
          ariaLabel="Open ratings"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto mr-1.5 px-3 pb-2">
        {(recentConvs.length > 0 || pendingNew.length > 0) && (
          <div className="mt-2">
            <p className="nexy-panel-title text-[10px] text-gray-400 dark:text-gray-500 uppercase px-1 mb-1">
              Recent
            </p>
            <div className="space-y-0.5">
              {pendingNew.map((id) => (
                <button
                  key={id}
                  onClick={() => selectConversation(id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <span title="Sending…"><Loader2 className="w-3 h-3 text-purple-500 animate-spin shrink-0" /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs text-gray-700 dark:text-gray-200 truncate">New chat</span>
                  </span>
                </button>
              ))}
              {recentConvs.map((conv) => {
                const isActive = currentConversationId === conv.id
                const isGenerating = generatingConversationIds.includes(conv.id)
                const isUnread = unreadConversationIds.includes(conv.id)
                const agent = conv.agent_id ? agents.find((a) => a.id === conv.agent_id) : null
                const project = conv.project_id ? projects.find((p) => p.id === conv.project_id) : null
                const colors = project ? (PROJECT_COLOR_MAP[project.color] ?? PROJECT_COLOR_MAP.blue) : null
                return (
                  <button
                    key={conv.id}
                    onClick={() => selectConversation(conv.id)}
                    className={`w-full flex items-stretch rounded-md text-left transition-colors overflow-hidden ${
                      isActive
                        ? 'bg-gray-200 dark:bg-gray-700'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    {colors
                      ? <span className={`w-1 shrink-0 ${colors.dot}`} style={{ backgroundColor: projectColorHex(project?.color ?? 'blue') }} />
                      : <span className="w-1 shrink-0" />
                    }
                    <span className="flex items-center gap-2 px-2 py-1 flex-1 min-w-0">
                      {isGenerating ? (
                        <span title="Generating…"><Loader2 className="w-3 h-3 text-purple-500 animate-spin shrink-0" /></span>
                      ) : isUnread ? (
                        <span className="nexy-notification-dot w-1.5 h-1.5 bg-blue-500 animate-pulse shrink-0" />
                      ) : (
                        <span className="w-1.5 h-1.5 shrink-0" />
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs text-gray-700 dark:text-gray-200 truncate">{conv.title}</span>
                        <span className="block text-[10px] text-gray-400 dark:text-gray-500 truncate">
                          {agent ? `${agent.icon} ${agent.name}` : project ? project.name : ' '}
                        </span>
                      </span>
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
                ? [
                    authState.clis?.claude && 'Claude CLI',
                    authState.clis?.codex && 'Codex CLI',
                    authState.clis?.hermes && 'Hermes Agent',
                  ].filter(Boolean).join(' + ') || null
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
