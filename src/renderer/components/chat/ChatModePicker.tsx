import { Settings2 } from 'lucide-react'
import { DropdownPanel } from '../DropdownPanel'
import type { CliBackend, CliModeOverride, CodexExecutionModeOverride } from '../../../shared/types'

type ThinkingEffort = 'low' | 'medium' | 'high' | 'max' | 'disabled'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  thinkingEffortOverride: ThinkingEffort | null
  fullAutoApproveOverride: boolean | null
  agenticModeOverride: boolean | null
  terminalSandboxOverride: boolean | null
  /** The CLI backend answering this chat — shows that backend's mode section; null hides it. */
  activeCliBackend?: CliBackend | null
  cliModeOverride?: CliModeOverride | null
  codexExecutionModeOverride?: CodexExecutionModeOverride | null
  onChange: (mode: {
    thinkingEffortOverride?: ThinkingEffort | null
    fullAutoApproveOverride?: boolean | null
    agenticModeOverride?: boolean | null
    terminalSandboxOverride?: boolean | null
    cliModeOverride?: CliModeOverride | null
    codexExecutionModeOverride?: CodexExecutionModeOverride | null
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

const OPTION_GRID_CLASS = 'grid grid-cols-2 gap-1 px-1'
const OPTION_BUTTON_CLASS = 'rounded px-1.5 py-1 text-[10px] font-medium border transition-colors'

/** Backend-specific mode options — Claude Code permission modes vs Codex sandbox levels.
 *  Hermes has no mode flags, so it gets no section. */
const CLI_MODE_OPTIONS: Partial<Record<CliBackend, { title: string; options: { value: CliModeOverride | null; label: string; hint?: string }[] }>> = {
  'claude-cli': {
    title: 'Claude Code mode (this chat)',
    options: [
      { value: null, label: 'Default' },
      { value: 'plan', label: 'Plan', hint: 'Analyse only — no file edits' },
      { value: 'acceptEdits', label: 'Accept edits', hint: 'Auto-accept file edits' },
      { value: 'bypassPermissions', label: 'Bypass', hint: 'Skip all permission prompts' },
    ],
  },
  'codex-cli': {
    title: 'Codex sandbox (this chat)',
    options: [
      { value: null, label: 'Default' },
      { value: 'read-only', label: 'Read-only', hint: 'No file writes' },
      { value: 'workspace-write', label: 'Workspace', hint: 'Writes inside the workspace' },
      { value: 'danger-full-access', label: 'Full access', hint: 'No sandbox restrictions' },
    ],
  },
}

/** Per-conversation overrides for thinking effort and tool auto-approval — the composer-bar
 *  counterpart to the agent-level defaults set in the agent settings screen. Follows the same
 *  small-button + DropdownPanel pattern as ModelPicker. */
export function ChatModePicker({ open, onOpenChange, thinkingEffortOverride, fullAutoApproveOverride, agenticModeOverride, terminalSandboxOverride, activeCliBackend = null, cliModeOverride = null, codexExecutionModeOverride = null, onChange }: Props) {
  const cliModeSection = activeCliBackend ? CLI_MODE_OPTIONS[activeCliBackend] : undefined
  // Claude's permission mode already includes its approval policy, so a second auto-approve
  // control would conflict with Plan/Accept edits. Codex keeps approval policy and filesystem
  // sandbox as independent settings, so it needs both this toggle and its sandbox-level section.
  const showAutoApprove = activeCliBackend !== 'claude-cli'
  // Terminal sandbox bypass is currently only implemented by the Claude CLI adapter (--add-dir);
  // showing it for other backends is a silent no-op.
  const showTerminalSandboxBypass = activeCliBackend === 'claude-cli'
  // Provider (BYOK) chats get a generic plan-mode toggle: the model works read-only and proposes
  // a plan via exit_plan_mode before editing. CLI chats use their own native plan sections instead.
  const showByokPlanMode = !activeCliBackend
  const hasOverride =
    thinkingEffortOverride !== null ||
    (showAutoApprove && fullAutoApproveOverride !== null) ||
    (showByokPlanMode && agenticModeOverride !== null) ||
    (showTerminalSandboxBypass && terminalSandboxOverride !== null) ||
    (activeCliBackend === 'codex-cli' && codexExecutionModeOverride !== null) ||
    (showByokPlanMode && cliModeOverride !== null) ||
    (cliModeSection != null && cliModeOverride !== null)
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
          <div className={OPTION_GRID_CLASS}>
            {THINKING_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => onChange({ thinkingEffortOverride: opt.value })}
                className={`${OPTION_BUTTON_CLASS} ${
                  thinkingEffortOverride === opt.value
                    ? 'border-blue-500 bg-blue-500 text-white'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:text-gray-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {showByokPlanMode && (
          <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide px-1 pb-1">Agentic mode (this chat)</p>
            <div className={OPTION_GRID_CLASS}>
              {APPROVE_OPTIONS.map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => onChange({ agenticModeOverride: opt.value })}
                  className={`${OPTION_BUTTON_CLASS} ${
                    agenticModeOverride === opt.value
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:text-gray-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 px-1 pt-1.5">
              Lets a tool-capable BYOK model continue using available project tools until the task is complete.
            </p>
          </div>
        )}
        {activeCliBackend === 'codex-cli' && (
          <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide px-1 pb-1">Codex execution mode (this chat)</p>
            <div className={OPTION_GRID_CLASS}>
              {([
                { value: null, label: 'Default', hint: 'Normal execution' },
                { value: 'plan' as const, label: 'Plan', hint: 'Analyze and propose a plan' },
              ]).map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => onChange({ codexExecutionModeOverride: opt.value })}
                  title={opt.hint}
                  className={`${OPTION_BUTTON_CLASS} ${
                    codexExecutionModeOverride === opt.value
                      ? 'border-indigo-500 bg-indigo-500 text-white'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:text-gray-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 px-1 pt-1.5">Uses Codex's native collaboration mode, independently of approvals and sandbox access.</p>
          </div>
        )}
        {showByokPlanMode && (
          <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide px-1 pb-1">Execution mode (this chat)</p>
            <div className={OPTION_GRID_CLASS}>
              {([
                { value: null, label: 'Default', hint: 'Normal execution' },
                { value: 'plan' as const, label: 'Plan', hint: 'Research read-only, then ask before implementation' },
              ]).map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => onChange({ cliModeOverride: opt.value })}
                  title={opt.hint}
                  className={`${OPTION_BUTTON_CLASS} ${
                    cliModeOverride === opt.value
                      ? 'border-indigo-500 bg-indigo-500 text-white'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:text-gray-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 px-1 pt-1.5">
              The model exits Plan mode when its plan is ready; implementation starts only after you approve it.
            </p>
          </div>
        )}
        {showAutoApprove && (
          <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide px-1 pb-1">
              {activeCliBackend === 'codex-cli' ? 'Codex auto-approve (this chat)' : 'Auto-approve (this chat)'}
            </p>
            <div className={OPTION_GRID_CLASS}>
              {APPROVE_OPTIONS.map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => onChange({ fullAutoApproveOverride: opt.value })}
                  className={`${OPTION_BUTTON_CLASS} ${
                    fullAutoApproveOverride === opt.value
                      ? 'border-blue-500 bg-blue-500 text-white'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:text-gray-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 px-1 pt-1.5">
              {activeCliBackend === 'codex-cli'
                ? 'Controls approval prompts independently of the Codex sandbox level below.'
                : "Overrides the agent's saved default for this conversation only."}
            </p>
          </div>
        )}
        {showTerminalSandboxBypass && (
          <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide px-1 pb-1">Terminal sandbox bypass (this chat)</p>
            <div className={OPTION_GRID_CLASS}>
              {APPROVE_OPTIONS.map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => onChange({ terminalSandboxOverride: opt.value })}
                  className={`${OPTION_BUTTON_CLASS} ${
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
        )}
        {cliModeSection && (
          <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide px-1 pb-1">{cliModeSection.title}</p>
            <div className={OPTION_GRID_CLASS}>
              {cliModeSection.options.map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => onChange({ cliModeOverride: opt.value })}
                  title={opt.hint}
                  className={`${OPTION_BUTTON_CLASS} ${
                    cliModeOverride === opt.value
                      ? 'border-purple-500 bg-purple-500 text-white'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:text-gray-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 px-1 pt-1.5">
              {activeCliBackend === 'claude-cli'
                ? 'Also settable via /plan, /accept-edits, and /mode-default. Applies from the next message.'
                : 'Also settable via /sandbox-read-only, /sandbox-workspace, and /sandbox-full. Applies from the next message.'}
            </p>
          </div>
        )}
      </div>
    </DropdownPanel>
  )
}
