import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import type { SkillConfig } from '../../shared/types'

const TOOL_LABELS = {
  fileEdit: 'File Edit',
  terminal: 'Terminal',
  webFetch: 'Web Fetch',
} as const

const EMPTY_SKILL: SkillConfig = {
  id: '',
  name: '',
  icon: '✨',
  description: '',
  instructions: '',
  tags: [],
  tools: {
    fileEdit: { enabled: false, approval: 'always-ask', instructions: '' },
    terminal: { enabled: false, approval: 'always-ask', instructions: '' },
    webFetch: { enabled: false, approval: 'always-ask', instructions: '' },
  },
  mcpServers: [],
  mcpServerTrust: [],
  mcpToolOverrides: [],
  knowledge: [],
}

export function SkillPanel() {
  const editingSkillId = useAppStore((s) => s.editingSkillId)
  const skills = useAppStore((s) => s.skills)
  const closeSkillPanel = useAppStore((s) => s.closeSkillPanel)
  const saveSkill = useAppStore((s) => s.saveSkill)
  const deleteSkill = useAppStore((s) => s.deleteSkill)
  const duplicateSkill = useAppStore((s) => s.duplicateSkill)
  const exportSkill = useAppStore((s) => s.exportSkill)

  const source = useMemo(() => editingSkillId ? skills.find((s) => s.id === editingSkillId) ?? null : null, [editingSkillId, skills])
  const [config, setConfig] = useState<SkillConfig>(() => source ? { ...source } : { ...EMPTY_SKILL })
  const [tagText, setTagText] = useState('')

  useEffect(() => {
    setConfig(source ? { ...source } : { ...EMPTY_SKILL })
    setTagText(source?.tags.join(', ') ?? '')
  }, [source])

  const isEditing = !!source?.id
  const canSave = config.name.trim().length > 0

  const update = <K extends keyof SkillConfig>(key: K, value: SkillConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = () => {
    if (!canSave) return
    void saveSkill({
      ...config,
      tags: tagText.split(',').map((tag) => tag.trim()).filter(Boolean),
    })
  }

  return (
    <div className="fixed inset-0 top-9 z-50 flex" role="dialog" aria-modal="true" aria-label="Skill configuration">
      <div className="flex-1 bg-black/30" onClick={closeSkillPanel} aria-hidden="true" />
      <div className="relative w-[440px] max-w-[92vw] bg-white dark:bg-gray-900 shadow-xl flex flex-col border-l border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-medium text-gray-800 dark:text-gray-100">
            {isEditing ? 'Edit Skill' : 'Create Skill'}
          </h2>
          <button
            onClick={closeSkillPanel}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Close skill panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5 mr-1.5">
          <section className="space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Skill</p>
            <div className="flex items-center gap-2">
              <input
                value={config.icon}
                onChange={(e) => update('icon', e.target.value)}
                maxLength={4}
                className="w-10 text-center text-xl border border-gray-200 dark:border-gray-700 rounded-lg px-1 py-1 bg-white dark:bg-gray-800 focus:outline-none"
                aria-label="Skill icon"
              />
              <input
                value={config.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="Skill name"
                className="flex-1 text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <input
              value={config.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder="Short description"
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            <textarea
              value={config.instructions}
              onChange={(e) => update('instructions', e.target.value)}
              placeholder="Reusable instructions..."
              rows={7}
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
            />
            <input
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              placeholder="Tags, comma separated"
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </section>

          <section className="space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Built-in tools</p>
            {(['fileEdit', 'terminal', 'webFetch'] as const).map((key) => {
              const tool = config.tools[key]
              const updateEnabled = (enabled: boolean) => update('tools', {
                ...config.tools,
                [key]: {
                  ...tool,
                  enabled,
                  approval: enabled && tool.approval === 'disabled' ? 'always-ask' : tool.approval,
                },
              })
              return (
                <div key={key} className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-100">
                      <input
                        type="checkbox"
                        checked={tool.enabled}
                        onChange={(e) => updateEnabled(e.target.checked)}
                        className="w-3.5 h-3.5 rounded"
                      />
                      {TOOL_LABELS[key]}
                    </label>
                    <select
                      value={tool.approval}
                      onChange={(e) => update('tools', {
                        ...config.tools,
                        [key]: { ...tool, approval: e.target.value as 'auto' | 'always-ask' | 'disabled' },
                      })}
                      className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-400 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    >
                      <option value="always-ask">Always ask</option>
                      <option value="auto">Auto</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </div>
                  <textarea
                    value={tool.instructions}
                    onChange={(e) => update('tools', {
                      ...config.tools,
                      [key]: { ...tool, instructions: e.target.value },
                    })}
                    rows={2}
                    placeholder={`${TOOL_LABELS[key]} instructions`}
                    className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                  />
                </div>
              )
            })}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Knowledge</p>
              <button
                type="button"
                onClick={() => update('knowledge', [...config.knowledge, { title: '', content: '' }])}
                className="inline-flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700"
              >
                <Plus className="w-3 h-3" />
                Add
              </button>
            </div>
            {config.knowledge.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">No skill knowledge notes.</p>
            ) : config.knowledge.map((item, index) => (
              <div key={index} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    value={item.title}
                    onChange={(e) => {
                      const next = [...config.knowledge]
                      next[index] = { ...item, title: e.target.value }
                      update('knowledge', next)
                    }}
                    placeholder="Title"
                    className="flex-1 text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => update('knowledge', config.knowledge.filter((_, i) => i !== index))}
                    className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    aria-label="Remove knowledge note"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <textarea
                  value={item.content}
                  onChange={(e) => {
                    const next = [...config.knowledge]
                    next[index] = { ...item, content: e.target.value }
                    update('knowledge', next)
                  }}
                  rows={3}
                  placeholder="Content"
                  className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 focus:outline-none resize-none"
                />
              </div>
            ))}
          </section>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex gap-2">
            {isEditing && (
              <button
                onClick={() => void deleteSkill(config.id)}
                className="text-xs px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {isEditing && (
              <>
                <button
                  onClick={() => void duplicateSkill(config.id)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Duplicate
                </button>
                <button
                  onClick={() => void exportSkill(config.id)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Export
                </button>
              </>
            )}
            {!isEditing && (
              <button
                onClick={closeSkillPanel}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="text-xs px-4 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isEditing ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
