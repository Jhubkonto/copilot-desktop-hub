import { useState, useEffect, useCallback, useRef } from 'react'
import { FolderOpen, Plus, X, ChevronDown, GripVertical, Star, BookOpen, Trash2, Edit2, Check, RotateCcw } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import type { AgentConfig, WikiEntry } from '../../shared/types'
import type { Milestone, ProjectConfig, ScopeRule } from '../store/types'
import { DEFAULT_PROJECT_CONFIG } from '../store/types'

// ── Types ──────────────────────────────────────────────────────────────────────

type TabId = 'general' | 'scope' | 'milestones' | 'team' | 'wiki'

interface EditProps {
  projectId: string
  draft?: false
  onClose: () => void
  onConfirm?: never
  initialTab?: TabId
}

interface DraftProps {
  projectId?: null
  draft: true
  onClose: () => void
  onConfirm: (name: string, color: string, config: Partial<ProjectConfig>) => Promise<void>
  initialTab?: TabId
}

type Props = EditProps | DraftProps

// ── Constants ──────────────────────────────────────────────────────────────────

const INSTRUCTION_MODES: { value: ProjectConfig['instructionMode']; label: string }[] = [
  { value: 'prepend', label: 'Prepend to agent prompt' },
  { value: 'append', label: 'Append to agent prompt' },
  { value: 'replace', label: 'Replace agent prompt' },
  { value: 'standalone', label: 'Standalone (ignore agent prompt)' },
]

const VAR_KEY_REGEX = /^[A-Z0-9_]+$/

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

// ── Helpers ────────────────────────────────────────────────────────────────────

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


function parseWikiTags(value: string): string[] {
  return Array.from(new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean)))
}

function sortWikiEntries(entries: WikiEntry[]): WikiEntry[] {
  return [...entries].sort((a, b) => b.updated_at - a.updated_at)
}

