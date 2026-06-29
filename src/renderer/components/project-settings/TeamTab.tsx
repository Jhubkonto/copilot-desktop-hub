import { useEffect, useState } from 'react'
import { Plus, X, Star, GripVertical, Copy, Play, Sparkles, Loader2 } from 'lucide-react'
import { DropdownPanel } from '../DropdownPanel'
import type { AgentConfig, ManualWorkflowSpec } from '../../../shared/types'
import type { ProjectAgent, ProjectConfig } from '../../store/types'
import { useAppStore } from '../../store/app-store'

interface Props {
  projectId: string
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
  onStartWorkflowStep: (agentId: string | null, prompt: string) => Promise<void>
  onToast: (message: string, type: 'success' | 'error' | 'info') => void
}

export function TeamTab({
  projectId, agents, members, projectConfig,
  agentPickerQuery, showAgentPicker, teamDraggingId,
  onSetAgentPickerQuery, onSetShowAgentPicker, onSetTeamDraggingId,
  onAddAgent, onRemoveAgent, onSetPrimaryAgent, onReorderAgents, onUpdateOrchestration, onStartWorkflowStep, onToast,
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
  const [goal, setGoal] = useState('')
  const [spec, setSpec] = useState<ManualWorkflowSpec | null>(null)
  const [streamingText, setStreamingText] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [missedSpec, setMissedSpec] = useState(false)

  useEffect(() => {
    const offToken = window.api.onManualWorkflowGeneratorToken((chunk) => {
      setStreamingText((current) => current + chunk)
    })
    const offSpec = window.api.onManualWorkflowGeneratorSpecReady((incoming) => {
      setSpec(incoming)
      setMissedSpec(false)
    })
    const offDone = window.api.onManualWorkflowGeneratorDone(({ hasSpec }) => {
      setIsGenerating(false)
      if (!hasSpec) setMissedSpec(true)
    })
    return () => { offToken(); offSpec(); offDone() }
  }, [])

  const handleGenerateWorkflow = async () => {
    const trimmedGoal = goal.trim()
    if (!trimmedGoal || isGenerating) return
    setIsGenerating(true)
    setMissedSpec(false)
    setStreamingText('')
    setSpec(null)
    try {
      const result = await window.api.manualWorkflowGeneratorChat(projectId, [{ role: 'user', content: trimmedGoal }])
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error(String((result as { error: unknown }).error))
      }
    } catch (error) {
      setIsGenerating(false)
      onToast(error instanceof Error ? error.message : 'Failed to generate workflow', 'error')
    }
  }

  const handleCopyPrompt = async (prompt: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is not available')
      await navigator.clipboard.writeText(prompt)
      onToast('Step prompt copied', 'success')
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Failed to copy prompt', 'error')
    }
  }

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
            Choose whether the project runs as a single agent, manual delegation workflow, or full orchestration.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { value: 'single-agent', label: 'Single' },
            { value: 'manual-delegation', label: 'Manual' },
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
        {(workflowMode === 'manual-delegation' || workflowMode === 'orchestrated') && !hasGeneratorBackend && (
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
        {workflowMode === 'manual-delegation' && (
          <div className="rounded-md border border-blue-200/70 dark:border-blue-900/50 bg-blue-50/70 dark:bg-blue-950/20 p-3 space-y-3">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
                <Sparkles className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold">Manual workflow generator</span>
              </div>
              <p className="text-[10px] text-blue-700/80 dark:text-blue-300/80">
                Generate a reusable delegation plan with copyable prompts for each project step.
              </p>
            </div>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={3}
              placeholder="Describe the project goal or milestone you want the team to execute."
              className="w-full resize-none rounded-md border border-blue-200 dark:border-blue-900/60 bg-white/90 dark:bg-gray-900/60 px-2.5 py-2 text-xs text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-gray-500 dark:text-gray-400">
                {members.length > 0 ? `${members.length} project agent${members.length === 1 ? '' : 's'} available` : 'No project agents assigned yet'}
              </span>
              <button
                type="button"
                onClick={() => { void handleGenerateWorkflow() }}
                disabled={isGenerating || !goal.trim() || !hasGeneratorBackend}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Generate workflow
              </button>
            </div>
            {isGenerating && streamingText && (
              <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/70 px-3 py-2 text-[11px] text-gray-600 dark:text-gray-300 whitespace-pre-wrap max-h-36 overflow-y-auto">
                {streamingText}
              </div>
            )}
            {missedSpec && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                No structured workflow was returned. Try being more specific about the goal or expected deliverables.
              </p>
            )}
            {spec && (
              <div className="space-y-3 rounded-md border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/70 p-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">{spec.title}</p>
                  {spec.goalSummary && (
                    <p className="text-[11px] text-gray-600 dark:text-gray-300">{spec.goalSummary}</p>
                  )}
                  {spec.assumptions.length > 0 && (
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">
                      Assumptions: {spec.assumptions.join(' • ')}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  {spec.steps.map((step, index) => (
                    <div key={step.id} className="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-gray-800 dark:text-gray-100">
                            {index + 1}. {step.title}
                          </p>
                          <p className="text-[10px] text-gray-500 dark:text-gray-400">
                            {step.agentName ?? 'Unassigned'}{step.expectedOutput ? ` · Output: ${step.expectedOutput}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => { void handleCopyPrompt(step.prompt) }}
                            className="inline-flex items-center gap-1 rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-[10px] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                          >
                            <Copy className="w-3 h-3" />
                            Copy
                          </button>
                          <button
                            type="button"
                            onClick={() => { void onStartWorkflowStep(step.agentId ?? null, step.prompt) }}
                            className="inline-flex items-center gap-1 rounded border border-blue-200 dark:border-blue-900/60 px-2 py-1 text-[10px] text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                          >
                            <Play className="w-3 h-3" />
                            Start in chat
                          </button>
                        </div>
                      </div>
                      {step.summary && (
                        <p className="text-[11px] text-gray-600 dark:text-gray-300">{step.summary}</p>
                      )}
                      <pre className="whitespace-pre-wrap rounded bg-gray-50 dark:bg-gray-800 px-2.5 py-2 text-[10px] text-gray-700 dark:text-gray-200">
                        {step.prompt}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
