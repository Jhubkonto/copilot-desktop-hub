import { useDeferredValue, useMemo, useState } from 'react'
import { Copy, Download, Plus, Search, Sparkles, Trash2, Upload, Wrench, X } from 'lucide-react'
import { useAppStore } from '../../store/app-store'
import type { SkillConfig } from '../../../shared/types'
import { PaneSkeleton, PaneEmptyState } from './pane-primitives'

function enabledToolCount(skill: SkillConfig): number {
  return Number(skill.tools.fileEdit.enabled) + Number(skill.tools.terminal.enabled) + Number(skill.tools.webFetch.enabled)
}

export function SkillsPane() {
  const skills = useAppStore((s) => s.skills)
  const skillsLoading = useAppStore((s) => s.skillsLoading)
  const openCreateSkill = useAppStore((s) => s.openCreateSkill)
  const openEditSkill = useAppStore((s) => s.openEditSkill)
  const importSkill = useAppStore((s) => s.importSkill)
  const duplicateSkill = useAppStore((s) => s.duplicateSkill)
  const exportSkill = useAppStore((s) => s.exportSkill)
  const deleteSkill = useAppStore((s) => s.deleteSkill)
  const setShowSkillGenerator = useAppStore((s) => s.setShowSkillGenerator)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  const filtered = useMemo(
    () => deferredQuery
      ? skills.filter((skill) => {
        const q = deferredQuery.toLowerCase()
        return skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q) || skill.tags.some((tag) => tag.toLowerCase().includes(q))
      })
      : skills,
    [skills, deferredQuery],
  )

  if (skillsLoading) {
    return (
      <PaneSkeleton rows={3} rowHeight="h-14" />
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 h-9 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {skills.length} skill{skills.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={importSkill}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Import skill"
          >
            <Upload className="w-3.5 h-3.5" />
            Import
          </button>
          <button
            onClick={() => setShowSkillGenerator(true)}
            className="flex items-center gap-1 text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            aria-label="Generate skill with AI"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Generate
          </button>
          <button
            onClick={openCreateSkill}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Create new skill"
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
            placeholder="Search skills..."
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
        {filtered.length === 0 ? (
          <PaneEmptyState>
            {deferredQuery ? `No skills match "${deferredQuery}"` : 'No skills yet - generate or create one to reuse across agents'}
          </PaneEmptyState>
        ) : filtered.map((skill) => (
          <div
            key={skill.id}
            onClick={() => openEditSkill(skill.id)}
            className="group flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/60"
          >
            <span className="text-base leading-none shrink-0">{skill.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{skill.name}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                {skill.description || `${enabledToolCount(skill)} tool${enabledToolCount(skill) !== 1 ? 's' : ''} enabled`}
              </p>
            </div>
            <Wrench className="w-3 h-3 text-gray-300 dark:text-gray-600 shrink-0" />
            <div className="invisible group-hover:visible flex items-center gap-0.5 shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); void duplicateSkill(skill.id) }}
                className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                aria-label={`Duplicate ${skill.name}`}
              >
                <Copy className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); void exportSkill(skill.id) }}
                className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                aria-label={`Export ${skill.name}`}
              >
                <Download className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); void deleteSkill(skill.id) }}
                className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                aria-label={`Delete ${skill.name}`}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
