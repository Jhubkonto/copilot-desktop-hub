import { useEffect, useDeferredValue, useMemo, useRef, useState } from 'react'
import { Plus, Settings, Upload, MessageSquare, Trash2, FolderPlus, Check, Search, X, Sparkles } from 'lucide-react'
import { useAppStore } from '../../store/app-store'
import type { AgentConfig } from '../../../shared/types'

export function AgentsPane() {
  const agents = useAppStore((s) => s.agents)
  const agentsLoading = useAppStore((s) => s.agentsLoading)
  const activeAgentId = useAppStore((s) => s.activeAgentId)
  const setHistoryAgentId = useAppStore((s) => s.setHistoryAgentId)
  const openEditAgent = useAppStore((s) => s.openEditAgent)
  const openCreateAgent = useAppStore((s) => s.openCreateAgent)
  const importAgent = useAppStore((s) => s.importAgent)
  const deleteAgent = useAppStore((s) => s.deleteAgent)
  const selectAgent = useAppStore((s) => s.selectAgent)
  const projects = useAppStore((s) => s.projects)
  const projectAgents = useAppStore((s) => s.projectAgents)
  const addAgentToProject = useAppStore((s) => s.addAgentToProject)
  const addToast = useAppStore((s) => s.addToast)
  const setShowAgentGenerator = useAppStore((s) => s.setShowAgentGenerator)

  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [addToProjectAgentId, setAddToProjectAgentId] = useState<string | null>(null)
  const addToProjectPopoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!addToProjectAgentId) return
    const handler = (e: MouseEvent) => {
      if (addToProjectPopoverRef.current && !addToProjectPopoverRef.current.contains(e.target as Node)) {
        setAddToProjectAgentId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [addToProjectAgentId])

  const handleAddToProject = async (projectId: string, agent: AgentConfig) => {
    await addAgentToProject(projectId, agent.id)
    const projectName = projects.find((p) => p.id === projectId)?.name ?? 'project'
    addToast(`🤖 ${agent.name} added to ${projectName}`, 'success')
    setAddToProjectAgentId(null)
  }

  const filtered = useMemo(
    () => deferredQuery ? agents.filter((a) => a.name.toLowerCase().includes(deferredQuery.toLowerCase())) : agents,
    [agents, deferredQuery]
  )

  if (agentsLoading) {
    return (
      <div className="p-2 space-y-0.5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-9 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <>
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 h-9 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {agents.length} agent{agents.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={importAgent}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Import agent"
          >
            <Upload className="w-3.5 h-3.5" />
            Import
          </button>
          <button
            onClick={() => setShowAgentGenerator(true)}
            className="flex items-center gap-1 text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            aria-label="Generate agent with AI"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Generate
          </button>
          <button
            onClick={openCreateAgent}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Create new agent"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </button>
        </div>
      </div>

      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents..."
            className="w-full pl-8 pr-7 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-blue-400 focus:bg-white dark:focus:bg-gray-900 rounded-lg outline-none transition-colors placeholder:text-gray-400"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto mr-1.5 p-2 space-y-0.5">
        {!query && (
        <div
          onClick={() => selectAgent(null)}
          className={`flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer transition-colors ${
            activeAgentId === null
              ? 'bg-gray-100 dark:bg-gray-800'
              : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">No Agent</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500">Direct chat</p>
          </div>
        </div>
        )}

        {filtered.length === 0 && deferredQuery ? (
          <p className="text-center text-xs text-gray-400 dark:text-gray-500 pt-8 italic">
            No agents match "{deferredQuery}"
          </p>
        ) : agents.length === 0 ? (
          <p className="text-center text-xs text-gray-400 dark:text-gray-500 pt-8 italic">
            No agents configured — create one to get started
          </p>
        ) : filtered.map((agent: AgentConfig) => {
          const isActive = activeAgentId === agent.id
          const isPopoverOpen = addToProjectAgentId === agent.id
          return (
            <div key={agent.id} className="relative">
              <div
                data-agent-id={agent.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('agent-id', agent.id)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => setHistoryAgentId(agent.id)}
                className={`group flex items-center gap-2 rounded-lg px-2 py-2 cursor-grab active:cursor-grabbing transition-colors ${
                  isActive
                    ? 'bg-gray-100 dark:bg-gray-800'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                }`}
                title="Drag onto a project to add this agent to its team"
              >
                <span className="text-base leading-none shrink-0">{agent.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{agent.name}</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                    uses your model setting
                  </p>
                </div>
                <div className={`flex items-center gap-0.5 shrink-0 ${isPopoverOpen ? 'visible' : 'invisible group-hover:visible'}`}>
                  <button
                    onClick={(e) => { e.stopPropagation(); openEditAgent(agent.id) }}
                    className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                    title="Edit agent"
                    aria-label={`Edit ${agent.name}`}
                  >
                    <Settings className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setAddToProjectAgentId(isPopoverOpen ? null : agent.id)
                    }}
                    className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                    title="Add to project"
                    aria-label={`Add ${agent.name} to project`}
                  >
                    <FolderPlus className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteAgent(agent.id) }}
                    className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="Delete agent"
                    aria-label={`Delete ${agent.name}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {isPopoverOpen && (
                <div
                  ref={addToProjectPopoverRef}
                  className="absolute right-0 top-full mt-1 z-20 w-48 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl py-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="px-3 py-1 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                    Add to project
                  </p>
                  {projects.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-400 italic">No projects yet</p>
                  ) : projects.map((project) => {
                    const alreadyMember = (projectAgents[project.id] ?? []).some((m) => m.agentId === agent.id)
                    return (
                      <button
                        key={project.id}
                        type="button"
                        disabled={alreadyMember}
                        onClick={() => { if (!alreadyMember) handleAddToProject(project.id, agent) }}
                        className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                          alreadyMember
                            ? 'text-gray-300 dark:text-gray-600 cursor-default'
                            : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                        }`}
                        aria-label={alreadyMember ? `${agent.name} already in ${project.name}` : `Add ${agent.name} to ${project.name}`}
                      >
                        {alreadyMember && <Check className="w-3 h-3 text-green-500 shrink-0" />}
                        <span className="truncate">{project.name}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
    </>
  )
}
