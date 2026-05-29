import { useState, useCallback, useRef, useEffect } from 'react'
import { Plus, MessageSquare, Settings, X, LogIn, Upload, Pin, FolderOpen, Folder, Cpu, ChevronDown, ChevronRight, Check } from 'lucide-react'
import { SearchBar } from './SearchBar'
import { useAppStore } from '../store/app-store'
import type { Conversation, Project } from '../store/types'
import { ResizeHandle } from './ResizeHandle'
import { MODEL_OPTIONS, getModelLabel } from '../../shared/models'
import { DeleteConversationDialog } from './DeleteConversationDialog'
import { formatRelativeTime } from '../../shared/utils'

interface DateGroup {
  label: string
  conversations: Conversation[]
}

function groupByDate(conversations: Conversation[]): DateGroup[] {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86400000
  const weekStart = todayStart - 7 * 86400000

  const groups: DateGroup[] = []

  const today = conversations.filter((c) => c.updated_at >= todayStart)
  const yesterday = conversations.filter(
    (c) => c.updated_at >= yesterdayStart && c.updated_at < todayStart
  )
  const thisWeek = conversations.filter(
    (c) => c.updated_at >= weekStart && c.updated_at < yesterdayStart
  )
  const older = conversations.filter((c) => c.updated_at < weekStart)

  if (today.length) groups.push({ label: 'Today', conversations: today })
  if (yesterday.length) groups.push({ label: 'Yesterday', conversations: yesterday })
  if (thisWeek.length) groups.push({ label: 'This Week', conversations: thisWeek })
  if (older.length) groups.push({ label: 'Older', conversations: older })

  return groups
}

function isPinned(conversation: Conversation): boolean {
  return conversation.pinned === 1
}

const PROJECT_COLOR_MAP: Record<string, { bg: string; dot: string }> = {
  blue:   { bg: 'bg-blue-100 dark:bg-blue-900/40',   dot: 'bg-blue-500' },
  green:  { bg: 'bg-green-100 dark:bg-green-900/40', dot: 'bg-green-500' },
  red:    { bg: 'bg-red-100 dark:bg-red-900/40',     dot: 'bg-red-500' },
  purple: { bg: 'bg-purple-100 dark:bg-purple-900/40', dot: 'bg-purple-500' },
  orange: { bg: 'bg-orange-100 dark:bg-orange-900/40', dot: 'bg-orange-500' },
  pink:   { bg: 'bg-pink-100 dark:bg-pink-900/40',   dot: 'bg-pink-500' },
  yellow: { bg: 'bg-yellow-100 dark:bg-yellow-900/40', dot: 'bg-yellow-500' },
  gray:   { bg: 'bg-gray-100 dark:bg-gray-800',      dot: 'bg-gray-400' },
}
const COLOR_OPTIONS = Object.keys(PROJECT_COLOR_MAP)

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 560

