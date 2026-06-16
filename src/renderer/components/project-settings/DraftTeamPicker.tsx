import { Star } from 'lucide-react'
import type { AgentConfig } from '../../../shared/types'

interface Props {
  agents: AgentConfig[]
  selectedAgentIds: string[]
  primaryAgentId: string | null
  onToggleAgent: (agentId: string) => void
  onSetPrimaryAgent: (agentId: string) => void
}

export function DraftTeamPicker({ agents, selectedAgentIds, primaryAgentId, onToggleAgent, onSetPrimaryAgent }: Props) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Team agents</label>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
          Pick agents to add once the project is created. Drag-to-reorder and orchestration settings are available afterward in Team.
        </p>
      </div>

      {agents.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-4">No agents configured yet.</p>
      ) : (
        <div className="space-y-0.5">
          {agents.map((agent) => {
            const selected = selectedAgentIds.includes(agent.id)
            const isPrimary = primaryAgentId === agent.id
            return (
              <div
                key={agent.id}
                className={`group/draft-member flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${
                  isPrimary ? 'bg-yellow-50 dark:bg-yellow-900/20' : selected ? 'bg-gray-100 dark:bg-gray-700/50' : ''
                }`}
              >
                <label className="flex items-center gap-2 flex-1 cursor-pointer min-w-0">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleAgent(agent.id)}
                    className="w-3.5 h-3.5 rounded accent-blue-500 shrink-0"
                  />
                  <span className="text-base leading-none shrink-0">{agent.icon}</span>
                  <span className={`flex-1 truncate ${isPrimary ? 'font-medium text-yellow-700 dark:text-yellow-400' : 'text-gray-700 dark:text-gray-300'}`}>
                    {agent.name}
                  </span>
                </label>
                {selected && (
                  isPrimary ? (
                    <span className="text-[9px] bg-yellow-200 dark:bg-yellow-800 text-yellow-700 dark:text-yellow-300 px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                      primary
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSetPrimaryAgent(agent.id)}
                      className="invisible group-hover/draft-member:visible p-0.5 rounded text-gray-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 shrink-0"
                      title="Set as primary"
                      aria-label={`Set ${agent.name} as primary agent`}
                    >
                      <Star className="w-3 h-3" />
                    </button>
                  )
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
