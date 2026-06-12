import { Plus } from 'lucide-react'
import { MilestoneCard } from './MilestoneCard'
import type { Milestone } from '../../store/types'

interface Props {
  milestones: Milestone[]
  activeMilestone: Milestone | undefined
  upcomingMilestones: Milestone[]
  completedMilestones: Milestone[]
  onAddMilestone: () => void
  onRemoveMilestone: (id: string) => void
  onMilestoneChange: (id: string, field: 'title' | 'description', val: string) => void
  onMilestoneStatus: (id: string, status: Milestone['status']) => void
}

export function MilestonesTab({
  milestones, activeMilestone, upcomingMilestones, completedMilestones,
  onAddMilestone, onRemoveMilestone, onMilestoneChange, onMilestoneStatus,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-gray-400 dark:text-gray-500">Track what the agent is currently working toward</p>
        <button
          type="button"
          onClick={onAddMilestone}
          className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
          aria-label="Add milestone"
        >
          <Plus className="w-3.5 h-3.5" />
          Add milestone
        </button>
      </div>

      {milestones.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-4">No milestones yet.</p>
      )}

      {activeMilestone && (
        <div>
          <label className="text-[10px] font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider">🎯 Active</label>
          <MilestoneCard
            milestone={activeMilestone}
            onChange={onMilestoneChange}
            onStatus={onMilestoneStatus}
            onRemove={onRemoveMilestone}
          />
        </div>
      )}

      {upcomingMilestones.length > 0 && (
        <div>
          <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Upcoming</label>
          <div className="space-y-1.5 mt-1">
            {upcomingMilestones.map((m) => (
              <MilestoneCard
                key={m.id}
                milestone={m}
                onChange={onMilestoneChange}
                onStatus={onMilestoneStatus}
                onRemove={onRemoveMilestone}
              />
            ))}
          </div>
        </div>
      )}

      {completedMilestones.length > 0 && (
        <div>
          <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Completed</label>
          <div className="space-y-1.5 mt-1">
            {completedMilestones.map((m) => (
              <MilestoneCard
                key={m.id}
                milestone={m}
                onChange={onMilestoneChange}
                onStatus={onMilestoneStatus}
                onRemove={onRemoveMilestone}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
