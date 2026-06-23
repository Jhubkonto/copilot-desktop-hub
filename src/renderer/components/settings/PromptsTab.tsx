import { Plus, Trash2 } from 'lucide-react'
import { SelectField, TextareaField, TextField } from '../ui/primitives'
import type { PromptLibraryEntry, PromptLibraryInput, PromptLibraryVersion } from '@shared/types'
import { TabHeader } from './TabHeader'

interface Props {
  prompts: PromptLibraryEntry[]
  promptsLoading: boolean
  selectedPromptId: string | null
  promptDraft: PromptLibraryInput
  promptTagInput: string
  promptVersions: PromptLibraryVersion[]
  versionsLoading: boolean
  promptsByCategory: Record<string, PromptLibraryEntry[]>
  promptVariables: string[]
  projectId: string | null | undefined
  activeProject: { name: string } | null
  onSetPromptDraft: (updater: (draft: PromptLibraryInput) => PromptLibraryInput) => void
  onSetPromptTagInput: (v: string) => void
  onNewPrompt: () => void
  onSelectPrompt: (prompt: PromptLibraryEntry) => void
  onSavePrompt: () => void
  onDeletePrompt: () => void
  onRollbackPrompt: (version: PromptLibraryVersion) => void
}

export function PromptsTab({
  prompts, promptsLoading,
  selectedPromptId, promptDraft, promptTagInput,
  promptVersions, versionsLoading,
  promptsByCategory, promptVariables,
  projectId, activeProject,
  onSetPromptDraft, onSetPromptTagInput,
  onNewPrompt, onSelectPrompt, onSavePrompt, onDeletePrompt, onRollbackPrompt,
}: Props) {
  return (
    <div className="h-full min-h-[520px] flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <TabHeader title="Prompts" description="Save reusable prompts by category. Project prompts appear when a project is active." />
        <button
          type="button"
          onClick={onNewPrompt}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 font-medium shrink-0 mb-1"
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </button>
      </div>

      <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-4 min-h-0 flex-1">
        {/* Sidebar */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-y-auto">
          {promptsLoading && <p className="text-xs text-gray-400 p-3">Loading prompts...</p>}
          {!promptsLoading && prompts.length === 0 && <p className="text-xs text-gray-400 p-3">No prompts yet.</p>}
          {!promptsLoading && Object.entries(promptsByCategory).map(([categoryName, entries]) => (
            <div key={categoryName} className="border-b border-gray-100 dark:border-gray-700 last:border-b-0">
              <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900/40 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {categoryName}
              </div>
              <div className="p-1">
                {entries.map((prompt) => (
                  <button
                    key={prompt.id}
                    type="button"
                    onClick={() => onSelectPrompt(prompt)}
                    className={`w-full text-left px-2.5 py-2 rounded-md transition-colors ${
                      selectedPromptId === prompt.id
                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200'
                    }`}
                  >
                    <span className="block text-xs font-medium whitespace-normal break-words leading-4">{prompt.title}</span>
                    <span className="block text-[11px] text-gray-400 whitespace-normal break-words mt-0.5">
                      {prompt.scope === 'project' ? `Project: ${activeProject?.name ?? 'selected project'}` : 'Available everywhere'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Editor */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 overflow-y-auto space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Title"
              value={promptDraft.title}
              onChange={(e) => onSetPromptDraft((draft) => ({ ...draft, title: e.target.value }))}
              placeholder="Code review checklist"
            />
            <TextField
              label="Category"
              value={promptDraft.category ?? ''}
              onChange={(e) => onSetPromptDraft((draft) => ({ ...draft, category: e.target.value }))}
              placeholder="Coding"
            />
          </div>

          <TextField
            label="Description"
            value={promptDraft.description ?? ''}
            onChange={(e) => onSetPromptDraft((draft) => ({ ...draft, description: e.target.value }))}
            placeholder="Short note about when to use this prompt"
          />

          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Scope"
              value={promptDraft.scope ?? 'global'}
              onChange={(e) => onSetPromptDraft((draft) => ({
                ...draft,
                scope: e.target.value === 'project' ? 'project' : 'global',
                project_id: e.target.value === 'project' ? (projectId ?? null) : null,
              }))}
            >
              <option value="global">Available everywhere</option>
              <option value="project" disabled={!projectId}>{activeProject?.name ? `Project: ${activeProject.name}` : 'Project prompt'}</option>
            </SelectField>
            <TextField
              label="Tags"
              value={promptTagInput}
              onChange={(e) => onSetPromptTagInput(e.target.value)}
              placeholder="review, typescript"
            />
          </div>

          <TextareaField
            label="Prompt"
            value={promptDraft.body}
            onChange={(e) => onSetPromptDraft((draft) => ({ ...draft, body: e.target.value }))}
            className="min-h-[300px]"
            placeholder="Write the reusable prompt..."
          />
          {promptVariables.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {promptVariables.map((variable) => (
                <span
                  key={variable}
                  className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-[11px] font-mono text-gray-600 dark:text-gray-300"
                >
                  {'{{'}{variable}{'}}'}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={onDeletePrompt}
              disabled={!selectedPromptId}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
            <button
              type="button"
              onClick={onSavePrompt}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 font-medium"
            >
              Save prompt
            </button>
          </div>

          {selectedPromptId && (
            <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-gray-600 dark:text-gray-300">Version history</p>
                {versionsLoading && <span className="text-[11px] text-gray-400">Loading...</span>}
              </div>
              {!versionsLoading && promptVersions.length === 0 && (
                <p className="text-xs text-gray-400">No versions recorded yet.</p>
              )}
              <div className="space-y-2">
                {promptVersions.map((version) => {
                  const changedFields = [
                    version.diff.titleChanged ? 'title' : null,
                    version.diff.descriptionChanged ? 'description' : null,
                    version.diff.categoryChanged ? 'category' : null,
                    version.diff.tagsChanged ? 'tags' : null,
                    version.diff.scopeChanged ? 'scope' : null,
                  ].filter(Boolean)
                  return (
                    <details
                      key={version.id}
                      className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40"
                    >
                      <summary className="cursor-pointer px-3 py-2 text-xs text-gray-700 dark:text-gray-200 flex items-center justify-between gap-3">
                        <span>v{version.version} · {new Date(version.created_at).toLocaleString()} · {version.source}</span>
                        <span className="text-[11px] text-gray-400">
                          {version.diff.addedLines.length} added / {version.diff.removedLines.length} removed
                        </span>
                      </summary>
                      <div className="px-3 pb-3 space-y-2">
                        {changedFields.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {changedFields.map((field) => (
                              <span key={field} className="px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-[11px] text-gray-600 dark:text-gray-300">
                                {field}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="rounded-md overflow-hidden border border-gray-200 dark:border-gray-700">
                          {version.diff.removedLines.slice(0, 8).map((line, index) => (
                            <div key={`removed-${index}`} className="px-2 py-1 text-[11px] font-mono bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">
                              - {line}
                            </div>
                          ))}
                          {version.diff.addedLines.slice(0, 8).map((line, index) => (
                            <div key={`added-${index}`} className="px-2 py-1 text-[11px] font-mono bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300">
                              + {line}
                            </div>
                          ))}
                          {version.diff.addedLines.length === 0 && version.diff.removedLines.length === 0 && (
                            <div className="px-2 py-1 text-[11px] text-gray-400">No body line changes</div>
                          )}
                        </div>
                        {version.version !== promptVersions[0]?.version && (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => void onRollbackPrompt(version)}
                              className="text-[11px] px-2.5 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                              Roll back to v{version.version}
                            </button>
                          </div>
                        )}
                      </div>
                    </details>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
