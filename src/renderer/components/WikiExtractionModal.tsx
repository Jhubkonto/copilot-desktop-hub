import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import type { WikiCandidate } from '../../shared/types'

type CandidateStatus = 'pending' | 'accepted' | 'discarded' | 'saving' | 'error'

interface CandidateState {
  status: CandidateStatus
  editing: boolean
  title: string
  body: string
  tags: string[]
  error?: string
}

interface CandidateRowState extends CandidateState {
  tagInput: string
}

interface WikiExtractionModalProps {
  projectId: string
  conversationId: string
  candidates: WikiCandidate[]
  onClose: () => void
  onAllDone: (savedCount: number) => void
}

function addUniqueTag(tags: string[], value: string): string[] {
  const next = value.trim().replace(/^,+|,+$/g, '')
  if (!next || tags.includes(next)) return tags
  return [...tags, next]
}

export function WikiExtractionModal({
  projectId,
  conversationId,
  candidates,
  onClose,
  onAllDone,
}: WikiExtractionModalProps) {
  const [items, setItems] = useState<CandidateRowState[]>(() =>
    candidates.map((candidate) => ({
      status: 'pending',
      editing: false,
      title: candidate.title,
      body: candidate.body,
      tags: candidate.tags,
      error: undefined,
      tagInput: '',
    }))
  )
  const titleRefs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const savedCount = useMemo(
    () => items.filter((item) => item.status === 'accepted').length,
    [items]
  )
  const pendingCount = useMemo(
    () => items.filter((item) => item.status === 'pending' || item.status === 'error').length,
    [items]
  )

  const updateItem = useCallback((index: number, updater: (item: CandidateRowState) => CandidateRowState) => {
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? updater(item) : item)))
  }, [])

  const beginEdit = useCallback((index: number) => {
    updateItem(index, (item) => ({ ...item, editing: true, error: undefined }))
    requestAnimationFrame(() => titleRefs.current[index]?.focus())
  }, [updateItem])

  const saveCandidate = useCallback(async (index: number) => {
    const candidate = candidates[index]
    const item = items[index]
    if (!candidate || !item) return false

    const title = item.title.trim()
    if (!title) {
      updateItem(index, (current) => ({ ...current, status: 'error', error: 'Title is required' }))
      return false
    }

    const tags = addUniqueTag(item.tags, item.tagInput)
    updateItem(index, (current) => ({
      ...current,
      status: 'saving',
      error: undefined,
      tags,
      tagInput: '',
    }))

    try {
      if (candidate.matchingEntryId) {
        await window.api.updateWikiEntry(candidate.matchingEntryId, {
          title,
          body: item.body,
          tags,
        })
      } else {
        await window.api.createWikiEntry(projectId, title, item.body, tags, { conversationId })
      }

      updateItem(index, (current) => ({
        ...current,
        status: 'accepted',
        editing: false,
        title,
        tags,
        error: undefined,
        tagInput: '',
      }))
      return true
    } catch {
      updateItem(index, (current) => ({
        ...current,
        status: 'error',
        error: 'Failed to save wiki entry',
      }))
      return false
    }
  }, [candidates, conversationId, items, projectId, updateItem])

  const handleAcceptAll = useCallback(async () => {
    let newlySaved = 0
    const indices = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status === 'pending' || item.status === 'error')
      .map(({ index }) => index)

    for (const index of indices) {
      const saved = await saveCandidate(index)
      if (saved) newlySaved += 1
    }

    if (newlySaved > 0) onAllDone(newlySaved)
  }, [items, onAllDone, saveCandidate])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label="Extracted learnings"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">💡 Extracted learnings</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{candidates.length} candidate{candidates.length === 1 ? '' : 's'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="Close extracted learnings dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {candidates.map((candidate, index) => {
            const item = items[index]
            const previewTags = addUniqueTag(item.tags, item.tagInput)
            const isDone = item.status === 'accepted' || item.status === 'discarded'
            const isSaving = item.status === 'saving'

            return (
              <div
                key={`${candidate.title}-${index}`}
                className={`rounded-xl border p-4 transition-all ${
                  item.status === 'discarded'
                    ? 'border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40 opacity-60'
                    : item.status === 'accepted'
                      ? 'border-green-200 dark:border-green-800 bg-green-50/70 dark:bg-green-900/20'
                      : item.status === 'error'
                        ? 'border-red-200 dark:border-red-800 bg-red-50/40 dark:bg-red-900/10'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-3">
                    {candidate.matchingEntryId && (
                      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                        ⚠️ Similar entry exists: <span className="font-medium">{candidate.matchingEntryTitle}</span> — updating that entry instead of creating new
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Title</label>
                      {item.editing && !isDone ? (
                        <input
                          ref={(element) => {
                            titleRefs.current[index] = element
                          }}
                          value={item.title}
                          onChange={(event) => updateItem(index, (current) => ({ ...current, title: event.target.value }))}
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          aria-label={`Candidate ${index + 1} title`}
                        />
                      ) : (
                        <div className="rounded-lg border border-transparent px-0.5 py-0.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                          {item.title}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Tags</label>
                      {item.editing && !isDone ? (
                        <>
                          <input
                            value={item.tagInput}
                            onChange={(event) => updateItem(index, (current) => ({ ...current, tagInput: event.target.value }))}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ',') {
                                event.preventDefault()
                                updateItem(index, (current) => ({
                                  ...current,
                                  tags: addUniqueTag(current.tags, current.tagInput),
                                  tagInput: '',
                                }))
                              } else if (event.key === 'Backspace' && !item.tagInput && item.tags.length > 0) {
                                event.preventDefault()
                                updateItem(index, (current) => ({ ...current, tags: current.tags.slice(0, -1) }))
                              }
                            }}
                            placeholder="Add tags and press comma or Enter"
                            className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            aria-label={`Candidate ${index + 1} tags`}
                          />
                          {previewTags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {previewTags.map((tag) => (
                                <span
                                  key={tag}
                                  className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300"
                                >
                                  <span>{tag}</span>
                                  {item.tags.includes(tag) && (
                                    <button
                                      type="button"
                                      onClick={() => updateItem(index, (current) => ({
                                        ...current,
                                        tags: current.tags.filter((value) => value !== tag),
                                      }))}
                                      className="rounded-full text-blue-500 hover:text-blue-700 dark:hover:text-blue-200"
                                      aria-label={`Remove ${tag} from candidate ${index + 1}`}
                                    >
                                      ×
                                    </button>
                                  )}
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      ) : previewTags.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {previewTags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-gray-400 dark:text-gray-500">No tags</div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Body</label>
                      {item.editing && !isDone ? (
                        <textarea
                          value={item.body}
                          onChange={(event) => updateItem(index, (current) => ({ ...current, body: event.target.value }))}
                          rows={5}
                          className="w-full resize-y rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          aria-label={`Candidate ${index + 1} body`}
                        />
                      ) : (
                        <div className="whitespace-pre-wrap rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 px-3 py-2 text-sm text-gray-700 dark:text-gray-200">
                          {item.body}
                        </div>
                      )}
                    </div>

                    {item.error && (
                      <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-600 dark:text-red-300">
                        {item.error}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void saveCandidate(index)}
                        disabled={isSaving || isDone}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        <span>{candidate.matchingEntryId ? 'Update existing' : 'Accept'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => beginEdit(index)}
                        disabled={isSaving || isDone}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Pencil className="w-4 h-4" />
                        <span>{item.editing ? 'Editing' : 'Edit'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => updateItem(index, (current) => ({ ...current, status: 'discarded', editing: false, error: undefined, tagInput: '' }))}
                        disabled={isSaving || item.status === 'accepted' || item.status === 'discarded'}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-red-600 dark:text-red-300 transition-colors hover:bg-red-50 dark:hover:bg-red-900/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <X className="w-4 h-4" />
                        <span>Discard</span>
                      </button>
                    </div>
                  </div>

                  {(item.status === 'accepted' || item.status === 'discarded') && (
                    <div className={`mt-1 shrink-0 rounded-full p-1.5 ${item.status === 'accepted' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                      {item.status === 'accepted' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 px-5 py-4 backdrop-blur">
          <div className="text-sm text-gray-500 dark:text-gray-400">{savedCount} saved</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleAcceptAll()}
              disabled={pendingCount === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 dark:bg-gray-100 px-4 py-2 text-sm font-medium text-white dark:text-gray-900 transition-colors hover:bg-gray-800 dark:hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {items.some((item) => item.status === 'saving') && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Accept All</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
