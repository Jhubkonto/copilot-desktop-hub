import { Plus, X, Star, GripVertical, Sparkles } from 'lucide-react'
import { DropdownPanel } from '../DropdownPanel'
import { Button } from '../ui/primitives'
import type { AgentConfig } from '../../../shared/types'
import type { ProjectAgent, ProjectConfig } from '../../store/types'
import { useAppStore } from '../../store/app-store'

interface Props {
  agents: AgentConfig[]
  members: ProjectAgent[]
  projectConfig: ProjectConfig
  agentPickerQuery: string
  showAgentPicker: boolean
  teamDraggingId: string | null
  onSetAgentPickerQuery: (v: string) => void
  onSetShowAgentPicker: (v: boolean) => void
  onSetTeamDraggingId: (id: string | null) => void
  onAddAgent: (agentId: string) => void
  onRemoveAgent: (agentId: string) => void
  onSetPrimaryAgent: (agentId: string) => void
  onReorderAgents: (orderedIds: string[]) => void
  onUpdateOrchestration: (partial: Partial<Pick<ProjectConfig, 'workflowMode' | 'orchestrationEnabled' | 'maxDelegationDepth' | 'showTeamActivity'>>) => void
  onGoToWorkflowTab: () => void
}

export function TeamTab({
  agents, members, projectConfig,
  agentPickerQuery, showAgentPicker, teamDraggingId,
  onSetAgentPickerQuery, onSetShowAgentPicker, onSetTeamDraggingId,
  onAddAgent, onRemoveAgent, onSetPrimaryAgent, onReorderAgents, onUpdateOrchestration, onGoToWorkflowTab,
}: Props) {
  const authState = useAppStore((s) => s.authState)
  const workflowMode = projectConfig.workflowMode ?? 'single-agent'
  const canOrchestrate = members.length >= 2
  const installedClis = authState.clis ?? { claude: authState.cliInstalled, codex: false }
  const hasGeneratorBackend = authState.authenticated || authState.cliInstalled
  const memberConfigsById = new Map(agents.map((agent) => [agent.id, agent]))
  const unavailableMembers = members.filter((member) => {
    const config = memberConfigsById.get(member.agentId)
    if (!config?.backend) return !(authState.authenticated || authState.cliInstalled)
    if (config.backend === 'claude-cli') return !installedClis.claude
    if (config.backend === 'codex-cli') return !installedClis.codex
    if (config.backend === 'gh-copilot') return false
    return false
  })
  const hasPrimaryMember = members.some((member) => member.isPrimary)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Team agents</label>
        <DropdownPanel
          open={showAgentPicker}
          onClose={() => { onSetShowAgentPicker(false); onSetAgentPickerQuery('') }}
          align="right"
          width="w-64"
          trigger={
            <button
              type="button"
              onClick={() => onSetShowAgentPicker(!showAgentPicker)}
              className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
              aria-label="Add agent to project"
            >
              <Plus className="w-3.5 h-3.5" />
              Add agent
            </button>
          }
        >
          <div className="p-1.5 border-b border-gray-100 dark:border-gray-700">
            <input
              autoFocus
              value={agentPickerQuery}
              onChange={(e) => onSetAgentPickerQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { onSetShowAgentPicker(false); onSetAgentPickerQuery('') }
              }}
              placeholder="Search agents…"
              aria-label="Search agents to add"
              className="w-full text-xs bg-white dark:bg-gray-700 border border-blue-400 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {(() => {
              const memberIds = new Set(members.map((m) => m.agentId))
              const filtered = agents.filter(
                (a: AgentConfig) => !memberIds.has(a.id) && a.name.toLowerCase().includes(agentPickerQuery.toLowerCase())
              )
              return filtered.length === 0 ? (
                <p className="text-[10px] text-gray-400 dark:text-gray-500 px-3 py-2 italic">
                  {agents.length === 0 ? 'No agents configured' : 'All agents already added'}
                </p>
              ) : filtered.map((agent: AgentConfig) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => { onAddAgent(agent.id); onSetShowAgentPicker(false); onSetAgentPickerQuery('') }}
                  className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  aria-label={`Add ${agent.name} to project`}
                >
                  <span>{agent.icon}</span>
                  <span className="truncate">{agent.name}</span>
                </button>
              ))
            })()}
          </div>
        </DropdownPanel>
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2 space-y-2">
        <div className="space-y-1">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Workflow mode</span>
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            Choose whether the project runs as a single agent, automated delegation workflow, or full orchestration.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { value: 'single-agent', label: 'Single' },
            { value: 'automated-delegation', label: 'Automated' },
            { value: 'orchestrated', label: 'Orchestrated', disabled: !canOrchestrate },
          ].map((option) => {
            const selected = workflowMode === option.value
            return (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                onClick={() => onUpdateOrchestration({ workflowMode: option.value as ProjectConfig['workflowMode'] })}
                className={`rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                  selected
                    ? 'border-blue-500 bg-blue-500 text-white'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300 dark:hover:text-gray-100'
                } ${option.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                aria-label={`Set workflow mode to ${option.label}`}
                title={option.disabled ? 'Add at least two agents to enable orchestration' : undefined}
              >
                {option.label}
              </button>
            )
          })}
        </div>
        {!canOrchestrate && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400">
            Add at least two agents to enable orchestration.
          </p>
        )}
        {workflowMode === 'orchestrated' && !hasPrimaryMember && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400">
            Orchestration needs a primary project agent before automatic delegation can run.
          </p>
        )}
        {workflowMode === 'orchestrated' && unavailableMembers.length > 0 && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400">
            Some assigned agents are not currently runnable with this machine’s configured backends: {unavailableMembers.map((member) => member.agentName).join(', ')}.
          </p>
        )}
        {(workflowMode === 'automated-delegation' || workflowMode === 'orchestrated') && !hasGeneratorBackend && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400">
            No provider or supported CLI backend is configured. Add an API key or install a CLI backend in Settings before using this workflow mode.
          </p>
        )}
        {workflowMode === 'orchestrated' && (
          <div className="flex items-center gap-4 pl-0.5">
            <label className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500 dark:text-gray-400">Max depth</span>
              <input
                type="number"
                min={1}
                max={10}
                value={projectConfig.maxDelegationDepth}
                onChange={(e) => onUpdateOrchestration({ maxDelegationDepth: Number(e.target.value) })}
                className="w-10 text-[10px] px-1 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
              />
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={projectConfig.showTeamActivity}
                onChange={(e) => onUpdateOrchestration({ showTeamActivity: e.target.checked })}
                className="w-3 h-3 rounded accent-blue-500"
              />
              <span className="text-[10px] text-gray-500 dark:text-gray-400">Show activity</span>
            </label>
          </div>
        )}
        {workflowMode === 'automated-delegation' && (
          <div className="rounded-md border border-blue-200/70 dark:border-blue-900/50 bg-blue-50/70 dark:bg-blue-950/20 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="text-xs font-semibold">Generate a delegation plan</span>
            </div>
            <p className="text-[10px] text-blue-700/80 dark:text-blue-300/80">
              Use the Workflow tab to turn a project goal into a reusable delegation plan with copyable prompts for each step.
            </p>
            <Button variant="primary" onClick={onGoToWorkflowTab} className="text-[11px]">
              <Sparkles className="w-3.5 h-3.5" />
              Open Workflow tab
            </Button>
          </div>
        )}
      </div>

      {/* Member list */}
      {members.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-4">No agents in this project yet.</p>
      ) : (
        <div className="space-y-0.5">
          {members.map((member) => {
            const isDragging = teamDraggingId === member.agentId
            return (
              <div
                key={member.agentId}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('member-agent-id', member.agentId)
                  e.dataTransfer.effectAllowed = 'move'
                  onSetTeamDraggingId(member.agentId)
                }}
                onDragEnd={() => onSetTeamDraggingId(null)}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes('member-agent-id')) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const srcId = e.dataTransfer.getData('member-agent-id')
                  if (!srcId || srcId === member.agentId) return
                  const srcIdx = members.findIndex((a) => a.agentId === srcId)
                  const tgtIdx = members.findIndex((a) => a.agentId === member.agentId)
                  if (srcIdx === -1 || tgtIdx === -1) return
                  const reordered = [...members]
                  reordered.splice(srcIdx, 1)
                  reordered.splice(tgtIdx, 0, members[srcIdx])
                  onReorderAgents(reordered.map((a) => a.agentId))
                  onSetTeamDraggingId(null)
                }}
                className={`group/member flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs cursor-grab active:cursor-grabbing transition-colors ${
                  isDragging ? 'opacity-40' : ''
                } ${
                  member.isPrimary
                    ? 'bg-yellow-50 dark:bg-yellow-900/20'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <GripVertical className="w-3 h-3 text-gray-300 dark:text-gray-600 shrink-0" />
                <span className="text-base leading-none">{member.agentIcon}</span>
                <span className={`flex-1 truncate ${member.isPrimary ? 'font-medium text-yellow-700 dark:text-yellow-400' : 'text-gray-700 dark:text-gray-300'}`}>
                  {member.agentName}
                </span>
                {(() => {
                  const orchEnabled = workflowMode === 'orchestrated'
                  const teamSize = members.length
                  if (member.isPrimary) {
                    return (
                      <span className="text-[9px] bg-yellow-200 dark:bg-yellow-800 text-yellow-700 dark:text-yellow-300 px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                        {orchEnabled && teamSize >= 2 ? 'leads' : 'primary'}
                      </span>
                    )
                  }
                  if (orchEnabled && teamSize >= 2) {
                    return (
                      <span className="text-[9px] bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                        specialist
                      </span>
                    )
                  }
                  return null
                })()}
                <div className="invisible group-hover/member:visible flex items-center gap-0.5">
                  {!member.isPrimary && (
                    <button
                      type="button"
                      onClick={() => onSetPrimaryAgent(member.agentId)}
                      className="p-0.5 rounded text-gray-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20"
                      title="Set as primary"
                      aria-label={`Set ${member.agentName} as primary agent`}
                    >
                      <Star className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveAgent(member.agentId)}
                    className="p-0.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="Remove from project"
                    aria-label={`Remove ${member.agentName} from project`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
