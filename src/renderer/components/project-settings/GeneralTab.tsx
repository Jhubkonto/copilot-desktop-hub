import { FolderOpen, Plus, X, ChevronDown } from 'lucide-react'
import { DropdownPanel } from '../DropdownPanel'
import type { ProjectConfig } from '../../store/types'

const INSTRUCTION_MODES: { value: ProjectConfig['instructionMode']; label: string }[] = [
  { value: 'prepend',    label: 'Prepend to agent prompt' },
  { value: 'append',    label: 'Append to agent prompt' },
  { value: 'replace',   label: 'Replace agent prompt' },
  { value: 'standalone', label: 'Standalone (ignore agent prompt)' },
]

const COLOR_OPTIONS: { value: string; bg: string; ring: string }[] = [
  { value: 'blue',   bg: 'bg-blue-500',   ring: 'ring-blue-300 dark:ring-blue-600' },
  { value: 'green',  bg: 'bg-green-500',  ring: 'ring-green-300 dark:ring-green-600' },
  { value: 'red',    bg: 'bg-red-500',    ring: 'ring-red-300 dark:ring-red-600' },
  { value: 'purple', bg: 'bg-purple-500', ring: 'ring-purple-300 dark:ring-purple-600' },
  { value: 'orange', bg: 'bg-orange-500', ring: 'ring-orange-300 dark:ring-orange-600' },
  { value: 'pink',   bg: 'bg-pink-500',   ring: 'ring-pink-300 dark:ring-pink-600' },
  { value: 'yellow', bg: 'bg-yellow-400', ring: 'ring-yellow-300 dark:ring-yellow-500' },
  { value: 'gray',   bg: 'bg-gray-400',   ring: 'ring-gray-300 dark:ring-gray-600' },
]

function resolveVarHighlights(text: string, vars: Array<{ key: string; value: string }>) {
  const definedKeys = new Set(vars.map((v) => v.key))
  const parts: { text: string; type: 'text' | 'defined' | 'undefined' }[] = []
  const pattern = /\{\{([^}]+)\}\}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), type: 'text' })
    parts.push({ text: m[0], type: definedKeys.has(m[1]) ? 'defined' : 'undefined' })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), type: 'text' })
  return parts
}

interface Props {
  isDraft: boolean
  name: string
  color: string
  rootDirectory: string
  codingWorkspace: boolean
  workspaceInfo: ProjectConfig['workspaceInfo']
  instructions: string
  instructionMode: ProjectConfig['instructionMode']
  instructionsEnabled: boolean
  variables: Array<{ key: string; value: string }>
  varErrors: Record<number, string>
  showModeDropdown: boolean
  hasVarErrors: boolean
  onSetName: (v: string) => void
  onSetColor: (v: string) => void
  onNameBlur: () => void
  onConfirm?: () => void
  onInstructionsChange: (v: string) => void
  onRootDirChange: (v: string) => void
  onModeChange: (mode: ProjectConfig['instructionMode']) => void
  onEnabledToggle: () => void
  onBrowseDir: () => void
  onCodingWorkspaceToggle: () => void
  onSetShowModeDropdown: (v: boolean) => void
  onAddVariable: () => void
  onRemoveVariable: (idx: number) => void
  onVarChange: (idx: number, field: 'key' | 'value', val: string) => void
}

