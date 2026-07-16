import { Settings2 } from 'lucide-react'
import { DropdownPanel } from '../DropdownPanel'

type ThinkingEffort = 'low' | 'medium' | 'high' | 'max' | 'disabled'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  thinkingEffortOverride: ThinkingEffort | null
  fullAutoApproveOverride: boolean | null
  terminalSandboxOverride: boolean | null
  onChange: (mode: {
    thinkingEffortOverride?: ThinkingEffort | null
    fullAutoApproveOverride?: boolean | null
    terminalSandboxOverride?: boolean | null
  }) => void
}

const THINKING_OPTIONS: { value: ThinkingEffort | null; label: string }[] = [
  { value: null, label: 'Agent default' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
]

const APPROVE_OPTIONS: { value: boolean | null; label: string }[] = [
  { value: null, label: 'Default' },
  { value: true, label: 'On' },
  { value: false, label: 'Off' },
]

/** Per-conversation overrides for thinking effort and tool auto-approval — the composer-bar
 *  counterpart to the agent-level defaults set in the agent settings screen. Follows the same
 *  small-button + DropdownPanel pattern as ModelPicker. */
export function ChatModePicker({ open, onOpenChange, thinkingEffortOverride, fullAutoApproveOverride, terminalSandboxOverride, onChange }: Props) {
  const hasOverride = thinkingEffortOverride !== null || fullAutoApproveOverride !== null || terminalSandboxOverride !== null
  return (
    <DropdownPanel
      open={open}
      onClose={() => onOpenChange(false)}
      align="right"
      width="w-56"
      trigger={
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          className={`flex items-center gap-1 text-xs px-1.5 py-1 rounded-md transition-colors ${
            hasOverride
              ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40'
              : 'text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
          title="Thinking effort and tool approval for this chat"
          aria-label="Chat mode settings"
        >
          <Settings2 className="w-3.5 h-3.5" />
        </button>
      }
    >
      <div className="p-2 space-y-3">
        <div>
          <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide px-1 pb-1">Thinking effort (this chat)</p>
          <div className="space-y-0.5">
            {THINKING_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => onChange({ thinkingEffortOverride: opt.value })}
                className={`w-full text-left px-2 py-1 rounded text-xs ${
                  thinkingEffortOverride === opt.value
                    ? 'bg-blue-500 text-white'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
          <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide px-1 pb-1">Auto-approve (this chat)</p>
          <div className="grid grid-cols-3 gap-1 px-1">
            {APPROVE_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => onChange({ fullAutoApproveOverride: opt.value })}
                className={`rounded px-1.5 py-1 text-[10px] font-medium border transition-colors ${
                  fullAutoApproveOverride === opt.value
                    ? 'border-blue-500 bg-blue-500 text-white'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:text-gray-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 px-1 pt-1.5">Overrides the agent's saved default for this conversation only.</p>
        </div>
        <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
          <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide px-1 pb-1">Terminal sandbox bypass (this chat)</p>
          <div className="grid grid-cols-3 gap-1 px-1">
            {APPROVE_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => onChange({ terminalSandboxOverride: opt.value })}
                className={`rounded px-1.5 py-1 text-[10px] font-medium border transition-colors ${
                  terminalSandboxOverride === opt.value
                    ? 'border-amber-500 bg-amber-500 text-white'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:text-gray-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 px-1 pt-1.5">Overrides the project's sandbox-bypass default for this conversation only.</p>
        </div>
      </div>
    </DropdownPanel>
  )
}