function WikiTab({ projectId }: { projectId: string }) {
  const addToast = useAppStore((s) => s.addToast)
  const [entries, setEntries] = useState<WikiEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftTags, setDraftTags] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const resetEditor = useCallback(() => {
    setEditingId(null)
    setDraftTitle('')
    setDraftTags('')
    setDraftBody('')
  }, [])

  const loadEntries = useCallback(async () => {
    setLoading(true)
    try {
      setEntries(sortWikiEntries(await window.api.listWikiEntries(projectId)))
    } catch {
      addToast('Failed to load wiki entries', 'error')
    } finally {
      setLoading(false)
    }
  }, [addToast, projectId])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  const openNewEntry = useCallback(() => {
    setConfirmDeleteId(null)
    setEditingId('new')
    setDraftTitle('')
    setDraftTags('')
    setDraftBody('')
  }, [])

  const openEntry = useCallback((entry: WikiEntry) => {
    setConfirmDeleteId(null)
    setEditingId(entry.id)
    setDraftTitle(entry.title)
    setDraftTags(entry.tags.join(', '))
    setDraftBody(entry.body)
  }, [])

  const handleSave = useCallback(async () => {
    const title = draftTitle.trim()
    if (!title) {
      addToast('Wiki title is required', 'error')
      return
    }

    setSaving(true)
    try {
      const tags = parseWikiTags(draftTags)
      if (editingId === 'new') {
        const created = await window.api.createWikiEntry(projectId, title, draftBody, tags)
        setEntries((prev) => sortWikiEntries([created, ...prev]))
        addToast('Wiki entry created', 'success')
      } else if (editingId) {
        const updated = await window.api.updateWikiEntry(editingId, {
          title,
          body: draftBody,
          tags,
        })
        setEntries((prev) => sortWikiEntries(prev.map((entry) => (entry.id === editingId ? updated : entry))))
        addToast('Wiki entry updated', 'success')
      }
      resetEditor()
    } catch {
      addToast('Failed to save wiki entry', 'error')
    } finally {
      setSaving(false)
    }
  }, [addToast, draftBody, draftTags, draftTitle, editingId, projectId, resetEditor])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await window.api.deleteWikiEntry(id)
      setEntries((prev) => prev.filter((entry) => entry.id != id))
      setConfirmDeleteId(null)
      if (editingId === id) resetEditor()
      addToast('Wiki entry deleted', 'success')
    } catch {
      addToast('Failed to delete wiki entry', 'error')
    }
  }, [addToast, editingId, resetEditor])

  const parsedDraftTags = parseWikiTags(draftTags)

  const renderEditor = (mode: 'new' | 'edit') => (
    <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-800 shadow-sm p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-4 h-4 text-blue-500 shrink-0" />
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate">
            {mode === 'new' ? 'New wiki entry' : 'Editing wiki entry'}
          </span>
        </div>
        <button
          type="button"
          onClick={resetEditor}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <RotateCcw className="w-3 h-3" />
          Cancel
        </button>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Title</label>
        <input
          autoFocus
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          placeholder="e.g. Architecture decisions"
          className="w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
          aria-label="Wiki title"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Tags</label>
        <input
          value={draftTags}
          onChange={(e) => setDraftTags(e.target.value)}
          placeholder="architecture, decisions, onboarding"
          className="w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
          aria-label="Wiki tags"
        />
        {parsedDraftTags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {parsedDraftTags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Body</label>
        <textarea
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          rows={8}
          placeholder="Write markdown notes for this project..."
          className="w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-2 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-y"
          aria-label="Wiki body"
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !draftTitle.trim()}
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Check className="w-3.5 h-3.5" />
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Project wiki</label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Capture durable project context, decisions, and notes.</p>
        </div>
        <button
          type="button"
          onClick={openNewEntry}
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-gray-600"
        >
          <Plus className="w-3.5 h-3.5" />
          New entry
        </button>
      </div>

      {editingId == 'new' && renderEditor('new')}

      {loading ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          Loading wiki entries…
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 px-4 py-8 text-center space-y-2">
          <BookOpen className="w-5 h-5 mx-auto text-gray-400 dark:text-gray-500" />
          <p className="text-sm text-gray-600 dark:text-gray-300">No wiki entries yet. Add your first entry to start building project knowledge.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            if (editingId === entry.id) {
              return <div key={entry.id}>{renderEditor('edit')}</div>
            }

            return (
              <div
                key={entry.id}
                onClick={() => openEntry(entry)}
                className={`rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 p-3 transition-colors cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 ${entry.superseded_by ? 'opacity-60' : ''}`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    openEntry(entry)
                  }
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-semibold text-gray-800 dark:text-gray-100 ${entry.superseded_by ? 'line-through' : ''}`}>
                        {entry.title}
                      </span>
                      {entry.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <p
                      className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-words"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {entry.body || 'No content yet.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => openEntry(entry)}
                      className="p-1.5 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                      aria-label={`Edit ${entry.title}`}
                      title="Edit entry"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {confirmDeleteId === entry.id ? (
                      <div className="flex items-center gap-1 text-[11px]">
                        <span className="text-gray-500 dark:text-gray-400">Are you sure?</span>
                        <button
                          type="button"
                          onClick={() => void handleDelete(entry.id)}
                          className="px-2 py-1 rounded-md bg-red-600 text-white hover:bg-red-700"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 rounded-md border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(entry.id)}
                        className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        aria-label={`Delete ${entry.title}`}
                        title="Delete entry"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── MilestoneCard ──────────────────────────────────────────────────────────────

function MilestoneCard({
  milestone,
  onChange,
  onStatus,
  onRemove,
}: {
  milestone: Milestone
  onChange: (id: string, field: 'title' | 'description', val: string) => void
  onStatus: (id: string, status: Milestone['status']) => void
  onRemove: (id: string) => void
}) {
  return (
    <div
      className={`mt-1 rounded-lg border p-2 space-y-1 ${
        milestone.status === 'active'
          ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/10'
          : milestone.status === 'completed'
            ? 'border-gray-200 dark:border-gray-700 opacity-60'
            : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      <div className="flex gap-1 items-center">
        <input
          value={milestone.title}
          onChange={(e) => onChange(milestone.id, 'title', e.target.value)}
          placeholder="Milestone title"
          className="flex-1 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
          aria-label="Milestone title"
        />
        <button
          type="button"
          onClick={() => onRemove(milestone.id)}
          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
          aria-label={`Remove milestone ${milestone.title || ''}`}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <input
        value={milestone.description ?? ''}
        onChange={(e) => onChange(milestone.id, 'description', e.target.value)}
        placeholder="Description (optional)"
        className="w-full text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        aria-label="Milestone description"
      />
      <div className="flex gap-1 pt-0.5">
        {milestone.status !== 'active' && (
          <button
            type="button"
            onClick={() => onStatus(milestone.id, 'active')}
            className="text-[10px] px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50"
            aria-label={`Set ${milestone.title} as active`}
          >
            Set active
          </button>
        )}
        {milestone.status === 'active' && (
          <button
            type="button"
            onClick={() => onStatus(milestone.id, 'completed')}
            className="text-[10px] px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50"
            aria-label={`Mark ${milestone.title} as complete`}
          >
            Mark complete
          </button>
        )}
        {milestone.status === 'completed' && (
          <button
            type="button"
            onClick={() => onStatus(milestone.id, 'upcoming')}
            className="text-[10px] px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
            aria-label={`Reopen ${milestone.title}`}
          >
            Reopen
          </button>
        )}
      </div>
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ProjectSettingsPanel(props: Props) {
  const { onClose } = props
  const isDraft = props.draft === true

  const projects = useAppStore((s) => s.projects)
  const projectConfigs = useAppStore((s) => s.projectConfigs)
  const renameProject = useAppStore((s) => s.renameProject)
  const updateProjectConfig = useAppStore((s) => s.updateProjectConfig)
  const projectAgents = useAppStore((s) => s.projectAgents)
  const loadProjectAgents = useAppStore((s) => s.loadProjectAgents)
  const agents = useAppStore((s) => s.agents)
  const addAgentToProject = useAppStore((s) => s.addAgentToProject)
  const removeAgentFromProject = useAppStore((s) => s.removeAgentFromProject)
  const setProjectPrimaryAgent = useAppStore((s) => s.setProjectPrimaryAgent)
  const reorderProjectAgents = useAppStore((s) => s.reorderProjectAgents)
  const updateProjectOrchestration = useAppStore((s) => s.updateProjectOrchestration)
  const loadProjectConfig = useAppStore((s) => s.loadProjectConfig)
  const addToast = useAppStore((s) => s.addToast)

  const projectId = isDraft ? null : (props as EditProps).projectId
  const project = projectId ? projects.find((p) => p.id === projectId) : null
  const cfg = projectId ? projectConfigs[projectId] : null

  const [activeTab, setActiveTab] = useState<TabId>(props.initialTab ?? 'general')
  const [name, setName] = useState(project?.name ?? '')
  const [color, setColor] = useState(project?.color ?? 'blue')
  const [instructions, setInstructions] = useState(cfg?.instructions ?? '')
  const [rootDirectory, setRootDirectory] = useState(cfg?.rootDirectory ?? '')
  const [instructionMode, setInstructionMode] = useState<ProjectConfig['instructionMode']>(cfg?.instructionMode ?? 'prepend')
  const [instructionsEnabled, setInstructionsEnabled] = useState(cfg?.instructionsEnabled ?? true)
  const [variables, setVariables] = useState<Array<{ key: string; value: string }>>(cfg?.variables ?? [])
  const [varErrors, setVarErrors] = useState<Record<number, string>>({})
  const [showModeDropdown, setShowModeDropdown] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [inScope, setInScope] = useState<ScopeRule[]>(cfg?.inScope ?? [])
  const [outOfScope, setOutOfScope] = useState<ScopeRule[]>(cfg?.outOfScope ?? [])
  const [milestones, setMilestones] = useState<Milestone[]>(cfg?.milestones ?? [])
  const [agentPickerQuery, setAgentPickerQuery] = useState('')
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [teamDraggingId, setTeamDraggingId] = useState<string | null>(null)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modeDropdownRef = useRef<HTMLDivElement>(null)

  // Sync from store when switching to a different existing project
  useEffect(() => {
    if (isDraft || !cfg) return
    setName(project?.name ?? '')
    setColor(project?.color ?? 'blue')
    setInstructions(cfg.instructions)
    setRootDirectory(cfg.rootDirectory)
    setInstructionMode(cfg.instructionMode)
    setInstructionsEnabled(cfg.instructionsEnabled)
    setVariables(cfg.variables)
    setInScope(cfg.inScope ?? [])
    setOutOfScope(cfg.outOfScope ?? [])
    setMilestones(cfg.milestones ?? [])
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isDraft && projectId) loadProjectAgents(projectId)
  }, [projectId, isDraft, loadProjectAgents])

  useEffect(() => {
    if (!isDraft && projectId) void loadProjectConfig(projectId)
  }, [projectId, isDraft, loadProjectConfig])

  useEffect(() => {
    if (!showModeDropdown) return
    const handler = (e: MouseEvent) => {
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(e.target as Node)) {
        setShowModeDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showModeDropdown])

  const debounceSave = useCallback((partial: Partial<ProjectConfig>) => {
    if (isDraft || !projectId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      updateProjectConfig(projectId, partial)
    }, 500)
  }, [isDraft, projectId, updateProjectConfig])

  const handleNameBlur = async () => {
    if (isDraft || !projectId) return
    const trimmed = name.trim()
    if (trimmed && trimmed !== project?.name) {
      await renameProject(projectId, trimmed)
    }
  }

  const handleInstructionsChange = (val: string) => {
    setInstructions(val)
    debounceSave({ instructions: val })
  }

  const handleRootDirChange = (val: string) => {
    setRootDirectory(val)
    debounceSave({ rootDirectory: val })
  }

  const handleModeChange = (mode: ProjectConfig['instructionMode']) => {
    setInstructionMode(mode)
    setShowModeDropdown(false)
    if (!isDraft && projectId) updateProjectConfig(projectId, { instructionMode: mode })
  }

  const handleEnabledToggle = () => {
    const next = !instructionsEnabled
    setInstructionsEnabled(next)
    if (!isDraft && projectId) updateProjectConfig(projectId, { instructionsEnabled: next })
  }

  const handleBrowseDir = async () => {
    const result = await window.api.openDirectoryDialog()
    if (result && result.length > 0) {
      setRootDirectory(result[0])
      if (!isDraft && projectId) updateProjectConfig(projectId, { rootDirectory: result[0] })
    }
  }

  const handleAddVariable = () => {
    const next = [...variables, { key: '', value: '' }]
    setVariables(next)
    if (!isDraft && projectId) updateProjectConfig(projectId, { variables: next })
  }

  const handleRemoveVariable = (idx: number) => {
    const next = variables.filter((_, i) => i !== idx)
    setVariables(next)
    setVarErrors((prev) => { const e = { ...prev }; delete e[idx]; return e })
    if (!isDraft && projectId) updateProjectConfig(projectId, { variables: next })
  }

  const handleVarChange = (idx: number, field: 'key' | 'value', val: string) => {
    const next = variables.map((v, i) => i === idx ? { ...v, [field]: val } : v)
    setVariables(next)
    if (field === 'key') {
      const trimmed = val.trim()
      if (trimmed && !VAR_KEY_REGEX.test(trimmed)) {
        setVarErrors((prev) => ({ ...prev, [idx]: 'Key must be uppercase letters, digits, and underscores only' }))
      } else {
        setVarErrors((prev) => { const e = { ...prev }; delete e[idx]; return e })
        debounceSave({ variables: next })
      }
    } else {
      debounceSave({ variables: next })
    }
  }

  // ── Scope rule handlers ────────────────────────────────────────────────────

  const mkId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

  const handleAddScopeRule = (type: 'inScope' | 'outOfScope') => {
    const newRule: ScopeRule = { id: mkId(), description: '' }
    if (type === 'inScope') {
      const next = [...inScope, newRule]
      setInScope(next)
      if (!isDraft && projectId) debounceSave({ inScope: next })
    } else {
      const next = [...outOfScope, newRule]
      setOutOfScope(next)
      if (!isDraft && projectId) debounceSave({ outOfScope: next })
    }
  }

  const handleRemoveScopeRule = (type: 'inScope' | 'outOfScope', id: string) => {
    if (type === 'inScope') {
      const next = inScope.filter((r) => r.id !== id)
      setInScope(next)
      if (!isDraft && projectId) debounceSave({ inScope: next })
    } else {
      const next = outOfScope.filter((r) => r.id !== id)
      setOutOfScope(next)
      if (!isDraft && projectId) debounceSave({ outOfScope: next })
    }
  }

  const handleScopeRuleChange = (type: 'inScope' | 'outOfScope', id: string, field: 'description' | 'pathGlob', val: string) => {
    const update = (rules: ScopeRule[]) => rules.map((r) => r.id === id ? { ...r, [field]: val || undefined } : r)
    if (type === 'inScope') {
      const next = update(inScope)
      setInScope(next)
      if (!isDraft && projectId) debounceSave({ inScope: next })
    } else {
      const next = update(outOfScope)
      setOutOfScope(next)
      if (!isDraft && projectId) debounceSave({ outOfScope: next })
    }
  }

  // ── Milestone handlers ────────────────────────────────────────────────────

  const handleAddMilestone = () => {
    const newMilestone: Milestone = { id: mkId(), title: '', status: 'upcoming' }
    const next = [...milestones, newMilestone]
    setMilestones(next)
    if (!isDraft && projectId) debounceSave({ milestones: next })
  }

  const handleRemoveMilestone = (id: string) => {
    const next = milestones.filter((m) => m.id !== id)
    setMilestones(next)
    if (!isDraft && projectId) debounceSave({ milestones: next })
  }

  const handleMilestoneChange = (id: string, field: 'title' | 'description', val: string) => {
    const next = milestones.map((m) => m.id === id ? { ...m, [field]: val } : m)
    setMilestones(next)
    if (!isDraft && projectId) debounceSave({ milestones: next })
  }

  const handleMilestoneStatus = (id: string, status: Milestone['status']) => {
    let next = milestones.map((m) => {
      if (m.id !== id) return m
      return { ...m, status, completedAt: status === 'completed' ? Date.now() : undefined }
    })
    // Only one active milestone at a time
    if (status === 'active') {
      next = next.map((m) => m.id === id ? m : m.status === 'active' ? { ...m, status: 'upcoming' as const } : m)
    }
    setMilestones(next)
    if (!isDraft && projectId) debounceSave({ milestones: next })
  }

  const handleConfirm = async () => {
    if (!isDraft) return
    const trimmedName = name.trim()
    if (!trimmedName) return
    setIsSubmitting(true)
    try {
      await (props as DraftProps).onConfirm(trimmedName, color, {
        instructions,
        rootDirectory,
        instructionMode,
        instructionsEnabled,
        variables,
        inScope,
        outOfScope,
        milestones,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const selectedModeLabel = INSTRUCTION_MODES.find((m) => m.value === instructionMode)?.label ?? instructionMode
  const highlightParts = resolveVarHighlights(instructions, variables)
  const hasVarErrors = Object.keys(varErrors).length > 0

  const activeMilestone = milestones.find((m) => m.status === 'active')
  const upcomingMilestones = milestones.filter((m) => m.status === 'upcoming')
  const completedMilestones = milestones.filter((m) => m.status === 'completed')

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-800/50 rounded-b-xl border-t border-gray-200 dark:border-gray-700">

      {/* Tab bar */}
      <div className="flex gap-0.5 px-3 pt-2 pb-0 flex-wrap" role="tablist">
        {(['general', 'scope', 'milestones', ...(!isDraft ? ['team', 'wiki'] : [])] as TabId[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`text-[11px] px-2.5 py-1 rounded-md font-medium transition-colors ${
              activeTab === tab
                ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {tab === 'general'
              ? 'General'
              : tab === 'scope'
                ? 'Scope'
                : tab === 'team'
                  ? 'Team'
                  : tab === 'wiki'
                    ? 'Wiki'
                    : `Milestones${activeMilestone ? ' 🎯' : ''}`}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-2 space-y-4">

        {/* ── General tab ──────────────────────────────────────────────────── */}
        {activeTab === 'general' && (
          <>
            {/* Name */}
            <div>
              <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Name</label>
              <input
                autoFocus={isDraft}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={handleNameBlur}
                onKeyDown={isDraft ? (e) => { if (e.key === 'Enter' && !hasVarErrors) handleConfirm() } : undefined}
                placeholder={isDraft ? 'Project name…' : undefined}
                className="mt-1 w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                aria-label="Project name"
              />
            </div>

            {/* Color (draft mode only) */}
            {isDraft && (
              <div>
                <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Color</label>
                <div className="mt-1.5 flex gap-2 flex-wrap">
                  {COLOR_OPTIONS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setColor(c.value)}
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
                  onChange={(e) => handleRootDirChange(e.target.value)}
                  placeholder="e.g. /home/user/my-project"
                  className="flex-1 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400 truncate"
                  aria-label="Root directory"
                />
                <button
                  type="button"
                  onClick={handleBrowseDir}
                  className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400"
                  aria-label="Browse directory"
                  title="Browse"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Instructions */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Instructions</label>
                <button
                  type="button"
                  onClick={handleEnabledToggle}
                  className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${instructionsEnabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                  aria-label={instructionsEnabled ? 'Disable instructions' : 'Enable instructions'}
                  role="switch"
                  aria-checked={instructionsEnabled}
                >
                  <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${instructionsEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                </button>
              </div>

              {/* Instruction mode dropdown */}
              <div className="mb-2 relative" ref={modeDropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowModeDropdown((v) => !v)}
                  className="w-full flex items-center justify-between text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                  aria-label="Instruction mode"
                >
                  <span>{selectedModeLabel}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                </button>
                {showModeDropdown && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-0.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
                    {INSTRUCTION_MODES.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => handleModeChange(m.value)}
                        className={`w-full text-left text-xs px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 ${instructionMode === m.value ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300'}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Instructions textarea */}
              <textarea
                value={instructions}
                onChange={(e) => handleInstructionsChange(e.target.value)}
                placeholder="e.g. This is a React TypeScript project. Use functional components."
                rows={4}
                className={`w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-2 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none font-mono ${!instructionsEnabled ? 'opacity-50' : ''}`}
                disabled={!instructionsEnabled}
                aria-label="Project instructions"
              />

              {/* Variable highlight preview */}
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
                        onChange={(e) => handleVarChange(idx, 'key', e.target.value.toUpperCase())}
                        placeholder="KEY_NAME"
                        className={`text-xs bg-white dark:bg-gray-700 border rounded-lg px-2 py-1.5 font-mono text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 ${varErrors[idx] ? 'border-red-400 focus:ring-red-400' : 'border-gray-200 dark:border-gray-600 focus:ring-blue-400'}`}
                        aria-label={`Variable key ${idx + 1}`}
                      />
                      {varErrors[idx] && <p className="text-[10px] text-red-500 mt-0.5">{varErrors[idx]}</p>}
                    </div>
                    <input
                      value={v.value}
                      onChange={(e) => handleVarChange(idx, 'value', e.target.value)}
                      placeholder="value"
                      className="flex-[2] text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      aria-label={`Variable value ${idx + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveVariable(idx)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                      aria-label={`Remove variable ${v.key || idx + 1}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={handleAddVariable}
                  className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                  aria-label="Add variable"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add variable
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Scope tab ────────────────────────────────────────────────────── */}
        {activeTab === 'scope' && (
          <>
            {/* In Scope */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">In Scope</label>
                <button
                  type="button"
                  onClick={() => handleAddScopeRule('inScope')}
                  className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                  aria-label="Add in-scope rule"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>
              {inScope.length === 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic">No in-scope rules. Add rules to tell the agent what to focus on.</p>
              )}
              <div className="space-y-2">
                {inScope.map((rule) => (
                  <div key={rule.id} className="space-y-1">
                    <div className="flex gap-1 items-center">
                      <input
                        value={rule.description}
                        onChange={(e) => handleScopeRuleChange('inScope', rule.id, 'description', e.target.value)}
                        placeholder="e.g. TypeScript source files in src/"
                        className="flex-1 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        aria-label="Scope rule description"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveScopeRule('inScope', rule.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                        aria-label="Remove in-scope rule"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <input
                      value={rule.pathGlob ?? ''}
                      onChange={(e) => handleScopeRuleChange('inScope', rule.id, 'pathGlob', e.target.value)}
                      placeholder="Path glob (optional): e.g. src/**/*.ts"
                      className="w-full text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
                      aria-label="Scope rule path glob"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Out of Scope */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Out of Scope</label>
                <button
                  type="button"
                  onClick={() => handleAddScopeRule('outOfScope')}
                  className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                  aria-label="Add out-of-scope rule"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>
              {outOfScope.length === 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic">No out-of-scope rules. Add rules to prevent scope creep.</p>
              )}
              <div className="space-y-2">
                {outOfScope.map((rule) => (
                  <div key={rule.id} className="space-y-1">
                    <div className="flex gap-1 items-center">
                      <input
                        value={rule.description}
                        onChange={(e) => handleScopeRuleChange('outOfScope', rule.id, 'description', e.target.value)}
                        placeholder="e.g. Do not change deployment configs"
                        className="flex-1 text-xs bg-white dark:bg-gray-700 border border-orange-200 dark:border-orange-800/50 rounded-lg px-2 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-orange-400"
                        aria-label="Out-of-scope rule description"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveScopeRule('outOfScope', rule.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                        aria-label="Remove out-of-scope rule"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <input
                      value={rule.pathGlob ?? ''}
                      onChange={(e) => handleScopeRuleChange('outOfScope', rule.id, 'pathGlob', e.target.value)}
                      placeholder="Path glob (optional): e.g. infra/**"
                      className="w-full text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
                      aria-label="Out-of-scope rule path glob"
                    />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Milestones tab ───────────────────────────────────────────────── */}
        {activeTab === 'milestones' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-gray-400 dark:text-gray-500">Track what the agent is currently working toward</p>
              <button
                type="button"
                onClick={handleAddMilestone}
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
                  onChange={handleMilestoneChange}
                  onStatus={handleMilestoneStatus}
                  onRemove={handleRemoveMilestone}
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
                      onChange={handleMilestoneChange}
                      onStatus={handleMilestoneStatus}
                      onRemove={handleRemoveMilestone}
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
                      onChange={handleMilestoneChange}
                      onStatus={handleMilestoneStatus}
                      onRemove={handleRemoveMilestone}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Team tab ─────────────────────────────────────────────────────── */}
        {activeTab === 'wiki' && !isDraft && projectId && <WikiTab projectId={projectId} />}

        {activeTab === 'team' && !isDraft && projectId && (
          <div className="space-y-4">
            {/* Agent list header */}
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Team agents</label>
              <button
                type="button"
                onClick={() => setShowAgentPicker((v) => !v)}
                className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                aria-label="Add agent to project"
              >
                <Plus className="w-3.5 h-3.5" />
                Add agent
              </button>
            </div>

            {/* Orchestration toggle — shown inline when ≥2 agents */}
            {(projectAgents[projectId] ?? []).length >= 2 && (() => {
              const orchCfg = projectConfigs[projectId] ?? DEFAULT_PROJECT_CONFIG
              return (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2 space-y-2">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Multi-agent orchestration</span>
                    <input
                      type="checkbox"
                      checked={orchCfg.orchestrationEnabled}
                      onChange={(e) => updateProjectOrchestration(projectId, { orchestrationEnabled: e.target.checked })}
                      className="w-3.5 h-3.5 rounded accent-blue-500"
                    />
                  </label>
                  {orchCfg.orchestrationEnabled && (
                    <div className="flex items-center gap-4 pl-0.5">
                      <label className="flex items-center gap-1.5">
                        <span className="text-[10px] text-gray-500 dark:text-gray-400">Max depth</span>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={orchCfg.maxDelegationDepth}
                          onChange={(e) => updateProjectOrchestration(projectId, { maxDelegationDepth: Number(e.target.value) })}
                          className="w-10 text-[10px] px-1 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                        />
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={orchCfg.showTeamActivity}
                          onChange={(e) => updateProjectOrchestration(projectId, { showTeamActivity: e.target.checked })}
                          className="w-3 h-3 rounded accent-blue-500"
                        />
                        <span className="text-[10px] text-gray-500 dark:text-gray-400">Show activity</span>
                      </label>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Agent picker */}
            {showAgentPicker && (
              <div className="space-y-1">
                <input
                  autoFocus
                  value={agentPickerQuery}
                  onChange={(e) => setAgentPickerQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setShowAgentPicker(false); setAgentPickerQuery('') }
                  }}
                  placeholder="Search agents…"
                  aria-label="Search agents to add"
                  className="w-full text-xs bg-white dark:bg-gray-700 border border-blue-400 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <div className="max-h-36 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
                  {(() => {
                    const memberIds = new Set((projectAgents[projectId] ?? []).map((m) => m.agentId))
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
                        onClick={async () => {
                          const currentMembers = projectAgents[projectId] ?? []
                          await addAgentToProject(projectId, agent.id)
                          if (currentMembers.length === 0) await setProjectPrimaryAgent(projectId, agent.id)
                          addToast(`🤖 ${agent.name} added to project`, 'success')
                          setShowAgentPicker(false)
                          setAgentPickerQuery('')
                        }}
                        className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        aria-label={`Add ${agent.name} to project`}
                      >
                        <span>{agent.icon}</span>
                        <span className="truncate">{agent.name}</span>
                      </button>
                    ))
                  })()}
                </div>
              </div>
            )}

            {/* Member list */}
            {(projectAgents[projectId] ?? []).length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-4">
                No agents in this project yet.
              </p>
            ) : (
              <div className="space-y-0.5">
                {(projectAgents[projectId] ?? []).map((member) => {
                  const isDragging = teamDraggingId === member.agentId
                  return (
                    <div
                      key={member.agentId}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('member-agent-id', member.agentId)
                        e.dataTransfer.effectAllowed = 'move'
                        setTeamDraggingId(member.agentId)
                      }}
                      onDragEnd={() => setTeamDraggingId(null)}
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
                        const members = projectAgents[projectId] ?? []
                        const srcIdx = members.findIndex((a) => a.agentId === srcId)
                        const tgtIdx = members.findIndex((a) => a.agentId === member.agentId)
                        if (srcIdx === -1 || tgtIdx === -1) return
                        const reordered = [...members]
                        reordered.splice(srcIdx, 1)
                        reordered.splice(tgtIdx, 0, members[srcIdx])
                        reorderProjectAgents(projectId, reordered.map((a) => a.agentId))
                        setTeamDraggingId(null)
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
                        const orchEnabled = (projectConfigs[projectId] ?? DEFAULT_PROJECT_CONFIG).orchestrationEnabled
                        const teamSize = (projectAgents[projectId] ?? []).length
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
                            onClick={() => setProjectPrimaryAgent(projectId, member.agentId)}
                            className="p-0.5 rounded text-gray-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20"
                            title="Set as primary"
                            aria-label={`Set ${member.agentName} as primary agent`}
                          >
                            <Star className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeAgentFromProject(projectId, member.agentId)}
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
        )}
      </div>

      {/* Draft mode: Create / Cancel buttons */}
      {isDraft && (
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!name.trim() || hasVarErrors || isSubmitting}
            className="text-xs px-4 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Create project"
          >
            {isSubmitting ? 'Creating…' : 'Create project'}
          </button>
        </div>
      )}
    </div>
  )
}