export function GeneralTab({
  isDraft, name, color, rootDirectory, codingWorkspace, workspaceInfo,
  instructions, instructionMode, instructionsEnabled,
  variables, varErrors, showModeDropdown, hasVarErrors,
  onSetName, onSetColor, onNameBlur, onConfirm,
  onInstructionsChange, onRootDirChange, onModeChange, onEnabledToggle, onBrowseDir, onCodingWorkspaceToggle,
  onSetShowModeDropdown, onAddVariable, onRemoveVariable, onVarChange,
}: Props) {
  const selectedModeLabel = INSTRUCTION_MODES.find((m) => m.value === instructionMode)?.label ?? instructionMode
  const highlightParts = resolveVarHighlights(instructions, variables)

  return (
    <>
      {/* Name */}
      <div>
        <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Name</label>
        <input
          autoFocus={isDraft}
          value={name}
          onChange={(e) => onSetName(e.target.value)}
          onBlur={onNameBlur}
          onKeyDown={isDraft ? (e) => { if (e.key === 'Enter' && !hasVarErrors) onConfirm?.() } : undefined}
          placeholder={isDraft ? 'Project name…' : undefined}
          className="mt-1 w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
          aria-label="Project name"
        />
      </div>

      {/* Color (draft only) */}
      {isDraft && (
        <div>
          <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Color</label>
          <div className="mt-1.5 flex gap-2 flex-wrap">
            {COLOR_OPTIONS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => onSetColor(c.value)}
                className={`w-5 h-5 rounded-full ${c.bg} ${color === c.value ? `ring-2 ring-offset-2 ${c.ring}` : ''}`}
                aria-label={`Color ${c.value}`}
                title={c.value}
              />
            ))}
          </div>
        </div>
      )}

      {/* Root directory */}
      <div>
        <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Root Directory</label>
        <div className="mt-1 flex gap-1">
          <input
            value={rootDirectory}
            onChange={(e) => onRootDirChange(e.target.value)}
            placeholder="e.g. /home/user/my-project"
            className="flex-1 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400 truncate"
            aria-label="Root directory"
          />
          <button
            type="button"
            onClick={onBrowseDir}
            className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400"
            aria-label="Browse directory"
            title="Browse"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
        </div>
        {workspaceInfo && (
          <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] dark:border-gray-700 dark:bg-gray-900/30">
            <p className="font-medium text-gray-700 dark:text-gray-200">
              {workspaceInfo.exists ? 'Workspace detected' : 'Workspace path not found'}
            </p>
            <p className="mt-1 text-gray-500 dark:text-gray-400">
              {workspaceInfo.isGitRepo
                ? `Git repo · ${workspaceInfo.branch ?? 'detached'} · ${workspaceInfo.dirty ? 'dirty' : 'clean'}`
                : workspaceInfo.exists
                  ? 'No git repository detected'
                  : 'Choose a valid directory to enable repo detection'}
            </p>
            {workspaceInfo.codingMarkers.length > 0 && (
              <p className="mt-1 text-gray-500 dark:text-gray-400">
                Coding markers: {workspaceInfo.codingMarkers.join(', ')}
              </p>
            )}
          </div>
        )}
        {(workspaceInfo?.isLikelyCodingWorkspace || codingWorkspace) && (
          <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2 dark:border-blue-900 dark:bg-blue-950/20">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium text-blue-700 dark:text-blue-300">Software workspace</p>
                <p className="mt-1 text-[10px] text-blue-700/80 dark:text-blue-300/80">
                  {codingWorkspace
                    ? 'Coding-focused repo and diff affordances stay enabled for this project.'
                    : 'This directory looks like a codebase. Enable coding-focused repo and diff affordances for this project.'}
                </p>
              </div>
              <button
                type="button"
                onClick={onCodingWorkspaceToggle}
                className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${codingWorkspace ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                aria-label={codingWorkspace ? 'Disable software workspace mode' : 'Enable software workspace mode'}
                role="switch"
                aria-checked={codingWorkspace}
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${codingWorkspace ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Instructions</label>
          <button
            type="button"
            onClick={onEnabledToggle}
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${instructionsEnabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
            aria-label={instructionsEnabled ? 'Disable instructions' : 'Enable instructions'}
            role="switch"
            aria-checked={instructionsEnabled}
          >
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${instructionsEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        <div className="mb-2">
          <DropdownPanel
            open={showModeDropdown}
            onClose={() => onSetShowModeDropdown(false)}
            width="w-full"
            trigger={
              <button
                type="button"
                onClick={() => onSetShowModeDropdown(!showModeDropdown)}
                className="w-full flex items-center justify-between text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                aria-label="Instruction mode"
              >
                <span>{selectedModeLabel}</span>
                <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
              </button>
            }
          >
            {INSTRUCTION_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => onModeChange(m.value)}
                className={`w-full text-left text-xs px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 ${instructionMode === m.value ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300'}`}
              >
                {m.label}
              </button>
            ))}
          </DropdownPanel>
        </div>

        <textarea
          value={instructions}
          onChange={(e) => onInstructionsChange(e.target.value)}
          placeholder="e.g. This is a React TypeScript project. Use functional components."
          rows={4}
          className={`w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-2 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none font-mono ${!instructionsEnabled ? 'opacity-50' : ''}`}
          disabled={!instructionsEnabled}
          aria-label="Project instructions"
        />

        {instructions && variables.length > 0 && (
          <div className="mt-1 text-[10px] font-mono leading-relaxed break-all text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-900 rounded p-2 max-h-20 overflow-y-auto">
            {highlightParts.map((p, i) =>
              p.type === 'text' ? (
                <span key={i}>{p.text}</span>
              ) : (
                <span
                  key={i}
                  className={p.type === 'defined' ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-red-500 dark:text-red-400 font-semibold'}
                  title={p.type === 'defined' ? 'Defined variable' : 'Undefined variable'}
                >
                  {p.text}
                </span>
              )
            )}
          </div>
        )}
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Supports <code className="bg-gray-100 dark:bg-gray-700 px-0.5 rounded">{'{{VARIABLE}}'}</code> substitution</p>
      </div>

      {/* Variables */}
      <div>
        <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Variables</label>
        <div className="mt-1 space-y-1.5">
          {variables.map((v, idx) => (
            <div key={idx} className="flex gap-1 items-start">
              <div className="flex-1 flex flex-col">
                <input
                  value={v.key}
                  onChange={(e) => onVarChange(idx, 'key', e.target.value.toUpperCase())}
                  placeholder="KEY_NAME"
                  className={`text-xs bg-white dark:bg-gray-700 border rounded-lg px-2 py-1.5 font-mono text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 ${varErrors[idx] ? 'border-red-400 focus:ring-red-400' : 'border-gray-200 dark:border-gray-600 focus:ring-blue-400'}`}
                  aria-label={`Variable key ${idx + 1}`}
                />
                {varErrors[idx] && <p className="text-[10px] text-red-500 mt-0.5">{varErrors[idx]}</p>}
              </div>
              <input
                value={v.value}
                onChange={(e) => onVarChange(idx, 'value', e.target.value)}
                placeholder="value"
                className="flex-[2] text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                aria-label={`Variable value ${idx + 1}`}
              />
              <button
                type="button"
                onClick={() => onRemoveVariable(idx)}
                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                aria-label={`Remove variable ${v.key || idx + 1}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={onAddVariable}
            className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
            aria-label="Add variable"
          >
            <Plus className="w-3.5 h-3.5" />
            Add variable
          </button>
        </div>
      </div>
    </>
  )
}
