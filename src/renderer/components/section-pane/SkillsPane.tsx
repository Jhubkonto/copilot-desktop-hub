import { useDeferredValue, useMemo, useState } from 'react'
import { NexyIcon } from '../ui/icons/NexyIcon'
import { useAppStore } from '../../store/app-store'
import { PaneSkeleton, PaneEmptyState } from './pane-primitives'

export function SkillsPane() {
  const skills = useAppStore((s) => s.skills)
  const skillsLoading = useAppStore((s) => s.skillsLoading)
  const openCreateSkill = useAppStore((s) => s.openCreateSkill)
  const openEditSkill = useAppStore((s) => s.openEditSkill)
  const importSkill = useAppStore((s) => s.importSkill)
  const duplicateSkill = useAppStore((s) => s.duplicateSkill)
  const exportSkill = useAppStore((s) => s.exportSkill)
  const exportSkillMarkdown = useAppStore((s) => s.exportSkillMarkdown)
  const deleteSkill = useAppStore((s) => s.deleteSkill)
  const setShowSkillGenerator = useAppStore((s) => s.setShowSkillGenerator)
  const discoveredSkills = useAppStore((s) => s.discoveredSkills)
  const discoveringSkills = useAppStore((s) => s.discoveringSkills)
  const discoverSkills = useAppStore((s) => s.discoverSkills)
  const importDiscoveredSkill = useAppStore((s) => s.importDiscoveredSkill)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const [query, setQuery] = useState('')
  const [showDiscovery, setShowDiscovery] = useState(false)
  const deferredQuery = useDeferredValue(query)

  const toggleDiscovery = () => {
    setShowDiscovery((prev) => {
      const next = !prev
      if (next) void discoverSkills(activeProjectId ?? undefined)
      return next
    })
  }

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
      <div className="flex h-9 items-center justify-between border-b border-nexy-border px-4">
        <span className="nexy-font-status text-nexy-muted">
          {skills.length} skill{skills.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={importSkill}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Import skill"
          >
            <NexyIcon name="upload" className="w-3.5 h-3.5" />
            Import
          </button>
          <button
            onClick={toggleDiscovery}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${showDiscovery ? 'text-nexy-accent bg-nexy-recessed' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            aria-label="Discover skills on disk"
            aria-pressed={showDiscovery}
          >
            <NexyIcon name="search" className="w-3.5 h-3.5" />
            Discover
          </button>
          <button
            onClick={() => setShowSkillGenerator(true)}
            className="flex items-center gap-1 text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            aria-label="Generate skill with AI"
          >
            <NexyIcon name="spark" className="w-3.5 h-3.5" />
            Generate
          </button>
          <button
            onClick={openCreateSkill}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Create new skill"
          >
            <NexyIcon name="add" className="w-3.5 h-3.5" />
            New
          </button>
        </div>
      </div>

      <div className="border-b border-nexy-border px-3 py-2">
        <div className="relative">
          <NexyIcon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills..."
            className="w-full rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed py-1.5 pl-8 pr-7 text-xs text-nexy-text outline-none transition-colors placeholder:text-nexy-muted focus:bg-nexy-raised focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-nexy-accent"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label="Clear search"
            >
              <NexyIcon name="close" className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {showDiscovery && (
        <div className="border-b border-nexy-border bg-nexy-recessed/40 px-2 py-2">
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="nexy-font-status text-nexy-muted">
              {discoveringSkills ? 'Scanning disk…' : `${discoveredSkills.length} on disk`}
            </span>
            <button
              onClick={() => void discoverSkills(activeProjectId ?? undefined)}
              disabled={discoveringSkills}
              className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-1.5 py-0.5 rounded disabled:opacity-50"
              aria-label="Rescan for skills on disk"
            >
              <NexyIcon name="refresh" className="w-3 h-3" />
              Rescan
            </button>
          </div>
          {!discoveringSkills && discoveredSkills.length === 0 ? (
            <p className="px-1 py-1 text-[10px] text-nexy-muted">
              No skill packages found in the Claude, Codex, or project skills folders.
            </p>
          ) : (
            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {discoveredSkills.map((discovery) => (
                <div
                  key={discovery.packagePath}
                  className="flex items-center gap-2 rounded-nexy-sm border border-transparent px-2 py-1.5 hover:border-nexy-border"
                >
                  <span className="text-sm leading-none shrink-0">{discovery.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{discovery.name}</p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                      {discovery.rootLabel} · {discovery.source}
                    </p>
                  </div>
                  {discovery.alreadyImported ? (
                    <span className="text-[9px] uppercase text-nexy-muted shrink-0">In library</span>
                  ) : (
                    <button
                      onClick={() => void importDiscoveredSkill(discovery)}
                      disabled={discovery.validationStatus === 'invalid'}
                      className="flex items-center gap-1 text-[10px] text-nexy-accent hover:opacity-80 px-1.5 py-0.5 rounded disabled:opacity-40 shrink-0"
                      aria-label={`Import ${discovery.name}`}
                    >
                      <NexyIcon name="download" className="w-3 h-3" />
                      Import
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="mt-1.5 px-1 pt-1.5 border-t border-nexy-border/60 text-[9px] leading-snug text-nexy-muted">
            Scans your Claude, Codex, and project skills folders. Set{' '}
            <code className="text-[9px]">CLAUDE_CONFIG_DIR</code> or <code className="text-[9px]">CODEX_HOME</code> to
            point Nexy at a custom harness location. Skills you attach to a CLI agent are synced into that
            harness&apos;s folder automatically while the agent runs.
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto mr-1.5 p-2 space-y-0.5">
        {filtered.length === 0 ? (
          <PaneEmptyState>
            {deferredQuery ? `No skills match "${deferredQuery}"` : 'No skills yet - generate or create one to reuse across agents'}
          </PaneEmptyState>
        ) : filtered.map((skill) => (
          <div
            key={skill.id}
            onClick={() => openEditSkill(skill.id)}
            className="group flex cursor-pointer items-center gap-2 rounded-nexy-sm border border-transparent px-2 py-2 transition-colors hover:border-nexy-border hover:bg-nexy-recessed"
          >
            <span className="text-base leading-none shrink-0">{skill.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{skill.name}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                {skill.description || 'No activation description'}
              </p>
            </div>
            <span className={`text-[9px] uppercase ${skill.validationStatus === 'invalid' ? 'text-red-500' : 'text-nexy-muted'}`}>
              {skill.validationStatus ?? 'valid'}
            </span>
            <div className="invisible group-hover:visible flex items-center gap-0.5 shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); void duplicateSkill(skill.id) }}
                className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                aria-label={`Duplicate ${skill.name}`}
              >
                <NexyIcon name="duplicate" className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); void exportSkill(skill.id) }}
                className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                aria-label={`Export ${skill.name} as JSON`}
              >
                <NexyIcon name="download" className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); void exportSkillMarkdown(skill.id) }}
                className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                aria-label={`Export ${skill.name} package`}
              >
                <NexyIcon name="artifact" className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); void deleteSkill(skill.id) }}
                className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                aria-label={`Delete ${skill.name}`}
              >
                <NexyIcon name="delete" className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