export function Sidebar() {
  const sidebarRef = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(256)
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [agentsOpen, setAgentsOpen] = useState(true)
  const [chatsOpen, setChatsOpen] = useState(true)

  const handleSetSize = useCallback((size: number) => {
    setWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, size)))
  }, [])

  const currentConversationId = useAppStore((s) => s.currentConversationId)
  const conversations = useAppStore((s) => s.conversations)
  const authState = useAppStore((s) => s.authState)
  const agents = useAppStore((s) => s.agents)
  const activeAgentId = useAppStore((s) => s.activeAgentId)
  const authLoading = useAppStore((s) => s.authLoading)
  const conversationsLoading = useAppStore((s) => s.conversationsLoading)
  const agentsLoading = useAppStore((s) => s.agentsLoading)
  const projects = useAppStore((s) => s.projects)
  const activeProjectId = useAppStore((s) => s.activeProjectId)

  const selectConversation = useAppStore((s) => s.selectConversation)
  const newChat = useAppStore((s) => s.newChat)
  const deleteConversation = useAppStore((s) => s.deleteConversation)
  const loadConversations = useAppStore((s) => s.loadConversations)
  const login = useAppStore((s) => s.login)
  const logout = useAppStore((s) => s.logout)
  const selectAgent = useAppStore((s) => s.selectAgent)
  const openEditAgent = useAppStore((s) => s.openEditAgent)
  const openCreateAgent = useAppStore((s) => s.openCreateAgent)
  const importAgent = useAppStore((s) => s.importAgent)
  const addToast = useAppStore((s) => s.addToast)
  const selectProject = useAppStore((s) => s.selectProject)
  const openEditProject = useAppStore((s) => s.openEditProject)
  const addAgentToProject = useAppStore((s) => s.addAgentToProject)
  const projectAgents = useAppStore((s) => s.projectAgents)
  const setConversationProject = useAppStore((s) => s.setConversationProject)
  const activeSectionPane = useAppStore((s) => s.activeSectionPane)
  const setSectionPane = useAppStore((s) => s.setSectionPane)
  const setHistoryProjectId = useAppStore((s) => s.setHistoryProjectId)
  const historyProjectId = useAppStore((s) => s.historyProjectId)
  const setShowNewProjectForm = useAppStore((s) => s.setShowNewProjectForm)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [pendingDeleteConv, setPendingDeleteConv] = useState<{ id: string; title: string } | null>(null)

  // Conversation project picker state
  const [convProjectPickerId, setConvProjectPickerId] = useState<string | null>(null)
  const convProjectPickerRef = useRef<HTMLDivElement>(null)
  const [sidebarDragOverProjectId, setSidebarDragOverProjectId] = useState<string | null>(null)

  useEffect(() => {
    if (!convProjectPickerId) return
    const onPointerDown = (e: MouseEvent) => {
      if (convProjectPickerRef.current && !convProjectPickerRef.current.contains(e.target as Node)) {
        setConvProjectPickerId(null)
      }
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [convProjectPickerId])

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query)
    if (!query) {
      setSearchResults(null)
      return
    }
    try {
      const results = await window.api.searchConversations(query)
      setSearchResults(results)
    } catch {
      setSearchResults(null)
    }
  }, [])

  const handleRename = async () => {
    if (editingId && editTitle.trim()) {
      try {
        await window.api.renameConversation(editingId, editTitle.trim())
        loadConversations()
      } catch {
        addToast('Failed to rename conversation', 'error')
      }
    }
    setEditingId(null)
  }


  // When a project is selected
  // Search results are also filtered by active project.
  const baseConversations = searchResults ?? conversations
  const filteredConversations = activeProjectId === '__none__'
    ? baseConversations.filter((c) => !c.project_id)
    : activeProjectId !== null
      ? baseConversations.filter((c) => c.project_id === activeProjectId)
      : baseConversations

  const pinnedConversations = filteredConversations.filter(isPinned)
  const unpinnedConversations = filteredConversations.filter((c) => !isPinned(c))
  const dateGroups = groupByDate(unpinnedConversations)

  const renderConversation = (conv: Conversation) => {
    const agentForConv = agents.find((a) => a.id === conv.agent_id)
    const isPickingProject = convProjectPickerId === conv.id
    return (
      <div
        key={conv.id}
        className={`group relative flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors ${
          currentConversationId === conv.id
            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
        }`}
        onClick={() => selectConversation(conv.id)}
      >
        <div className="flex-1 min-w-0">
          {editingId === conv.id ? (
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename()
                if (e.key === 'Escape') setEditingId(null)
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              className="w-full text-xs font-medium bg-white dark:bg-gray-700 border border-blue-400 rounded px-1 py-0.5 focus:outline-none"
            />
          ) : (
            <div
              className="truncate text-xs font-medium"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditingId(conv.id)
                setEditTitle(conv.title)
              }}
              title="Double-click to rename"
            >
              {agentForConv && <span className="mr-1">{agentForConv.icon}</span>}
              {conv.title}
            </div>
          )}
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">
            {formatRelativeTime(conv.updated_at)}
          </p>
        </div>
        <div className="invisible group-hover:visible flex items-center gap-0.5">
          {/* Pin button */}
          <button
            onClick={async (e) => {
              e.stopPropagation()
              try {
                await window.api.setConversationPinned(conv.id, !isPinned(conv))
                loadConversations()
              } catch {
                addToast('Failed to update pin', 'error')
              }
            }}
            className={`p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
              isPinned(conv) ? 'text-blue-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
            }`}
            title={isPinned(conv) ? 'Unpin conversation' : 'Pin conversation'}
            aria-label={isPinned(conv) ? 'Unpin conversation' : 'Pin conversation'}
          >
            <Pin className="w-3 h-3" />
          </button>
          {/* Move to project button */}
          <div className="relative" ref={isPickingProject ? convProjectPickerRef : undefined}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setConvProjectPickerId(isPickingProject ? null : conv.id)
              }}
              className="p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
              title="Move to project"
              aria-label="Move to project"
            >
              <FolderOpen className="w-3 h-3" />
            </button>
            {isPickingProject && (
              <div className="absolute right-0 top-5 z-30 w-44 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl py-1">
                <div className="px-2 py-1 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                  Move to project
                </div>
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  onClick={(e) => {
                    e.stopPropagation()
                    setConvProjectPickerId(null)
                    setConversationProject(conv.id, null)
                  }}
                >
                  <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600 inline-block" />
                  No project
                  {conv.project_id === null && <Check className="w-3 h-3 ml-auto text-blue-500" />}
                </button>
                {projects.map((p) => {
                  const colors = PROJECT_COLOR_MAP[p.color] ?? PROJECT_COLOR_MAP.blue
                  return (
                    <button
                      key={p.id}
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConvProjectPickerId(null)
                        setConversationProject(conv.id, p.id)
                      }}
                    >
                      <span className={`w-2 h-2 rounded-full inline-block ${colors.dot}`} />
                      <span className="truncate">{p.name}</span>
                      {conv.project_id === p.id && <Check className="w-3 h-3 ml-auto text-blue-500" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {/* Delete button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              setPendingDeleteConv({ id: conv.id, title: conv.title })
            }}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            title="Delete conversation"
            aria-label="Delete conversation"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
    <aside
      ref={sidebarRef}
      className="h-full flex flex-col shrink-0 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700/80 relative"
      style={{ width }}
      role="complementary"
      aria-label="Sidebar navigation"
    >
      <ResizeHandle direction="horizontal" containerRef={sidebarRef} onSetSize={handleSetSize} />
      <div className="flex items-center px-4 h-9 border-b border-gray-200 dark:border-gray-700/80">
        <h2 className="text-sm font-medium text-gray-800 dark:text-gray-100 tracking-wide">
          Copilot Desktop Hub
        </h2>
      </div>

      <div className="p-3 space-y-2">
        <button
          onClick={newChat}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New Chat</span>
        </button>
        <SearchBar onSearch={handleSearch} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 space-y-4">
        {/* ── Projects ── */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setProjectsOpen((v) => !v)}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 p-0.5 rounded"
                aria-expanded={projectsOpen}
                aria-label={projectsOpen ? 'Collapse projects' : 'Expand projects'}
              >
                {projectsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
              <button
                onClick={() => {
                  if (activeSectionPane === 'projects' && historyProjectId !== null) {
                    setHistoryProjectId(null)
                  } else {
                    setSectionPane('projects')
                  }
                }}
                className={`text-xs font-medium uppercase tracking-wider hover:text-gray-600 dark:hover:text-gray-300 ${
                  activeSectionPane === 'projects'
                    ? 'text-blue-500 dark:text-blue-400'
                    : 'text-gray-400 dark:text-gray-500'
                }`}
                aria-label="Open projects panel"
              >
                Projects
              </button>
            </div>
            <button
              onClick={() => {
                if (activeSectionPane !== 'projects') setSectionPane('projects')
                setShowNewProjectForm(true)
              }}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5 rounded"
              title="New project"
              aria-label="Create new project"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          {projectsOpen && <div className="space-y-0.5">
            {/* Project rows */}
            {projects.map((project) => {
              const colors = PROJECT_COLOR_MAP[project.color] ?? PROJECT_COLOR_MAP.blue
              const isActive = activeProjectId === project.id
              return (
                <div key={project.id} className="relative group">
                  <div
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs font-medium transition-colors ${
                      isActive
                        ? `${colors.bg} text-gray-900 dark:text-gray-100`
                        : sidebarDragOverProjectId === project.id
                          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-dashed border-blue-400'
                          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                    onClick={() => selectProject(project.id)}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes('sidebar-agent-id')) {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'copy'
                        setSidebarDragOverProjectId(project.id)
                      }
                    }}
                    onDragLeave={() => setSidebarDragOverProjectId(null)}
                    onDrop={async (e) => {
                      e.preventDefault()
                      setSidebarDragOverProjectId(null)
                      const agentId = e.dataTransfer.getData('sidebar-agent-id')
                      if (!agentId) return
                      const agent = agents.find((a) => a.id === agentId)
                      if (!agent) return
                      const alreadyMember = (projectAgents[project.id] ?? []).some((m) => m.agentId === agentId)
                      if (alreadyMember) {
                        addToast(`${agent.name} is already in ${project.name}`, 'info')
                        return
                      }
                      await addAgentToProject(project.id, agentId)
                      addToast(`🤖 ${agent.name} added to ${project.name}`, 'success')
                    }}
                  >
                    {isActive
                      ? <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                      : <Folder className="w-3.5 h-3.5 shrink-0" />
                    }
                    <span className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
                    <span className="flex-1 truncate">{project.name}</span>
                    {project.default_model && (
                      <span
                        className="flex items-center gap-0.5 text-[10px] text-gray-400 dark:text-gray-500 shrink-0"
                        title={`Default model: ${getModelLabel(project.default_model)}`}
                      >
                        <Cpu className="w-2.5 h-2.5" />
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        openEditProject(project.id)
                      }}
                      className="invisible group-hover:visible p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                      title="Project settings"
                      aria-label="Project settings"
                    >
                      <Settings className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )
            })}

            {/* __none__ sentinel — "No project" bucket for unaffiliated chats */}
              <div className="relative group">
                <div
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs font-medium transition-colors ${
                    activeProjectId === '__none__'
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                      : 'text-gray-500 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => selectProject('__none__')}
                  aria-label="No project — unaffiliated chats"
                >
                  <Folder className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                  <span className="flex-1 truncate italic">No project</span>
                </div>
              </div>

          </div>}
        </div>

        {/* ── Agents ── */}
        <div>
          <div className="flex items-center gap-1 px-2 mb-2">
            <button
              onClick={() => setAgentsOpen((v) => !v)}
              className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 p-0.5 rounded"
              aria-expanded={agentsOpen}
              aria-label={agentsOpen ? 'Collapse agents' : 'Expand agents'}
            >
              {agentsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            <button
              onClick={() => setSectionPane('agents')}
              className={`text-xs font-medium uppercase tracking-wider hover:text-gray-600 dark:hover:text-gray-300 ${
                activeSectionPane === 'agents'
                  ? 'text-blue-500 dark:text-blue-400'
                  : 'text-gray-400 dark:text-gray-500'
              }`}
              aria-label="Open agents panel"
            >
              Agents
            </button>
          </div>
          {agentsOpen && (<>
            {agentsLoading ? (
            <div className="space-y-1 px-2" aria-label="Loading agents">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-7 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : agents.length === 0 ? (
            <div className="text-xs text-gray-400 dark:text-gray-500 px-2 italic">
              No agents configured
            </div>
          ) : (
            <div className="space-y-0.5">
              {/* None option */}
              <div
                className={`group flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors ${
                  activeAgentId === null
                    ? 'bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                onClick={() => selectAgent(null)}
              >
                <span className="flex items-center gap-2 text-xs font-medium">
                  <MessageSquare className="w-3.5 h-3.5" />
                  No Agent
                </span>
              </div>
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('sidebar-agent-id', agent.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  className={`group flex items-center justify-between px-2 py-1.5 rounded-lg cursor-grab active:cursor-grabbing text-sm transition-colors ${
                    activeAgentId === agent.id
                      ? 'bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => selectAgent(agent.id)}
                  title="Drag onto a project to add this agent to it"
                >
                  <span className="text-xs font-medium truncate">
                    {agent.icon} {agent.name}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      openEditAgent(agent.id)
                    }}
                    className="invisible group-hover:visible text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-1 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                    title="Edit agent"
                    aria-label="Edit agent"
                  >
                    <Settings className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-2 px-2">
            <button
              onClick={openCreateAgent}
              className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <Plus className="w-3 h-3" />
              New Agent
            </button>
            <button
              onClick={importAgent}
              className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <Upload className="w-3 h-3" />
              Import
            </button>
          </div>
          </>)}
        </div>

        {/* ── Conversations ── */}
        <div>
          <div className="flex items-center gap-1 px-2 mb-2">
            <button
              onClick={() => setChatsOpen((v) => !v)}
              className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 p-0.5 rounded"
              aria-expanded={chatsOpen}
              aria-label={chatsOpen ? 'Collapse chats' : 'Expand chats'}
            >
              {chatsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            <button
              onClick={() => setSectionPane('chats')}
              className={`text-xs font-medium uppercase tracking-wider hover:text-gray-600 dark:hover:text-gray-300 ${
                activeSectionPane === 'chats'
                  ? 'text-blue-500 dark:text-blue-400'
                  : 'text-gray-400 dark:text-gray-500'
              }`}
              aria-label="Open chats panel"
            >
              {searchQuery
                ? `Results for "${searchQuery}"`
                : activeProjectId
                  ? `${projects.find((p) => p.id === activeProjectId)?.name ?? 'Project'} Chats`
                  : 'All Chats'}
            </button>
          </div>
          {chatsOpen && (<>
          {conversationsLoading && filteredConversations.length === 0 ? (
            <div className="space-y-1 px-2" aria-label="Loading conversations">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-7 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="text-xs text-gray-400 dark:text-gray-500 px-2 italic">
              {searchQuery
                ? 'No matching conversations'
                : activeProjectId
                  ? 'No chats in this project yet'
                  : 'No conversations yet'}
            </div>
          ) : (
            <div className="space-y-3">
              {pinnedConversations.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 mb-1">
                    Pinned
                  </div>
                  <div className="space-y-0.5">
                    {pinnedConversations.map(renderConversation)}
                  </div>
                </div>
              )}
              {dateGroups.map((group) => (
                <div key={group.label}>
                  <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 mb-1">
                    {group.label}
                  </div>
                  <div className="space-y-0.5">
                    {group.conversations.map(renderConversation)}
                  </div>
                </div>
              ))}
            </div>
          )}
          </>)}
        </div>
      </div>

      <div className="p-3 border-t border-gray-200 dark:border-gray-700/80">
        {authState.authenticated && authState.user ? (
          <div className="flex items-center gap-2 px-2 py-1">
            <img
              src={authState.user.avatar_url}
              alt={authState.user.login}
              className="w-6 h-6 rounded-full"
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                {authState.user.name || authState.user.login}
              </div>
            </div>
            <button
              onClick={logout}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              title="Sign out"
            >
              Sign out
            </button>
          </div>
        ) : (
          <button
            onClick={login}
            disabled={authLoading}
            className="w-full flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 px-2 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            <LogIn className="w-3.5 h-3.5" />
            {authLoading ? 'Signing in...' : 'Sign in with GitHub'}
          </button>
        )}
      </div>
    </aside>

    {pendingDeleteConv && (
      <DeleteConversationDialog
        conversationTitle={pendingDeleteConv.title}
        onConfirm={() => {
          deleteConversation(pendingDeleteConv.id)
          setPendingDeleteConv(null)
        }}
        onCancel={() => setPendingDeleteConv(null)}
      />
    )}
  </>
  )
}
